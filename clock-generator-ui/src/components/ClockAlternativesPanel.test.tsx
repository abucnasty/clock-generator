// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, viewsOf } from '../test/checkedLanesFixtures';
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

    it('of the 216-tick clock at a full join: the chip and no reason', () => {
        const row = rowOf('takt_batches_observed');
        expect(row.getAllByText('Underproduces').length).toBeGreaterThan(0);
        expect(row.queryByText('Missed pickups due to belt gaps')).toBeNull();
    });
});
