import { describe, expect, it } from 'vitest';
import { UNEVEN_REPEAT } from '../test/oscillationFixture';
import { OUTPUT_CHART_COPY, offByText, outputChartOf } from './outputChart';

describe('the chart of a clock whose status is Oscillates', () => {
    it('has a bar for each window cycle, in order, the ones off the expected output marked', () => {
        const chart = outputChartOf(UNEVEN_REPEAT);
        if (chart.kind !== 'bars') throw new Error('a list the engine kept whole draws bars');
        expect(chart.bars).toHaveLength(26);
        expect(chart.bars.filter(bar => bar.off)).toEqual([
            { place: 2, windowCycles: '2', items: 432, off: true },
            { place: 18, windowCycles: '18', items: 144, off: true },
        ]);
        expect(chart).toMatchObject({ expected: 288, tolerance: 16 });
        expect(chart.bars.map(bar => offByText(bar, 288)).filter(Boolean)).toEqual(['+144', '−144']);
    });

    it('gives a bar that is within the tolerance no mark', () => {
        const chart = outputChartOf({ ...UNEVEN_REPEAT, made: [304, 272, 288, 432, 144] });
        expect(chart.kind === 'bars' && chart.bars.map(bar => bar.off)).toEqual([false, false, false, true, true]);
    });

    it('names the window cycles a bin of a fractional window cycle stands for', () => {
        const chart = outputChartOf({ ...UNEVEN_REPEAT, window_cycles_per_bin: 19 });
        expect(chart.kind === 'bars' && chart.bars[1].windowCycles).toBe('20–38');
        expect(OUTPUT_CHART_COPY.title(true, 19)).toBe('Output in each 19 window cycles of the repeating run');
    });

    it('keeps the highest and the lowest of a list the engine cut, with their window cycles', () => {
        const { made: _made, ...facts } = UNEVEN_REPEAT;
        void _made;
        const chart = outputChartOf({ ...facts, bins: 90, cut: { highest: { at: 5, items: 432 }, lowest: { at: 84, items: 144 } } });
        expect(chart).toMatchObject({ kind: 'cut', windowCycles: 90, highest: { windowCycles: '6', items: 432 }, lowest: { windowCycles: '85', items: 144 } });
    });

    it('says the window cycles off the expected output to a screen reader', () => {
        const chart = outputChartOf(UNEVEN_REPEAT);
        const off = chart.kind === 'bars' ? chart.bars.filter(bar => bar.off) : [];
        expect(OUTPUT_CHART_COPY.label(26, 288, off)).toBe('26 bars, 288 items expected in each. Window cycle 2: 432 items. Window cycle 18: 144 items.');
    });
});
