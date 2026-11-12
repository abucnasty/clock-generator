// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, viewsOf } from '../test/checkedLanesFixtures';
import { REASON_WORDS } from '../utils/clockSummary';
import { fullClockName } from '../utils/strategyNames';
import { ClockAlternativesPanel } from './ClockAlternativesPanel';

describe('the help of a clock in the list of clocks', () => {
    const views = viewsOf(AUTOMATION_240);
    const panel = () => show(<ClockAlternativesPanel comparison={{ allColumns: false, showUnstable: true }} onComparisonChange={() => {}}
        alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}} recommendedIndex={AUTOMATION_240.selected_index}
        pickRule={null} isGenerating={false} />);
    /** Opens the help of the clock with `id` and gives its text */
    const helpOf = async (id: string) => {
        const { user } = panel();
        const clock = views.find(view => view.id === id)!;
        await user.click(screen.getByRole('button', { name: `About ${fullClockName(clock)}` }));
        return { clock, text: (await screen.findByRole('dialog')).textContent ?? document.body.textContent! };
    };

    it.each(['euclidean_swings', 'takt_batches_observed'])('of %s, not stable on a shared lane, shows the headline of its cause, and no loss note', async id => {
        const { clock, text } = await helpOf(id);
        const cause = checkedOf(AUTOMATION_240, id).cause!;
        expect(text).toContain(cause.headline.text);
        // the parts are on the selected clock's card, once
        for (const part of [cause.where.text, cause.alone.text]) expect(text).not.toContain(part);
        expect(text).not.toContain(clock.sharedLaneLossNote!);
        expect(text).not.toMatch(/It is not stable on (a lane its copies share|its output belt)\./);
    });

    it('of a stable clock shows its description as the engine gives it, and no headline', async () => {
        const { clock, text } = await helpOf('time_study_windows');
        expect(text).toContain(clock.description.split('. ')[0]);
        expect(document.querySelector('[data-cause-headline]')).toBeNull();
    });
});

describe('the status of a clock that underproduces, in the list of clocks', () => {
    const views = viewsOf(AUTOMATION_240);
    const rowOf = (id: string) => {
        show(<ClockAlternativesPanel comparison={{ allColumns: false, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}} recommendedIndex={AUTOMATION_240.selected_index}
            pickRule={null} isGenerating={false} />);
        return within(screen.getByRole('radio', { name: fullClockName(views.find(view => view.id === id)!) }).closest('tr')!);
    };

    it('of the 72-tick clock: the chip and the words for its reason code', () => {
        const row = rowOf('euclidean_swings');
        expect(row.getAllByText('Underproduces').length).toBeGreaterThan(0);
        expect(row.getByText('Missed pickups due to belt gaps')).toBeTruthy();
    });

    it('of the 216-tick clock at a full join: the chip and the words for the code of a full join', () => {
        const row = rowOf('takt_batches_observed');
        expect(row.getAllByText('Underproduces').length).toBeGreaterThan(0);
        expect(row.getByText(REASON_WORDS.target_full)).toBeTruthy();
    });
});

describe('the status chip of every clock, in the list of clocks', () => {
    const views = viewsOf(AUTOMATION_240);
    const chipOf = (id: string) => {
        show(<ClockAlternativesPanel comparison={{ allColumns: false, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}} recommendedIndex={AUTOMATION_240.selected_index}
            pickRule={null} isGenerating={false} />);
        const row = screen.getByRole('radio', { name: fullClockName(views.find(view => view.id === id)!) }).closest('tr')!;
        return row.querySelector('[data-badge="status"]')!;
    };

    it('reads Stable on the stable clock, in the colour of a good state, beside the Recommended chip', () => {
        const chip = chipOf('time_study_windows');
        expect(chip.textContent).toBe('Stable');
        expect(chip.className).toMatch(/MuiChip-colorSuccess/);
        expect(within(chip.closest('tr')!).getByText('Recommended')).toBeTruthy();
    });

    it('keeps the warning colour on the chip of a clock that underproduces or has no recovery', () => {
        for (const id of ['euclidean_swings', 'pitch_pickups']) {
            const chip = chipOf(id);
            expect(chip.textContent).not.toBe('Stable');
            expect(chip.className).toMatch(/MuiChip-colorWarning/);
            cleanup();
        }
    });
});

describe('the status of a stable clock above the setpoint, in the full table', () => {
    // the time study windows clock made stable above the setpoint, as the engine ranks one (ranking.stable_above_target)
    const views = viewsOf(AUTOMATION_240).map(view => view.id !== 'time_study_windows' ? view : { ...view,
        assessment: { ...view.assessment, items_per_second: 252 }, ranking: { ...view.ranking, meets_target_rate: false, rate_off_target: 12, stable_above_target: true } });
    const clock = views.find(view => view.id === 'time_study_windows')!;

    it('reads Overproduces, with the rate beside the chip, in the colour of an unstable clock, never the stable one', () => {
        show(<ClockAlternativesPanel comparison={{ allColumns: true, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}} recommendedIndex={AUTOMATION_240.selected_index}
            pickRule={null} isGenerating={false} />);
        const row = within(screen.getByRole('radio', { name: fullClockName(clock) }).closest('tr')!);
        expect(row.getByText('makes 252/s of 240/s')).toBeTruthy();
        const chips = row.getAllByText('Overproduces').map(text => text.closest('.MuiChip-root')!);
        expect(chips.length).toBe(2);
        for (const chip of chips) expect(chip.className).not.toMatch(/MuiChip-colorSuccess/);
        expect(chips.some(chip => /MuiChip-colorError/.test(chip.className))).toBe(true);
    });
});
