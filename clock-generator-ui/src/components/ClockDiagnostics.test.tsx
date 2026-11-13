// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { names, show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330, MILITARY_240, viewOf } from '../test/checkedLanesFixtures';
import { MISSED_SWINGS_COPY } from '../utils/missedSwings';
import { ClockDiagnostics } from './ClockDiagnostics';

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
});
