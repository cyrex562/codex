// Frontend diagnostic logger.
//
// Every significant lifecycle event (login, refresh, logout, WebSocket
// reconnect, router guard decision) calls through here so an unexplained
// drop to /login has a durable record. Lines land in three places:
//
//  1. The JS console (as today), preserving the DevTools workflow.
//  2. An in-memory ring buffer (`buffer()`), useful for a future Settings →
//     Diagnostics "Copy recent logs" affordance.
//  3. On desktop, the Tauri `frontend_log` command, which appends to a
//     rotating file under `{data_dir}/logs/frontend.log`. Rotation happens
//     server-side at app start (see librarium-tauri/src/frontend_log.rs).
//
// In a browser build only steps 1 and 2 run — there is no disk store to
// write to. The `isTauri()` check is done lazily and once per call so the
// logger stays a `sync-in-shape` function to the caller; the actual IPC is
// fire-and-forget.

import { isTauri } from '@/utils/tauri';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
    level: LogLevel;
    source: string;
    message: string;
    context?: Record<string, unknown>;
    /** Client-side timestamp — the Rust side stamps its own on disk, but the
     *  in-memory buffer keeps this one so a copy-recent-logs action can show
     *  the wall-clock event time even in a browser build. */
    ts: string;
}

const RING_CAPACITY = 500;
const ring: LogRecord[] = [];

/** Read the in-memory ring buffer. Returns a *copy* so callers can filter or
 *  mutate without disturbing subsequent logging. */
export function buffer(): LogRecord[] {
    return ring.slice();
}

/** Drop everything from the ring buffer. Intended for tests. */
export function _resetForTests(): void {
    ring.length = 0;
}

function record(level: LogLevel, source: string, message: string, context?: Record<string, unknown>) {
    const rec: LogRecord = {
        level,
        source,
        message,
        context,
        ts: new Date().toISOString(),
    };

    // Ring buffer: fixed capacity, oldest-out FIFO.
    ring.push(rec);
    if (ring.length > RING_CAPACITY) ring.shift();

    // Console: keep info/warn/error visible without polluting on debug/trace.
    // eslint-disable-next-line no-console
    const consoleFn = level === 'error' ? console.error
        : level === 'warn' ? console.warn
        : level === 'info' ? console.info
        : console.debug;
    if (context && Object.keys(context).length > 0) {
        consoleFn(`[${source}] ${message}`, context);
    } else {
        consoleFn(`[${source}] ${message}`);
    }

    // Fire-and-forget to disk on desktop. Any IPC error is intentionally
    // swallowed — a failing log write must not break real work.
    if (isTauri()) {
        void writeToDisk(rec);
    }
}

async function writeToDisk(rec: LogRecord) {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('frontend_log', {
            record: {
                level: rec.level,
                source: rec.source,
                message: rec.message,
                context: rec.context ?? {},
            },
        });
    } catch {
        /* best-effort */
    }
}

/**
 * Structured logger factory. Bind a source tag once at module level then
 * call the returned methods anywhere that source dispatches events, e.g.
 *
 *   const log = getLogger('auth');
 *   log.info('login attempt', { username: 'alice' });
 */
export function getLogger(source: string) {
    return {
        trace: (message: string, context?: Record<string, unknown>) =>
            record('trace', source, message, context),
        debug: (message: string, context?: Record<string, unknown>) =>
            record('debug', source, message, context),
        info: (message: string, context?: Record<string, unknown>) =>
            record('info', source, message, context),
        warn: (message: string, context?: Record<string, unknown>) =>
            record('warn', source, message, context),
        error: (message: string, context?: Record<string, unknown>) =>
            record('error', source, message, context),
    };
}

/** Ask the Tauri backend for the current log file path. Returns null in the
 *  browser build (no on-disk file). Useful for a "Copy log path" button. */
export async function getLogFilePath(): Promise<string | null> {
    if (!isTauri()) return null;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string>('frontend_log_path');
    } catch {
        return null;
    }
}
