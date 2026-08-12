// Client-side feedback capture: bundles a written report with enough
// diagnostic context (current view, recent logs, environment) plus an
// optional screenshot into a zip the user downloads (browser) or saves via a
// native dialog (desktop). Nothing is ever sent to a server — the resulting
// file is meant to be pasted/attached into an AI coding assistant by hand.

import { buffer as logBuffer } from '@/utils/logger';
import { isTauri, saveFileDialog } from '@/utils/tauri';
import { useVaultsStore } from '@/stores/vaults';
import { useTabsStore } from '@/stores/tabs';
import pkg from '../../package.json';

export interface FeedbackStateSnapshot {
  capturedAt: string;
  view: {
    activeVaultId: string | null;
    activeVaultName: string | null;
    activePaneId: string;
    splitOrientation: string;
    panes: Array<{
      id: string;
      activeTabId: string | null;
      tabs: Array<{
        filePath: string;
        fileType: string;
        isDirty: boolean;
        pinned: boolean;
      }>;
    }>;
  };
  logs: ReturnType<typeof logBuffer>;
  environment: {
    appVersion: string;
    runtime: 'tauri' | 'browser';
    userAgent: string;
    platform: string;
    language: string;
    screen: { width: number; height: number; devicePixelRatio: number };
    url: string;
  };
}

/** Gather the "current view" + logs + environment state described above. */
export function captureStateSnapshot(): FeedbackStateSnapshot {
  const vaultsStore = useVaultsStore();
  const tabsStore = useTabsStore();
  const activeVaultId = vaultsStore.activeVaultId;
  const activeVault = activeVaultId
    ? vaultsStore.vaults.find((v) => v.id === activeVaultId)
    : undefined;

  return {
    capturedAt: new Date().toISOString(),
    view: {
      activeVaultId,
      activeVaultName: activeVault?.name ?? null,
      activePaneId: tabsStore.activePaneId,
      splitOrientation: tabsStore.splitOrientation,
      panes: tabsStore.panes.map((pane) => ({
        id: pane.id,
        activeTabId: pane.activeTabId,
        tabs: tabsStore.tabsForPane(pane.id).map((tab) => ({
          filePath: tab.filePath,
          fileType: tab.fileType,
          isDirty: tab.isDirty,
          pinned: !!tab.pinned,
        })),
      })),
    },
    logs: logBuffer(),
    environment: {
      appVersion: pkg.version,
      runtime: isTauri() ? 'tauri' : 'browser',
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        devicePixelRatio: window.devicePixelRatio,
      },
      url: window.location.href,
    },
  };
}

/**
 * Capture a screenshot of the app's own DOM (not a true OS-level screen
 * capture — there's no Tauri screenshot plugin, and this works identically
 * in the browser and inside the Tauri WebView). Returns `null` rather than
 * throwing on failure, since a failed screenshot shouldn't block submitting
 * the rest of the feedback bundle.
 */
export async function captureScreenshot(): Promise<Blob | null> {
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(document.body, { logging: false });
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  } catch {
    return null;
  }
}

/** Build the feedback zip: message.txt, state.json, and optionally screenshot.png. */
export async function buildFeedbackZip(
  message: string,
  screenshot: Blob | null,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('message.txt', message);
  zip.file('state.json', JSON.stringify(captureStateSnapshot(), null, 2));
  if (screenshot) {
    zip.file('screenshot.png', screenshot);
  }
  return zip.generateAsync({ type: 'blob' });
}

function feedbackFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `librarium-feedback-${stamp}.zip`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix FileReader adds.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface SaveFeedbackResult {
  saved: boolean;
  path?: string;
}

/**
 * Save the built zip: a native save dialog + on-disk write on desktop, or a
 * normal browser download otherwise. Returns `saved: false` only when the
 * user cancels the desktop save dialog — a browser download is always
 * reported as saved since there's no cancellation signal for it.
 */
export async function saveFeedbackZip(blob: Blob): Promise<SaveFeedbackResult> {
  const filename = feedbackFileName();

  if (isTauri()) {
    const path = await saveFileDialog(filename, ['zip']);
    if (!path) return { saved: false };
    const base64 = await blobToBase64(blob);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_binary_file', { path, dataBase64: base64 });
    return { saved: true, path };
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { saved: true };
}
