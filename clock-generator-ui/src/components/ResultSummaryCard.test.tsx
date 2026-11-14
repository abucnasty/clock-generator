// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330_TWO_SWINGS, errorCaseViews, MILITARY_240, TRIALS_NOT_MADE_REASON, viewsOf } from '../test/checkedLanesFixtures';
import { REASON_WORDS, SUMMARY_COPY } from '../utils/clockSummary';
import { cardWarningOf } from '../utils/rateWarning';
import { clockChipsOf } from '../utils/strategyNames';
import { strategyNameOf } from '../utils/strategyNames';
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

    it('says nothing of the copies it is made for (Makes says all 9 copies); what was checked on the lanes is on Diagnostics', () => {
        const { container } = card(views, AUTOMATION_240.selected_index, { onShowDiagnostics: () => {} });
        expect(container.querySelector('[data-made-for]')).toBeNull();
        expect(container.textContent).not.toContain('Made for 9 copies of your build.');
        expect(screen.getByText('Makes').parentElement!.textContent).toContain('all 9 copies');
        expect(container.textContent).not.toContain(checkedOf(AUTOMATION_240, 'time_study_windows').line.sentence);
        expect(screen.queryByRole('button', { name: 'What was checked' })).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
        // a stable clock with no cause and no note: no link
        expect(screen.queryByRole('button', { name: 'See diagnostics' })).toBeNull();
    });

    it('has four facts and no Belt pickups', () => {
        const { container } = card(views, AUTOMATION_240.selected_index);
        expect([...container.querySelectorAll('[data-summary-tile]')].map(tile => tile.getAttribute('data-summary-tile'))).toEqual(['Makes', 'Wakeups', 'Signals', 'Recovery']);
        expect(container.textContent).not.toContain('Belt pickups');
    });

    it('kept before the engine gave the lanes opens as it did: no line, no table, no error', () => {
        const { container } = card(views.map(keptBefore), AUTOMATION_240.selected_index);
        expect(container.querySelector('[data-result-card]')).not.toBeNull();
        expect(container.querySelector('[data-made-for]')).toBeNull();
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

    it('keeps its title and the count line in place of its message, and no link; the pictures and the other parts are not on the card', () => {
        const { container } = card(views, result.selected_index, { recommendedIndex: result.selected_index, whyNotStable: result.why_not_stable, onShowDiagnostics: () => {} });
        const alert = container.querySelector<HTMLElement>('[data-why-not-stable]')!;
        expect(alert.textContent).toBe('Why no clock is stable: a copy gets too few items from a shared lane' + cause.headline.text);
        expect(within(alert).queryByRole('button')).toBeNull();
        const text = container.textContent!;
        for (const part of parts.slice(1)) expect(text).not.toContain(part);
        expect(container.querySelectorAll('[data-picture], [data-other-clock], [data-read-as-text]')).toHaveLength(0);
        expect(text).not.toContain(result.why_not_stable!.message);
        expect(text).not.toContain(views[result.selected_index].sharedLaneLossNote!);
        expect(screen.queryByRole('table')).toBeNull();
        // the card's own link, on the selected clock's row
        expect(container.querySelectorAll('[data-see-diagnostics]')).toHaveLength(1);
        expect(alert.querySelector('[data-see-diagnostics]')).toBeNull();
    });

    it('keeps the recommended clock\'s count line while another clock is selected', () => {
        const other = views.findIndex((_, index) => index !== result.selected_index);
        const { container } = card(views, other, { recommendedIndex: result.selected_index, whyNotStable: result.why_not_stable });
        expect(container.querySelector('[data-why-not-stable] [data-cause-headline]')!.textContent).toBe(cause.headline.text);
    });

    it('shows its message as it is where the recommended clock has no cause', () => {
        const kept = views.map(view => ({ ...view, checkedLanes: undefined }));
        const { container } = card(kept, result.selected_index, { recommendedIndex: result.selected_index, whyNotStable: result.why_not_stable });
        expect(container.querySelector('[data-why-not-stable]')!.textContent).toContain(result.why_not_stable!.message);
    });
});

describe('the card holds nothing of what Diagnostics shows', () => {
    const views = viewsOf(AUTOMATION_240);
    const one = { ...views[AUTOMATION_240.selected_index], copies: 1, checkedLanes: undefined };
    const withoutPart = views.map(view => {
        if (view.id !== 'euclidean_swings') return view;
        const { swings: _swings, ...cause } = view.checkedLanes!.cause!;
        void _swings;
        return { ...view, checkedLanes: { ...view.checkedLanes!, cause } };
    });
    it.each([
        ['a lane cause', views, 'euclidean_swings', 9],
        ['a join cause', views, 'takt_batches_observed', 9],
        ['a cause with no cause part', withoutPart, 'euclidean_swings', 9],
        ['no cause', views, 'time_study_windows', 9],
        ['a note on why it is not stable', views, 'takt_batches_observed_swings_4', 9],
        ['a build of one copy', [one], 'time_study_windows', 1],
    ] as const)('%s: no made-for line, the chip as before; no headline, picture, line, table or note', (_, alternatives, id, copies) => {
        const list = alternatives as ClockAlternativeView[];
        const index = list.findIndex(view => view.id === id);
        const { container } = card(list, index, { onShowDiagnostics: () => {} });
        const clock = list[index];
        const text = container.textContent!;
        expect(container.querySelector('[data-made-for]')).toBeNull();
        expect(text).not.toContain(`Made for ${copies} ${copies === 1 ? 'copy' : 'copies'} of your build.`);
        expect(container.querySelector('[data-cause-headline], [data-picture], [data-checked-line], [data-read-as-text], [data-other-clock], [data-insight]')).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
        expect(screen.queryByRole('button', { name: 'What was checked' })).toBeNull();
        if (clock.checkedLanes) expect(text).not.toContain(clock.checkedLanes.line.sentence);
        if (clock.checkedLanes?.cause) expect(text).not.toContain(clock.checkedLanes.cause.headline.text);
        if (clock.sharedLaneLossNote !== undefined) expect(text).not.toContain(clock.sharedLaneLossNote);
        expect(text).not.toContain('A build of one copy shares no lane.');
        expect(text).not.toContain('This clock underproduces');
    });

    it('a clock that one trial breaks: no count of its trials, which only Diagnostics shows', () => {
        const index = views.findIndex(view => view.id === 'pitch_pickups');
        const pitch = views[index];
        const trial = pitch.assessment.disturbance_trial!;
        const counted = { ...pitch, assessment: { ...pitch.assessment, disturbance_trial: { ...trial, on_copies: { ...trial.on_copies!, trial_counts: [{
            loss: { kind: 'supply', items: ['copper-plate'] }, planned: 16, run: 13, recovered: 12, first_not_recovered: { cut_at: 0, loss_ticks: 1371, until_stopped: false } }] } } } } as ClockAlternativeView;
        const { container } = card(views.map((view, at) => at === index ? counted : view), index, { onShowDiagnostics: () => {} });
        expect(container.textContent).not.toMatch(/Recovers from \d+ of/);
        expect(container.textContent).not.toContain('1371 ticks');
    });
});

describe('the card\'s link to the Diagnostics tab', () => {
    const views = viewsOf(AUTOMATION_240);
    const military = viewsOf(MILITARY_240);
    it.each([
        ['a cause on a shared lane', views, 'euclidean_swings', true],
        ['a cause at a full join', views, 'takt_batches_observed', true],
        ['the note on why it is not stable', military, 'takt_batches_observed_swings_4', true],
        ['no cause and no note, no recovery', views, 'pitch_pickups', false],
        ['no cause and no note, stable', views, 'time_study_windows', false],
    ] as const)('on a clock with %s: %s', async (_, alternatives, id, shown) => {
        const onShowDiagnostics = vi.fn();
        const list = alternatives as ClockAlternativeView[];
        const index = list.findIndex(view => view.id === id);
        const { user } = card(list, index, { onShowDiagnostics, recommendedIndex: null });
        const link = screen.queryByRole('button', { name: 'See diagnostics' });
        expect(link !== null).toBe(shown);
        if (!link) return;
        // in the row of the name and the chip
        expect(screen.getByRole('heading', { level: 3, name: strategyNameOf(list[index]) }).parentElement!.contains(link)).toBe(true);
        await user.click(link);
        expect(onShowDiagnostics).toHaveBeenCalledTimes(1);
    });
});

describe('the status of a clock that underproduces, beside its name on the card', () => {
    const views = viewsOf(AUTOMATION_240);
    /** What stands beside the selected clock's name: the heading's row */
    const besideName = (alternatives: ClockAlternativeView[], id: string) => {
        const index = alternatives.findIndex(view => view.id === id);
        card(alternatives, index);
        return within(screen.getByRole('heading', { level: 3, name: strategyNameOf(alternatives[index]) }).parentElement!);
    };

    it('of the 72-tick clock: the chip Underproduces, and the words for the engine\'s reason code beside it', () => {
        expect(views.find(view => view.id === 'euclidean_swings')!.checkedLanes!.cause!.reason).toEqual({ code: 'belt_gaps', data: { missed: 6, with_gap: 3 } });
        const name = besideName(views, 'euclidean_swings');
        expect(name.getByText(SUMMARY_COPY.underproduces)).toBeTruthy();
        expect(name.getByText('Missed pickups due to belt gaps')).toBeTruthy();
    });

    it('of the 216-tick clock at a full join: the chip, and the words for the code of a full join beside it', () => {
        expect(views.find(view => view.id === 'takt_batches_observed')!.checkedLanes!.cause!.reason).toEqual({ code: 'target_full', data: { missed: 84, swings: 756 } });
        const name = besideName(views, 'takt_batches_observed');
        expect(name.getByText('Underproduces')).toBeTruthy();
        expect(name.getByText(REASON_WORDS.target_full)).toBeTruthy();
        expect(name.queryByText(REASON_WORDS.belt_gaps)).toBeNull();
    });

    it('of a clock unstable by another route: the chip, with the rate it makes off the setpoint, alone at it', () => {
        // a clock whose steady run does not hold, below the setpoint: Underproduces, and the rate beside it
        const off = besideName(views, 'takt_batches_observed_swings_4');
        expect(off.getByText('Underproduces')).toBeTruthy();
        expect(off.getByText('makes 180/s of 240/s')).toBeTruthy();
        expect(off.queryByText(REASON_WORDS.belt_gaps)).toBeNull();
        cleanup();
        const atTarget = views.map(view => view.id !== 'takt_batches_observed_swings_4' ? view
            : { ...view, ranking: { ...view.ranking, rate_off_target: 0 }, assessment: { ...view.assessment, items_per_second: 240 } });
        const name = besideName(atTarget, 'takt_batches_observed_swings_4');
        expect(name.getByText('Underproduces')).toBeTruthy();
        expect(name.queryByText(REASON_WORDS.belt_gaps)).toBeNull();
    });

    it('of a kept result whose cause has no reason: the chip, no reason, no error', () => {
        const kept = views.map(view => {
            if (!view.checkedLanes?.cause) return view;
            const { reason: _reason, ...cause } = view.checkedLanes.cause;
            void _reason;
            return { ...view, checkedLanes: { ...view.checkedLanes, cause } };
        });
        const name = besideName(kept, 'euclidean_swings');
        expect(name.getByText('Underproduces')).toBeTruthy();
        expect(name.queryByText(REASON_WORDS.belt_gaps)).toBeNull();
    });
});

describe('the card\'s belt sentence, in Simulation results', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = AUTOMATION_240.selected_index;

    it('says that no inserter on the clock picks up from a belt where none does, and says nothing of a belt where one does', () => {
        const { container } = card(views.map((view, at) => at !== index ? view : { ...view, beltLabel: '', belt: undefined }), index);
        expect(container.querySelector('[data-belt-line]')!.textContent).toBe('No inserter on the clock picks up from a belt.');
        cleanup();
        const { container: picks } = card(views, index);
        expect(views[index].beltLabel).toBe('backed-up');
        expect(picks.querySelector('[data-belt-line]')).toBeNull();
        expect(picks.textContent).not.toMatch(/Made for (moving|backed-up) belts/);
    });
});

describe('the status Error beside the name on the card, where the loss trials gave no answer', () => {
    it.each<[Parameters<typeof errorCaseViews>[0], string]>([
        ['not-tried', TRIALS_NOT_MADE_REASON],
        ['baseline-missed', SUMMARY_COPY.errorBaselineMissed],
        ['no-result', SUMMARY_COPY.errorNoResult],
    ])('%s: the chip Error, in the red of a failed check, and its reason beside it', (kind, reason) => {
        const alternatives = errorCaseViews(kind);
        card(alternatives, AUTOMATION_240.selected_index);
        const name = within(screen.getByRole('heading', { level: 3, name: strategyNameOf(alternatives[AUTOMATION_240.selected_index]) }).parentElement!);
        const chip = name.getByText('Error').closest('.MuiChip-root')!;
        expect(chip.getAttribute('data-badge')).toBe('status');
        expect(chip.className).toMatch(/MuiChip-colorError/);
        expect(name.getByText(reason)).toBeTruthy();
        // the Recovery fact keeps its own word
        expect(screen.getByText('Unavailable')).toBeTruthy();
    });
});

describe('the rate of a clock with a loss on a shared lane, on the card: what all the copies made together', () => {
    const views = viewsOf(AUTOMATION_240);
    const indexOf = (alternatives: ClockAlternativeView[], id: string) => alternatives.findIndex(view => view.id === id);
    /** The Makes fact's text, the hold sentence (gone: the Diagnostics tab's tests say it) and the reason of the clock with `id` */
    const factsOf = (alternatives: ClockAlternativeView[], id: string) => {
        const { container } = card(alternatives, indexOf(alternatives, id));
        const label = screen.getByText('Makes');
        return { makes: label.parentElement!.textContent, hold: container.querySelector('[data-hold-status]'), reason: container.querySelector('[data-card-reason]')?.textContent,
            text: container.textContent! };
    };

    it('of the 216-tick clock: Makes 234.07/s for all 9 copies, how it differs says the same; no hold sentence', () => {
        const { makes, hold, reason, text } = factsOf(views, 'takt_batches_observed');
        expect(makes).toContain('234.07/s');
        expect(makes).toContain('all 9 copies');
        expect(makes).not.toContain('240/s');
        expect(hold).toBeNull();
        expect(text).not.toContain('At steady state');
        expect(reason).toContain(SUMMARY_COPY.differsRate('234.07', '240'));
    });

    it('of the stable clock and of the clock with no recovery: Makes 240/s; no hold sentence and no recovery sentence', () => {
        const { makes, hold, text } = factsOf(views, 'time_study_windows');
        expect(makes).toContain('240/s');
        expect(hold).toBeNull();
        expect(text).not.toContain('At steady state');
        expect(text).not.toContain(SUMMARY_COPY.recoversYesDetail);
        cleanup();
        expect(factsOf(views, 'pitch_pickups').hold).toBeNull();
    });

    it('of a clock of an older result without the rate of the copies: Makes 240/s, as before', () => {
        const older = views.map(view => ({ ...view, checkedLanes: view.checkedLanes && { ...view.checkedLanes, copies_made: undefined } }));
        const { makes, hold, reason } = factsOf(older, 'takt_batches_observed');
        expect(makes).toContain('240/s');
        expect(hold).toBeNull();
        expect(reason).toContain(SUMMARY_COPY.differsUnderproduces);
    });

    it('of the recommended clock of electromagnetic science 330 with 2 swings: Makes 318.79/s, and its reason says it', () => {
        const result = ELECTROMAGNETIC_330_TWO_SWINGS;
        const ems = viewsOf(result);
        const { container } = card(ems, result.selected_index, { recommendedIndex: result.selected_index, whyNotStable: result.why_not_stable });
        expect(screen.getByText('Makes').parentElement!.textContent).toContain('318.79/s');
        expect(container.querySelector('[data-card-reason]')!.textContent).toContain('This one runs at 318.79/s with the fewest wakeups.');
        expect(container.querySelector('[data-hold-status]')).toBeNull();
    });
});

describe('the chips beside the name on the card', () => {
    const views = viewsOf(AUTOMATION_240);
    it('keep the clock\'s settings and leave how its windows were made to the compare table, the selector and the install dialog', () => {
        const index = views.findIndex(view => view.id === 'takt_batches_observed');
        const { container } = card(views, index);
        const shown = [...container.querySelectorAll('[data-strategy-chip]')].map(chip => chip.getAttribute('data-strategy-chip'));
        const all = clockChipsOf(views[index]).map(chip => chip.id);
        expect(all).toContain('tuning_method');
        expect(all).toContain('selection');
        expect(shown).toEqual(all.filter(id => id !== 'tuning_method' && id !== 'selection'));
        expect(shown.length).toBeGreaterThan(0);
        expect(container.textContent).not.toMatch(/· (observed|calculated|one version|best of several versions|found by search)/);
    });
});

describe('the recovery sentence under the facts', () => {
    const index = AUTOMATION_240.selected_index;
    it.each(['not-tried', 'no-result'] as const)('%s, with the rate warning the page gives: not on an Error card, whose reason beside the chip says it', (kind) => {
        const alternatives = errorCaseViews(kind);
        const { container } = card(alternatives, index, { rateWarning: cardWarningOf(alternatives[index]) });
        expect(cardWarningOf(alternatives[index])).toBeNull();
        expect(screen.getByText('Error')).toBeTruthy();
        expect(screen.getByText('Unavailable')).toBeTruthy();
        expect(container.querySelector('[data-recovery-detail]')).toBeNull();
        expect(container.textContent).not.toContain(SUMMARY_COPY.recoversNotTestedDetail);
        expect(container.textContent).not.toContain('Recovery could not be tried in the simulator');
    });

    it('stays on a clock with another status: the 216-tick clock with its loss trials not run reads Underproduces and keeps it', () => {
        const views = viewsOf(AUTOMATION_240).map(view => view.id !== 'takt_batches_observed' ? view
            : { ...view, assessment: { ...view.assessment, disturbance_trial: null, disturbance_trial_not_tried: TRIALS_NOT_MADE_REASON } });
        const at = views.findIndex(view => view.id === 'takt_batches_observed');
        const { container } = card(views, at, { rateWarning: cardWarningOf(views[at]) });
        expect(cardWarningOf(views[at])).toBeNull();
        expect(screen.getByText('Underproduces')).toBeTruthy();
        expect(container.querySelector('[data-recovery-detail]')!.textContent).toBe(SUMMARY_COPY.recoversNotTriedDetail(TRIALS_NOT_MADE_REASON));
    });
});

describe('the fold Simulation results', () => {
    const views = viewsOf(AUTOMATION_240);
    const index = AUTOMATION_240.selected_index;
    const fold = (container: HTMLElement) => [...container.querySelectorAll('summary')].find(summary => summary.textContent === 'Simulation results');

    it('holds the reason this clock is the pick and what the run assumed; no test sentence', () => {
        const { container } = card(views, index, { runAssumptions: <p data-result-assumptions="">The simulation assumes backpressure at the belt pickups.</p> });
        const details = fold(container)!.parentElement!;
        expect(details.querySelector('[data-card-reason]')).not.toBeNull();
        expect(details.textContent).toContain('The simulation assumes backpressure at the belt pickups.');
        for (const gone of ['At steady state', SUMMARY_COPY.recoversYesDetail, 'Tested in the simulator', 'The blueprint needs Factorio']) expect(details.textContent).not.toContain(gone);
    });

    it('is not drawn where it has no line left: no pick to give a reason, no assumption, a belt pickup', () => {
        const { container } = card(views, index, { recommendedIndex: null });
        expect(views[index].beltLabel).not.toBe('');
        expect(fold(container)).toBeUndefined();
        cleanup();
        const { container: belt } = card(views.map((view, at) => at !== index ? view : { ...view, beltLabel: '', belt: undefined }), index, { recommendedIndex: null });
        expect(fold(belt)).toBeDefined();
        expect(belt.querySelector('[data-belt-line]')).not.toBeNull();
    });
});
