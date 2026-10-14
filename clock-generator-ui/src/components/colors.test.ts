import { describe, expect, it } from 'vitest';
import {
    CATEGORY_COLORS, DRILL_STATUS_COLORS, INSERTER_STATUS_COLORS, ITEM_COLOR_COUNT, MACHINE_STATUS_COLORS,
    TIMELINE_TRACK_COLOR, factorioStatesIn, getFactorioStateColor, itemColorMap,
} from './colors';
import { StatusCategory, InserterStatus, DrillStatus } from 'clock-generator/light';

function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(i => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const STRIP_STATES = [
    'working', 'waiting_for_source_items', 'waiting_for_more_items', 'waiting_for_space_in_destination',
    'disabled_by_control_behavior', 'item_ingredient_shortage', 'full_output', 'no_fuel',
];
const stateColors = [
    ...Object.values(CATEGORY_COLORS), ...Object.values(INSERTER_STATUS_COLORS), ...Object.values(MACHINE_STATUS_COLORS),
    ...Object.values(DRILL_STATUS_COLORS), ...STRIP_STATES.map(getFactorioStateColor),
];

describe('state colours', () => {
    it('all pass 3:1 on the track', () => {
        for (const color of stateColors) {
            expect(contrastRatio(color, TIMELINE_TRACK_COLOR), color).toBeGreaterThanOrEqual(3);
        }
    });
    it('Disabled is one grey everywhere, and Blocked passes', () => {
        const grey = CATEGORY_COLORS[StatusCategory.DISABLED];
        expect(grey).toBe('#707070');
        expect(INSERTER_STATUS_COLORS[InserterStatus.DISABLED]).toBe(grey);
        expect(DRILL_STATUS_COLORS[DrillStatus.DISABLED]).toBe(grey);
        expect(getFactorioStateColor('disabled_by_control_behavior')).toBe(grey);
        expect(contrastRatio(CATEGORY_COLORS[StatusCategory.BLOCKED], TIMELINE_TRACK_COLOR)).toBeGreaterThanOrEqual(3);
    });
    it('Detailed mode shares no swatch within an entity type', () => {
        for (const colors of [MACHINE_STATUS_COLORS, INSERTER_STATUS_COLORS, DRILL_STATUS_COLORS]) {
            const values = Object.values(colors);
            expect(new Set(values).size).toBe(values.length);
        }
        const strip = STRIP_STATES.map(getFactorioStateColor);
        expect(new Set(strip).size).toBe(strip.length);
    });
});

describe('itemColorMap', () => {
    it('colours in alphabetical order whatever the input order, collapsing duplicates', () => {
        const a = itemColorMap(['c', 'a', 'b', 'a']);
        const b = itemColorMap(['a', 'b', 'c']);
        expect([...a.entries()]).toEqual([...b.entries()]);
        expect([...a.keys()]).toEqual(['a', 'b', 'c']);
    });
    it('repeats from the seventh item, the first six all different', () => {
        const colors = [...itemColorMap(['a', 'b', 'c', 'd', 'e', 'f', 'g']).values()];
        expect(new Set(colors.slice(0, 6)).size).toBe(6);
        expect(colors[6]).toBe(colors[0]);
    });
    it('passes 3:1 on the track and never equals a state colour', () => {
        const colors = [...itemColorMap(['a', 'b', 'c', 'd', 'e', 'f']).values()];
        const states = new Set(stateColors.map(c => c.toLowerCase()));
        for (const color of colors) {
            expect(contrastRatio(color, TIMELINE_TRACK_COLOR), color).toBeGreaterThanOrEqual(3);
            expect(states.has(color.toLowerCase())).toBe(false);
        }
    });
    it('counts six and handles empty input', () => {
        expect(ITEM_COLOR_COUNT).toBe(6);
        expect(itemColorMap([]).size).toBe(0);
    });
});

describe('factorioStatesIn', () => {
    it('returns legend order, drops duplicates, keeps unknown states last in first-seen order', () => {
        expect(factorioStatesIn(['no_fuel', 'zzz', 'working', 'no_fuel', 'aaa'])).toEqual(['working', 'no_fuel', 'zzz', 'aaa']);
    });
    it('returns [] for none', () => {
        expect(factorioStatesIn([])).toEqual([]);
    });
});
