import { describe, it, expect } from 'vitest';
import { selectVisiblePanes } from './panes';

const panes = [
  { id: 'a', flex: 50 },
  { id: 'b', flex: 50 },
];

describe('selectVisiblePanes', () => {
  it('returns all panes on desktop', () => {
    expect(selectVisiblePanes(panes, 'a', false)).toEqual(panes);
    expect(selectVisiblePanes(panes, 'b', false)).toEqual(panes);
    // even with a stale/unknown active id, desktop shows everything
    expect(selectVisiblePanes(panes, 'nope', false)).toEqual(panes);
  });

  it('returns only the active pane on mobile', () => {
    expect(selectVisiblePanes(panes, 'b', true)).toEqual([panes[1]]);
    expect(selectVisiblePanes(panes, 'a', true)).toEqual([panes[0]]);
  });

  it('falls back to the first pane on mobile when the active id is unknown', () => {
    expect(selectVisiblePanes(panes, 'missing', true)).toEqual([panes[0]]);
    expect(selectVisiblePanes(panes, null, true)).toEqual([panes[0]]);
  });

  it('handles a single pane and an empty list', () => {
    expect(selectVisiblePanes([panes[0]], 'a', true)).toEqual([panes[0]]);
    expect(selectVisiblePanes([], 'a', true)).toEqual([]);
    expect(selectVisiblePanes([], 'a', false)).toEqual([]);
  });
});
