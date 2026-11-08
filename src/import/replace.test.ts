import { describe, expect, it } from 'vitest';
import type { ElementMap } from '../model/ops';
import type { ZElement } from '../model/types';
import { otherImportRoots, planReplacement } from './replace';

const base = (id: string, parentId: string | null) => ({ id, parentId, section: 'CANVAS' as const, x: 0, y: 0, z: 1, width: 14, createdAt: 0, updatedAt: 0 });
const board = (id: string, parentId: string | null, extra = {}): ZElement => ({ ...base(id, parentId), type: 'BOARD', title: id, color: 'blue', ...extra });
const image = (id: string, parentId: string, media: string): ZElement => ({ ...base(id, parentId), type: 'IMAGE', media: { id: media, ext: 'jpg' }, name: '', naturalWidth: 1, naturalHeight: 1, caption: '', showCaption: false });
const label = (id: string): ZElement => ({ ...base(id, null), type: 'LABEL', name: id, color: 'red' });
const line = (id: string, parentId: string, a: string, b: string): ZElement => ({ ...base(id, parentId), type: 'LINE', start: { elementId: a, x: 0, y: 0 }, end: { elementId: b, x: 0, y: 0 }, bend: 0, label: '', color: 'default', weight: 2, arrowStart: false, arrowEnd: true });
const map = (list: ZElement[]): ElementMap => Object.fromEntries(list.map((e) => [e.id, e]));

describe('replacing a Milanote import', () => {
  // Before: the old import of account H, a picture the user moved home, and an import of account X.
  const state = map([
    board('home', null),
    board('mn-H', 'home', { title: 'Milanote', importedFrom: 'milanote' }),
    board('mn-b', 'mn-H'),
    image('mn-i1', 'mn-b', 'm1'),
    image('mn-i2', 'home', 'm2'), // moved off the Milanote board, maybe edited
    label('mn-label-l'),
    board('mn-X', 'home', { title: 'Milanote' }), // another account, imported before the marker existed
    image('mn-x1', 'mn-X', 'm3'),
    image('own', 'home', 'm4'),
  ]);
  const incoming = [board('mn-H', 'home', { title: 'Milanote', importedFrom: 'milanote' }), board('mn-b', 'mn-H'), image('mn-i1', 'mn-b', 'n1'), image('mn-i2', 'mn-b', 'n2'), line('mn-l', 'mn-b', 'mn-i1', 'mn-i2'), label('mn-label-l')];

  it('replaces only the same account’s board, keeps what was moved off it and other imports', () => {
    const { ops, removed, orphans } = planReplacement(state, incoming, 'mn-H');
    expect([...removed].sort()).toEqual(['mn-H', 'mn-b', 'mn-i1', 'mn-label-l']);
    const created = ops.filter((o) => o.kind === 'create').map((o) => (o as { element: ZElement }).element);
    const fresh = created.find((e) => e.id.startsWith('mn-i2~'))!;
    expect(fresh).toMatchObject({ parentId: 'mn-b' });
    // The line in the new import points at the fresh copy, not at the moved original.
    expect(created.find((e) => e.id === 'mn-l')).toMatchObject({ start: { elementId: 'mn-i1' }, end: { elementId: fresh.id } });
    expect(ops.some((o) => o.kind === 'delete' && o.element.id === 'mn-i2')).toBe(false);
    expect(ops.some((o) => o.kind === 'delete' && o.element.id.startsWith('mn-x'))).toBe(false);
    // Only the replaced picture's file goes; the moved one and the other account's stay.
    expect(orphans.map((r) => r.id)).toEqual(['m1']);
  });

  it('finds imports of other accounts, old ones included', () => {
    expect(otherImportRoots(state, 'mn-H').map((e) => e.id)).toEqual(['mn-X']);
    expect(otherImportRoots(state, 'mn-X').map((e) => e.id)).toEqual(['mn-H']);
  });

  it('a first import replaces nothing', () => {
    const { removed, orphans } = planReplacement(map([board('home', null)]), incoming, 'mn-H');
    expect(removed.size).toBe(0);
    expect(orphans).toEqual([]);
  });
});
