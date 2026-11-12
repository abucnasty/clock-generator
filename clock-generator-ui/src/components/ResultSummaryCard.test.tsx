// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330_TWO_SWINGS, viewsOf } from '../test/checkedLanesFixtures';
import { ResultSummaryCard } from './ResultSummaryCard';

const card = (alternatives: ClockAlternativeView[], selectedIndex: number, more: Partial<Parameters<typeof ResultSummaryCard>[0]> = {}) => show(
    <ResultSummaryCard alternatives={alternatives} selectedIndex={selectedIndex} recommendedIndex={AUTOMATION_240.selected_index} onSelectRecommended={() => {}}
        isGenerating={false} rateWarning={null} stale={false} {...more} />);

/** A clock kept before the engine gave the build's lanes and what was checked on them */
const keptBefore = (view: ClockAlternativeView): ClockAlternativeView => {
    const { checkedLanes: _checked, ...rest } = view;
    void _checked;
    return { ...rest, assumptions: { ...view.assumptions, lanes: undefined } };
};

describe('the card of a clock', () => {
    const views = viewsOf(AUTOMATION_240);

    it('says what was checked on the shared lanes, without opening "How this was checked"', () => {
        const { container } = card(views, AUTOMATION_240.selected_index);
        const checked = container.querySelector('[data-checked-lanes]')!;
        expect(checked.closest('details')).toBeNull();
        expect(checked.textContent).toContain('Made for 9 copies of your build.');
        expect(checked.textContent).toContain(checkedOf(AUTOMATION_240, 'time_study_windows').line.sentence);
        expect(screen.getByRole('button', { name: 'What was checked' })).toBeTruthy();
    });

    it('kept before the engine gave the lanes opens as it did: no line, no table, no error', () => {
        const { container } = card(views.map(keptBefore), AUTOMATION_240.selected_index);
        expect(container.querySelector('[data-result-card]')).not.toBeNull();
        expect(container.querySelector('[data-checked-lanes]')).toBeNull();
        expect(screen.queryByRole('button', { name: 'What was checked' })).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
        expect(container.textContent).not.toContain('Made for 9 copies of your build.');
    });
});

describe('the note on why no clock is stable, of the recommended clock\'s loss on a shared lane', () => {
    const result = ELECTROMAGNETIC_330_TWO_SWINGS;
    const views = viewsOf(result);
    const cause = views[result.selected_index].checkedLanes!.cause!;
    const parts = [cause.headline.text, cause.cause!.text, cause.spacing!.text, cause.where.text, cause.alone.text, cause.changes!.text];
    const occurrences = (text: string, part: string) => text.split(part).length - 1;

    it('keeps its title and shows the parts in place of its message; the card below shows the table only', () => {
        const { container } = card(views, result.selected_index, { recommendedIndex: result.selected_index, whyNotStable: result.why_not_stable });
        const alert = container.querySelector('[data-why-not-stable]')!;
        expect(alert.textContent).toContain('Why no clock is stable: a copy gets too few items from a shared lane');
        expect(alert.textContent).not.toContain(result.why_not_stable!.message);
        const text = container.textContent!;
        // each part once on the card, in the note
        for (const part of parts) {
            expect(occurrences(text, part)).toBe(1);
            expect(alert.textContent).toContain(part);
        }
        // the loss note and the why-not-stable sentence of the same loss are not beside the parts
        expect(text).not.toContain(views[result.selected_index].sharedLaneLossNote!);
        expect(text).not.toContain('holds the setpoint on one copy, but not on a lane its copies share');
        expect(screen.getByRole('table', { name: 'Shared lanes' })).toBeTruthy();
    });

    it('shows its message as it is where the recommended clock has no cause', () => {
        const kept = views.map(view => ({ ...view, checkedLanes: undefined }));
        const { container } = card(kept, result.selected_index, { recommendedIndex: result.selected_index, whyNotStable: result.why_not_stable });
        expect(container.querySelector('[data-why-not-stable]')!.textContent).toContain(result.why_not_stable!.message);
    });
});

describe('the three clocks of automation science 240 say nothing twice', () => {
    const views = viewsOf(AUTOMATION_240);
    it.each(['time_study_windows', 'euclidean_swings', 'takt_batches_observed'])('%s: no loss note and no why-not-stable sentence beside the parts', id => {
        const index = views.findIndex(view => view.id === id);
        const { container } = card(views, index);
        const text = container.textContent!;
        const note = views[index].sharedLaneLossNote;
        if (note !== undefined) expect(text).not.toContain(note);
        expect(text).not.toMatch(/It is not stable on (a lane its copies share|its output belt)\.|holds the setpoint on one copy, but not/);
        const cause = views[index].checkedLanes!.cause;
        if (cause) for (const part of [cause.headline.text, cause.where.text, cause.alone.text]) expect(occurrences(text, part)).toBe(1);
    });
    const occurrences = (text: string, part: string) => text.split(part).length - 1;
});
