import type { OscillationFacts } from 'clock-generator/browser';
import { formatNumberText } from './numberText';

/**
 * The chart of a clock whose status is Oscillates, on its Diagnostics tab: the output of each window cycle of the run the
 * engine judged, against the expected output. Every string of it, in one place.
 */
export const OUTPUT_CHART_COPY = {
    title: (proven: boolean, perBin: number) => `Output in each ${perBin === 1 ? 'window cycle' : `${formatNumberText(perBin)} window cycles`} of the ${proven ? 'repeating' : 'sampled'} run`,
    expected: (items: number) => `${formatNumberText(items)} expected`,
    windowCycle: 'Window cycle',
    items: 'Items',
    offBy: 'Off by',
    caption: (tolerance: number) => `Red bars, with their items above them, are more than ${formatNumberText(tolerance)} items off the expected output.`,
    oneCopy: ' The output is of one copy.',
    readAsText: 'Read this as text',
    /** The text alternative of the chart, for a screen reader */
    label: (bars: number, expected: number, off: readonly OutputBar[]) => `${formatNumberText(bars)} bars, ${formatNumberText(expected)} items expected in each. `
        + off.map(bar => `Window cycle ${bar.windowCycles}: ${formatNumberText(bar.items)} items.`).join(' '),
    /** A run too long for the engine to keep every window cycle */
    cut: (windowCycles: number, highest: OutputBar, lowest: OutputBar) =>
        `The run has ${formatNumberText(windowCycles)} window cycles, too many to draw. The highest output is ${formatNumberText(highest.items)} items `
        + `(window cycle ${highest.windowCycles}), the lowest ${formatNumberText(lowest.items)} (window cycle ${lowest.windowCycles}).`,
};

/**
 * One bar: its place, from 1; the window cycles it stands for ("2", or "20–38" for a bin of 19); its items; and whether it is
 * off the expected output by more than the tolerance
 */
export interface OutputBar {
    place: number;
    windowCycles: string;
    items: number;
    off: boolean;
}

/** What the chart draws: a bar for each judged bin, where the engine kept them all; else only the highest and the lowest */
type OutputChart =
    | { kind: 'bars'; bars: OutputBar[]; expected: number; tolerance: number }
    | { kind: 'cut'; windowCycles: number; highest: OutputBar; lowest: OutputBar; expected: number; tolerance: number };

/** The chart of an oscillation's numbers (`as_built.output_reason.data`) */
export function outputChartOf(facts: OscillationFacts): OutputChart {
    const per = facts.window_cycles_per_bin;
    const bar = (at: number, items: number): OutputBar => ({ place: at + 1, items, off: Math.abs(items - facts.expected) > facts.tolerance,
        windowCycles: per === 1 ? formatNumberText(at + 1) : `${formatNumberText(at * per + 1)}–${formatNumberText((at + 1) * per)}` });
    if (facts.made !== undefined) {
        return { kind: 'bars', expected: facts.expected, tolerance: facts.tolerance, bars: facts.made.map((items, at) => bar(at, items)) };
    }
    const { highest, lowest } = facts.cut!;
    return { kind: 'cut', windowCycles: facts.bins * per, highest: bar(highest.at, highest.items), lowest: bar(lowest.at, lowest.items),
        expected: facts.expected, tolerance: facts.tolerance };
}

/** The items a bar is off the expected output by, signed: "+144", "−144"; empty within the tolerance */
export function offByText(bar: OutputBar, expected: number): string {
    if (!bar.off) return '';
    const by = bar.items - expected;
    return `${by > 0 ? '+' : '−'}${formatNumberText(Math.abs(by))}`;
}
