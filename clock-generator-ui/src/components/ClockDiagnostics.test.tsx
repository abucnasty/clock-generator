// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockInsight } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { names, show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330, MILITARY_240, viewOf } from '../test/checkedLanesFixtures';
import { MISSED_SWINGS_COPY } from '../utils/missedSwings';
import { ClockDiagnostics } from './ClockDiagnostics';
import { oscillatingOf } from '../test/oscillationFixture';
import { NINE_APART_HOLDS, NINE_APART_MISSES, rowView, SIX_APART_MISSES } from '../test/oneCopyBuild';

const gameNames = names({ 'iron-gear-wheel': 'Iron gear wheel', 'copper-plate': 'Copper plate', 'automation-science-pack': 'Automation science pack',
    'military-science-pack': 'Military science pack', 'stone-wall': 'Stone wall', 'piercing-rounds-magazine': 'Piercing rounds magazine', 'iron-plate': 'Iron plate' });

/** What the tab holds, by the marks of its parts, in the page's order */
const PARTS = '[data-test-pipeline], [data-insight], [data-cause-headline], [data-picture], [data-other-clock], [data-read-as-text], [data-checked-line], [data-lanes-sentence], table';
const partsOf = (container: HTMLElement) => [...container.querySelectorAll(PARTS)].map(part =>
    part.tagName === 'TABLE' ? 'table'
        : part.hasAttribute('data-picture') ? `picture ${part.getAttribute('data-picture')}`
            : part.hasAttribute('data-insight') ? `note ${part.getAttribute('data-insight')}`
                : [...part.attributes].map(it => it.name).find(name => name.startsWith('data-'))!.slice('data-'.length));

/** The tab's text after the graphic of the tests, which comes first */
const afterTests = (container: HTMLElement) => container.textContent!.slice(container.querySelector('[data-test-pipeline]')!.textContent!.length);

/** The 72-tick clock with its cause's part (the swings) taken away, as on the clocks of agricultural science 250 */
function withoutCausePart(view: ClockAlternativeView): ClockAlternativeView {
    const { swings: _swings, ...cause } = view.checkedLanes!.cause!;
    void _swings;
    return { ...view, checkedLanes: { ...view.checkedLanes!, cause } };
}

describe('the Diagnostics tab of a build of one copy', () => {
    const clocks = [
        ['misses swings with one inserter', rowView(NINE_APART_MISSES, 9, 'takt_batches_observed')],
        ['misses swings with two inserters', rowView(SIX_APART_MISSES, 6, 'takt_batches_observed')],
        ['holds', rowView(NINE_APART_HOLDS, 9, 'time_study_windows')],
    ] as const;

    it.each(clocks)('%s: no word about a copy in the tests, the pictures, the table, the labels or the tooltips', (_, clock) => {
        const { container } = show(<ClockDiagnostics clock={{ ...clock, insights: [] }} />, { names: gameNames });
        const details = container.querySelector('details') as HTMLDetailsElement | null;
        if (details) details.open = true;
        const labels = [...container.querySelectorAll('[aria-label]')].map(it => it.getAttribute('aria-label'));
        const tips = [...container.querySelectorAll('title')].map(it => it.textContent);
        expect([container.textContent, ...labels, ...tips].join('\n')).not.toMatch(/cop(y|ies)/i);
    });

    it('names the three tests for the clock alone, the inserters together and the loss of inputs', () => {
        const { container } = show(<ClockDiagnostics clock={{ ...clocks[0][1], insights: [] }} />, { names: gameNames });
        expect([...container.querySelectorAll('[data-test-pipeline] li')].map(it => it.querySelector('p')!.textContent)).toEqual(['Clock alone', 'Inserters together', 'Loss of inputs']);
    });
});

describe('the Diagnostics tab holds exactly what each clock has', () => {
    it('a clock with a cause and a cause part: the headline, both pictures, the other clock, "Read this as text", the table', () => {
        const view = viewOf(AUTOMATION_240, 'euclidean_swings');
        const { container } = show(<ClockDiagnostics clock={view} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['test-pipeline', 'cause-headline', 'picture copies', 'picture window-cycles', 'other-clock', 'read-as-text', 'table']);
        expect(afterTests(container).startsWith(view.checkedLanes!.cause!.headline.text)).toBe(true);
        expect(container.textContent).not.toContain('Made for');
    });

    it('a clock with a join cause: the same parts, in the same order', () => {
        const { container } = show(<ClockDiagnostics clock={viewOf(AUTOMATION_240, 'takt_batches_observed')} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['test-pipeline', 'cause-headline', 'picture copies', 'picture window-cycles', 'other-clock', 'read-as-text', 'table']);
    });

    it('a clock with a cause and no cause part: the headline, the copy-by-copy picture, the other clock, "Read this as text", the table', () => {
        const { container } = show(<ClockDiagnostics clock={withoutCausePart(viewOf(AUTOMATION_240, 'euclidean_swings'))} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['test-pipeline', 'cause-headline', 'picture copies', 'other-clock', 'read-as-text', 'table']);
        expect(container.textContent).toContain(MISSED_SWINGS_COPY.pictureOne);
    });

    it('a clock with no cause where every test passes: no line, the table open', () => {
        const { container } = show(<ClockDiagnostics clock={viewOf(AUTOMATION_240, 'time_study_windows')} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['test-pipeline', 'table']);
        expect(afterTests(container)).not.toContain(checkedOf(AUTOMATION_240, 'time_study_windows').line.sentence);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('a clock with no cause that drops into chests: the sentence of the chests, then the table', () => {
        const { container } = show(<ClockDiagnostics clock={viewOf(ELECTROMAGNETIC_330, 'takt_batches_observed')} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['test-pipeline', 'checked-line', 'table']);
        expect(afterTests(container).startsWith(checkedOf(ELECTROMAGNETIC_330, 'takt_batches_observed').line.output_chests_text!)).toBe(true);
    });

    it('a build of one copy: one sentence', () => {
        const one = { ...viewOf(AUTOMATION_240, 'time_study_windows'), copies: 1, checkedLanes: undefined };
        const { container } = show(<ClockDiagnostics clock={one} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['test-pipeline', 'checked-lanes']);
        expect(afterTests(container)).toBe('A build of one copy shares no lane.');
    });

    it('a clock with the note on why it is not stable: the note first, as the notes show it, then the table; no line, as one copy alone does not hold', async () => {
        const view = viewOf(MILITARY_240, 'takt_batches_observed_swings_4');
        const { container, user } = show(<ClockDiagnostics clock={view} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['test-pipeline', 'note unstable', 'table']);
        const note = container.querySelector<HTMLElement>('[data-insight="unstable"]')!;
        expect(within(note).getByRole('heading', { level: 3, name: 'This clock underproduces' })).toBeTruthy();
        // the other notes stay in Overview
        expect(container.querySelector('[data-insight="wake-ups"]')).toBeNull();
        const why = within(note).getByRole('button', { name: 'Why?' });
        expect(why.getAttribute('aria-expanded')).toBe('false');
        await user.click(why);
        expect(why.getAttribute('aria-expanded')).toBe('true');
    });
});

describe('the tests of the clock, first on the tab', () => {
    it.each([
        ['time_study_windows', ['passed', 'passed', 'passed']],
        ['takt_batches_observed', ['passed', 'failed', 'passed']],
        ['takt_batches_observed_swings_4', ['failed', 'not-run', 'not-run']],
        ['pitch_pickups', ['passed', 'passed', 'failed']],
    ] as const)('%s: three boxes in the ruled order, each with its state named for a screen reader, its result and one line', (id, states) => {
        const { container } = show(<ClockDiagnostics clock={viewOf(AUTOMATION_240, id)} />, { names: gameNames });
        const graphic = screen.getByRole('list', { name: 'Tests of this clock' });
        expect(container.querySelector('[data-diagnostics]')!.firstElementChild).toBe(graphic);
        const boxes = within(graphic).getAllByRole('listitem');
        expect(boxes.map(box => box.getAttribute('data-test'))).toEqual(['one-copy', 'all-copies', 'losses']);
        expect(boxes.map(box => box.getAttribute('data-test-state'))).toEqual(states);
        const named = { passed: 'Passed', failed: 'Failed', 'not-run': 'Not run' } as const;
        boxes.forEach((box, index) => {
            expect(within(box).getByRole('img', { name: named[states[index]] })).toBeTruthy();
            expect(box.querySelector('[data-test-result]')!.textContent).not.toBe('');
            expect(box.querySelector('[data-test-detail]')!.textContent).not.toBe('');
        });
    });

    it('box two says the rate against the target and nothing of swings, which the headline under it says', () => {
        const view = viewOf(AUTOMATION_240, 'takt_batches_observed');
        const { container } = show(<ClockDiagnostics clock={view} />, { names: gameNames });
        const two = container.querySelector('[data-test="all-copies"]')!;
        expect(two.textContent).toContain('Makes 234.07/s of 240/s');
        expect(two.textContent).not.toMatch(/swing/i);
        expect(container.textContent!.split(view.checkedLanes!.cause!.headline.text)).toHaveLength(2);
    });

    // the counts of the 72-tick clock on the sample's nine copies, as the engine gives them (2026-11-14)
    it('the loss of inputs of a clock that one trial breaks: a line with the count under its line, once on the tab; none on a clock that recovers', () => {
        const pitch = viewOf(AUTOMATION_240, 'pitch_pickups');
        const trial = pitch.assessment.disturbance_trial!;
        const counted = { ...pitch, assessment: { ...pitch.assessment, disturbance_trial: { ...trial, on_copies: { ...trial.on_copies!, trial_counts: [{
            loss: { kind: 'supply', items: ['copper-plate'] }, planned: 16, run: 13, recovered: 12, first_not_recovered: { cut_at: 0, loss_ticks: 1371, until_stopped: false } }] } } } } as ClockAlternativeView;
        const line = 'Recovers from 12 of 13 copper plate supply stops tried. Not from the stop at tick 0 for 1371 ticks.';
        const { container } = show(<ClockDiagnostics clock={counted} />, { names: gameNames });
        const losses = container.querySelector('[data-test="losses"]')!;
        expect([...losses.querySelectorAll('[data-test-count]')].map(it => it.textContent)).toEqual([line]);
        // under the result, before the line that says one copy alone recovers: the count is of the copies
        expect(losses.querySelector('[data-test-result]')!.nextElementSibling!.hasAttribute('data-test-count')).toBe(true);
        expect(losses.querySelector('[data-test-count]')!.nextElementSibling!.hasAttribute('data-test-detail')).toBe(true);
        expect(container.textContent!.split(line)).toHaveLength(2);
        cleanup();
        const stable = show(<ClockDiagnostics clock={viewOf(AUTOMATION_240, 'time_study_windows')} />, { names: gameNames });
        expect(stable.container.querySelector('[data-test-count]')).toBeNull();
    });
});

describe('the chart of a clock whose status is Oscillates, after the tests', () => {
    it('a bar for each window cycle, the two off it with their items above them, the expected output as a labelled line, and the numbers as text', () => {
        const view = oscillatingOf(viewOf(AUTOMATION_240, 'time_study_windows'));
        const { container } = show(<ClockDiagnostics clock={view} />, { names: gameNames });
        const figure = container.querySelector<HTMLElement>('[data-oscillation]')!;
        expect(container.querySelector('[data-test-pipeline]')!.nextElementSibling).toBe(figure);
        expect(figure.textContent).toContain('Output in each window cycle of the repeating run');
        const chart = within(figure).getByRole('img', { name: '26 bars, 288 items expected in each. Window cycle 2: 432 items. Window cycle 18: 144 items.' });
        expect(chart.querySelectorAll('[data-bar]')).toHaveLength(26);
        expect([...chart.querySelectorAll('[data-off]')].map(bar => bar.getAttribute('data-bar'))).toEqual(['2', '18']);
        // the items of the bars off it stand above them, and the expected output is said beside its line: never the colour alone
        expect([...chart.querySelectorAll('text')].map(text => text.textContent)).toEqual(expect.arrayContaining(['432', '144', '288 expected']));
        expect(figure.textContent).toContain('Red bars, with their items above them, are more than 16 items off the expected output. The output is of one copy.');
        const rows = within(figure.querySelector<HTMLElement>('[data-output-table]')!).getAllByRole('row');
        expect(rows).toHaveLength(27);
        expect(rows[2].textContent).toBe('2432+144');
        expect(rows[18].textContent).toBe('18144−144');
    });

    it('the first box says the status', () => {
        const { container } = show(<ClockDiagnostics clock={oscillatingOf(viewOf(AUTOMATION_240, 'time_study_windows'))} />, { names: gameNames });
        expect(container.querySelector('[data-test="one-copy"] [data-test-result]')!.textContent).toBe('Oscillates');
    });

    /** The engine's note on why a clock is not stable, of a clock whose long run makes the expected output on average */
    const doesNotHold = (what: string): ClockInsight => ({
        id: 'unstable', scope: 'clock', title: 'This clock does not hold the setpoint', what,
        why: 'A clock has to work from wherever the machines happen to be when it starts, so it is simulated from several start points.',
        explanation: 'Use a clock marked Stable.',
    });
    const MOVED = 'Driven only by its enable windows, the build moved 288 of 288 items a window cycle on average over a long run.';
    const oscillatingWith = (note: ClockInsight) => {
        const view = oscillatingOf(viewOf(AUTOMATION_240, 'time_study_windows'));
        return { ...view, insights: [...view.insights, note] };
    };

    it('the note on why it is not stable keeps its title and its Why?, without the sentence of the items moved', async () => {
        const { container, user } = show(<ClockDiagnostics clock={oscillatingWith(doesNotHold(MOVED))} />, { names: gameNames });
        const note = container.querySelector<HTMLElement>('[data-insight="unstable"]')!;
        expect(within(note).getByRole('heading', { level: 3, name: 'This clock does not hold the setpoint' })).toBeTruthy();
        expect(note.textContent).not.toContain('Driven only by its enable windows');
        expect(note.textContent).not.toContain('What');
        await user.click(within(note).getByRole('button', { name: 'Why?' }));
        expect(note.textContent).toContain('A clock has to work from wherever the machines happen to be when it starts');
        expect(note.textContent).toContain('Use a clock marked Stable.');
    });

    it('the note keeps what the engine says after the sentence of the items moved', () => {
        const repeats = 'The build repeats every 26 window cycles and moves 7488 of 7488 items over them.';
        const { container } = show(<ClockDiagnostics clock={oscillatingWith(doesNotHold(`${MOVED} ${repeats}`))} />, { names: gameNames });
        const note = container.querySelector<HTMLElement>('[data-insight="unstable"]')!;
        expect(note.textContent).not.toContain('Driven only by its enable windows');
        expect(note.textContent).toContain(`What${repeats}`);
    });

    it('a clock whose status is not Oscillates keeps the sentence of the items moved', () => {
        const view = viewOf(MILITARY_240, 'takt_batches_observed_swings_4');
        const { container } = show(<ClockDiagnostics clock={view} />, { names: gameNames });
        const engine = view.insights.find(insight => insight.id === 'unstable')!;
        expect(engine.what).toMatch(/^Driven only by its enable windows/);
        expect(container.querySelector('[data-insight="unstable"]')!.textContent).toContain(`What${engine.what}`);
    });

    it('no chart for a clock without the engine\'s reason', () => {
        const { container } = show(<ClockDiagnostics clock={viewOf(AUTOMATION_240, 'takt_batches_observed_swings_4')} />, { names: gameNames });
        expect(container.querySelector('[data-oscillation]')).toBeNull();
    });
});
