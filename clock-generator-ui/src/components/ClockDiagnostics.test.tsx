// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { names, show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, MILITARY_240, viewOf } from '../test/checkedLanesFixtures';
import { MISSED_SWINGS_COPY } from '../utils/missedSwings';
import { ClockDiagnostics } from './ClockDiagnostics';

const gameNames = names({ 'iron-gear-wheel': 'Iron gear wheel', 'copper-plate': 'Copper plate', 'automation-science-pack': 'Automation science pack',
    'military-science-pack': 'Military science pack', 'stone-wall': 'Stone wall', 'piercing-rounds-magazine': 'Piercing rounds magazine', 'iron-plate': 'Iron plate' });

/** What the tab holds, by the marks of its parts, in the page's order */
const PARTS = '[data-insight], [data-cause-headline], [data-picture], [data-other-clock], [data-read-as-text], [data-checked-line], [data-lanes-sentence], table';
const partsOf = (container: HTMLElement) => [...container.querySelectorAll(PARTS)].map(part =>
    part.tagName === 'TABLE' ? 'table'
        : part.hasAttribute('data-picture') ? `picture ${part.getAttribute('data-picture')}`
            : part.hasAttribute('data-insight') ? `note ${part.getAttribute('data-insight')}`
                : [...part.attributes].map(it => it.name).find(name => name.startsWith('data-'))!.slice('data-'.length));

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
        expect(partsOf(container)).toEqual(['cause-headline', 'picture copies', 'picture window-cycles', 'other-clock', 'read-as-text', 'table']);
        expect(container.textContent!.startsWith(view.checkedLanes!.cause!.headline.text)).toBe(true);
        expect(container.textContent).not.toContain('Made for');
    });

    it('a clock with a join cause: the same parts, in the same order', () => {
        const { container } = show(<ClockDiagnostics clock={viewOf(AUTOMATION_240, 'takt_batches_observed')} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['cause-headline', 'picture copies', 'picture window-cycles', 'other-clock', 'read-as-text', 'table']);
    });

    it('a clock with a cause and no cause part: the headline, the copy-by-copy picture, the other clock, "Read this as text", the table', () => {
        const { container } = show(<ClockDiagnostics clock={withoutCausePart(viewOf(AUTOMATION_240, 'euclidean_swings'))} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['cause-headline', 'picture copies', 'other-clock', 'read-as-text', 'table']);
        expect(container.textContent).toContain(MISSED_SWINGS_COPY.pictureOne);
    });

    it('a clock with no cause: the engine\'s line and the table, open', () => {
        const { container } = show(<ClockDiagnostics clock={viewOf(AUTOMATION_240, 'time_study_windows')} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['checked-line', 'table']);
        expect(container.textContent!.startsWith(checkedOf(AUTOMATION_240, 'time_study_windows').line.sentence)).toBe(true);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('a build of one copy: one sentence', () => {
        const one = { ...viewOf(AUTOMATION_240, 'time_study_windows'), copies: 1, checkedLanes: undefined };
        const { container } = show(<ClockDiagnostics clock={one} />, { names: gameNames });
        expect(container.textContent).toBe('A build of one copy shares no lane.');
    });

    it('a clock with the note on why it is not stable: the note first, as the notes show it, then the line and the table', async () => {
        const view = viewOf(MILITARY_240, 'takt_batches_observed_swings_4');
        const { container, user } = show(<ClockDiagnostics clock={view} />, { names: gameNames });
        expect(partsOf(container)).toEqual(['note unstable', 'checked-line', 'table']);
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
