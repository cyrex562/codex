import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useTabsStore } from './tabs';

// Tabs are stored in an insertion-ordered Map; `tabsForPane` reflects that
// order. `moveTabInPane` rebuilds the Map so the pane's tabs appear at the
// requested new position while tabs from other panes stay put.

describe('tabsStore.moveTabInPane', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    function openThree(paneId: string): string[] {
        const store = useTabsStore();
        const a = store.openTab(paneId, 'a.md', 'a.md');
        const b = store.openTab(paneId, 'b.md', 'b.md');
        const c = store.openTab(paneId, 'c.md', 'c.md');
        return [a.id, b.id, c.id];
    }

    it('moves a tab from the middle to the front of its pane', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');

        store.moveTabInPane('pane-1', b, 0);

        expect(store.tabsForPane('pane-1').map((t) => t.id)).toEqual([b, a, c]);
    });

    it('moves a tab to the end of its pane', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');

        store.moveTabInPane('pane-1', a, 2);

        expect(store.tabsForPane('pane-1').map((t) => t.id)).toEqual([b, c, a]);
    });

    it('is a no-op when the tab is already at the target index', () => {
        const store = useTabsStore();
        const ids = openThree('pane-1');

        store.moveTabInPane('pane-1', ids[1], 1);

        expect(store.tabsForPane('pane-1').map((t) => t.id)).toEqual(ids);
    });

    it('clamps out-of-range indices into the valid range', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');

        store.moveTabInPane('pane-1', a, 99);

        expect(store.tabsForPane('pane-1').map((t) => t.id)).toEqual([b, c, a]);
    });

    it('leaves tabs from other panes untouched when reordering one pane', () => {
        const store = useTabsStore();
        // Open one tab in pane-1, split, then open two in pane-2 for a
        // scenario where the Map interleaves pane memberships.
        const a1 = store.openTab('pane-1', 'a.md', 'a.md');
        store.splitPane('pane-1', 'vertical');
        const paneIds = store.panes.map((p) => p.id);
        const pane2 = paneIds[1];
        const x = store.openTab(pane2, 'x.md', 'x.md');
        const y = store.openTab(pane2, 'y.md', 'y.md');

        store.moveTabInPane(pane2, y.id, 0);

        expect(store.tabsForPane(pane2).map((t) => t.id)).toEqual([y.id, x.id]);
        // pane-1 unaffected — same single tab, still present.
        expect(store.tabsForPane('pane-1').map((t) => t.id)).toEqual([a1.id]);
    });

    it('is a silent no-op when the tab id is not in the given pane', () => {
        const store = useTabsStore();
        const ids = openThree('pane-1');

        store.moveTabInPane('pane-1', 'nonexistent::id', 0);

        expect(store.tabsForPane('pane-1').map((t) => t.id)).toEqual(ids);
    });
});

// ── Tab pinning (issue #33) ────────────────────────────────────────────────
//
// Pinned tabs sort ahead of unpinned tabs within their pane; the bulk-close
// helpers (`tabIdsInPane`/`tabIdsToRight`/`tabIdsExcept`) skip pinned tabs so
// "Close others / all in pane" never eats a pinned tab; `closeAllTabs`
// preserves them across a global wipe.

describe('tabsStore pinning', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    function openThree(paneId: string): string[] {
        const store = useTabsStore();
        const a = store.openTab(paneId, 'a.md', 'a.md');
        const b = store.openTab(paneId, 'b.md', 'b.md');
        const c = store.openTab(paneId, 'c.md', 'c.md');
        return [a.id, b.id, c.id];
    }

    it('toggleTabPinned flips the pinned flag on the target tab', () => {
        const store = useTabsStore();
        const [a] = openThree('pane-1');

        store.toggleTabPinned(a);
        expect(store.tabs.get(a)?.pinned).toBe(true);

        store.toggleTabPinned(a);
        expect(store.tabs.get(a)?.pinned).toBe(false);
    });

    it('sorts pinned tabs ahead of unpinned tabs in tabsForPane', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');

        // Pin the last-opened tab — it should appear first.
        store.toggleTabPinned(c);

        expect(store.tabsForPane('pane-1').map((t) => t.id)).toEqual([c, a, b]);
    });

    it('preserves insertion order within the pinned and unpinned groups', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');

        store.toggleTabPinned(a);
        store.toggleTabPinned(c);

        // a and c are pinned in insertion order; b is the only unpinned.
        expect(store.tabsForPane('pane-1').map((t) => t.id)).toEqual([a, c, b]);
    });

    it('excludes pinned tabs from tabIdsInPane (Close all in pane)', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');
        store.toggleTabPinned(b);

        expect(store.tabIdsInPane('pane-1')).toEqual([a, c]);
    });

    it('excludes pinned tabs from tabIdsToRight (Close to the right)', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');
        store.toggleTabPinned(c);

        // With c pinned, order is [c, a, b]. Right of `a` is `b` (unpinned).
        expect(store.tabIdsToRight('pane-1', a)).toEqual([b]);
    });

    it('excludes pinned tabs from tabIdsExcept (Close other tabs)', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');
        store.toggleTabPinned(c);

        // "Close others" invoked from `a` closes only unpinned non-`a` tabs.
        expect(store.tabIdsExcept('pane-1', a)).toEqual([b]);
    });

    it('preserves pinned tabs across closeAllTabs', () => {
        const store = useTabsStore();
        const [a, b, c] = openThree('pane-1');
        store.toggleTabPinned(b);

        store.closeAllTabs();

        expect([...store.tabs.keys()]).toEqual([b]);
        // The surviving pinned tab becomes the pane's active tab.
        expect(store.panes[0].activeTabId).toBe(b);
    });
});
