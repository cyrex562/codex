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
