import { describe, expect, it } from 'vitest';
import { drillsListed, focusLeaves } from './drillsSection';

describe('drillsListed', () => {
    it('folds to the Add row with no drills', () => {
        expect(drillsListed({ drillCount: 0, focusInSection: false })).toBe(false);
    });

    it('lists with a drill', () => {
        expect(drillsListed({ drillCount: 1, focusInSection: false })).toBe(true);
    });

    it('stays listed while the focus is in the section (Shift+Tab to its Add button), and folds once it leaves', () => {
        expect(drillsListed({ drillCount: 0, focusInSection: true })).toBe(true);
        expect(drillsListed({ drillCount: 0, focusInSection: false })).toBe(false);
    });
});

describe('focusLeaves', () => {
    // a section holding a field and a button, and a control outside it (no DOM in these tests: only `contains` is read)
    const field = {} as Node;
    const addButton = {} as Node;
    const outside = {} as Node;
    const section = { contains: (other: Node | null) => other === field || other === addButton } as unknown as Node;

    it('is false when the focus moves within the section (the level field to its Add button)', () => {
        expect(focusLeaves(section, addButton)).toBe(false);
        expect(focusLeaves(section, field)).toBe(false);
    });

    it('is true when the focus goes outside, or to nothing', () => {
        expect(focusLeaves(section, outside)).toBe(true);
        expect(focusLeaves(section, null)).toBe(true);
    });
});
