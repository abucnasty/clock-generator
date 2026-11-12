// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330_TWO_SWINGS, errorCaseViews, TRIALS_NOT_MADE_REASON, viewsOf } from '../test/checkedLanesFixtures';
import { REASON_WORDS, SUMMARY_COPY } from '../utils/clockSummary';
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

describe('the status of every clock, in the list of clocks: the Status column, no chip', () => {
    const views = viewsOf(AUTOMATION_240);
    const panel = (alternatives = views, allColumns = false) => show(<ClockAlternativesPanel comparison={{ allColumns, showUnstable: true }} onComparisonChange={() => {}}
        alternatives={alternatives} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}} recommendedIndex={AUTOMATION_240.selected_index}
        pickRule={null} isGenerating={false} />);
    /** The row of the clock with `id`: its cells' text, and whether a status chip stands in it */
    const rowOf = (id: string, alternatives = views) => {
        const row = screen.getByRole('radio', { name: fullClockName(alternatives.find(view => view.id === id)!) }).closest('tr')!;
        return { row, cells: [...row.querySelectorAll('td')].map(cell => cell.textContent), chip: row.querySelector('[data-badge="status"]'),
            detail: row.querySelector('[data-status-detail]')?.textContent ?? null };
    };

    it('says Stable in the Status column of the stable clock, with no chip, beside the Recommended chip', () => {
        panel();
        const { row, cells, chip } = rowOf('time_study_windows');
        expect(chip).toBeNull();
        expect(cells.at(-1)).toBe('Stable');
        expect(within(row).getByText('Recommended')).toBeTruthy();
    });

    it('says Underproduces and No recovery in the column, and keeps the line under the name', () => {
        panel();
        const short = rowOf('euclidean_swings');
        expect([short.chip, short.cells.at(-1), short.detail]).toEqual([null, 'Underproduces', 'Missed pickups due to belt gaps']);
        const none = rowOf('pitch_pickups');
        expect([none.chip, none.cells.at(-1), none.detail]).toEqual([null, 'No recovery', null]);
        const off = rowOf('takt_batches_observed_swings_4');
        expect([off.cells.at(-1), off.detail]).toEqual(['Underproduces', 'makes 180/s of 240/s']);
    });

    it('keeps the chips that are not a status: Fewest wakeups and Fewest deciders', () => {
        panel();
        const chips = [...document.querySelectorAll('[data-badge]')].map(chip => chip.getAttribute('data-badge'));
        expect(chips).not.toContain('status');
    });

    it.each<[Parameters<typeof errorCaseViews>[0], string]>([
        ['not-tried', TRIALS_NOT_MADE_REASON],
        ['baseline-missed', SUMMARY_COPY.errorBaselineMissed],
        ['no-result', SUMMARY_COPY.errorNoResult],
    ])('says Error of a clock whose recovery trials gave no answer (%s), with the reason as the line under its name', (kind, reason) => {
        const alternatives = errorCaseViews(kind);
        panel(alternatives);
        const { cells, chip, detail } = rowOf('time_study_windows', alternatives);
        expect([chip, cells.at(-1), detail]).toEqual([null, 'Error', reason]);
        cleanup();
        // the full table's Status says the same word, in the red of a failed check
        panel(alternatives, true);
        const full = rowOf('time_study_windows', alternatives);
        expect(full.cells.at(-1)).toBe('Error');
        expect(full.row.querySelector('td:last-child .MuiChip-root')!.className).toMatch(/MuiChip-colorError/);
    });

    it.each([false, true])('names the column Status, with a help that names each status once (all columns: %s)', async allColumns => {
        const { user } = panel(views, allColumns);
        expect(screen.queryByRole('columnheader', { name: /Works\?/ })).toBeNull();
        const header = screen.getAllByRole('columnheader').find(cell => cell.textContent === 'Status')!;
        await user.click(within(header).getByRole('button', { name: 'About Status' }));
        const help = (await screen.findByRole('dialog')).textContent!;
        for (const word of ['Stable', 'Underproduces', 'Overproduces', 'No recovery', 'Error', 'Start-dependent']) {
            expect(help.split(word).length - 1, word).toBe(1);
        }
    });

    it('says in the full table the word of the Status column, Stable in place of "Recovery: Yes"', () => {
        panel(views, true);
        const { cells } = rowOf('time_study_windows');
        expect(cells.at(-1)).toBe('Stable');
        expect(document.body.textContent).not.toContain('Recovery: Yes');
    });
});

describe('the status of a stable clock above the setpoint, in the full table', () => {
    // the time study windows clock made stable above the setpoint, as the engine ranks one (ranking.stable_above_target)
    const views = viewsOf(AUTOMATION_240).map(view => view.id !== 'time_study_windows' ? view : { ...view,
        assessment: { ...view.assessment, items_per_second: 252 }, ranking: { ...view.ranking, meets_target_rate: false, rate_off_target: 12, stable_above_target: true } });
    const clock = views.find(view => view.id === 'time_study_windows')!;

    it('reads Overproduces in its Status, with the rate as the line under its name, in the colour of an unstable clock', () => {
        show(<ClockAlternativesPanel comparison={{ allColumns: true, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}} recommendedIndex={AUTOMATION_240.selected_index}
            pickRule={null} isGenerating={false} />);
        const row = within(screen.getByRole('radio', { name: fullClockName(clock) }).closest('tr')!);
        expect(row.getByText('makes 252/s of 240/s')).toBeTruthy();
        // the full table's Status chip only: the status chip has left the row
        const chips = row.getAllByText('Overproduces').map(text => text.closest('.MuiChip-root')!);
        expect(chips.length).toBe(1);
        expect(chips[0].className).toMatch(/MuiChip-colorError/);
    });
});

describe('the rate of a clock with a loss on a shared lane, in the list of clocks: what all the copies made together', () => {
    const views = viewsOf(AUTOMATION_240);
    /** The table's cells of the row of the clock with `id`, as their text */
    const cellsOf = (alternatives: typeof views, id: string, allColumns: boolean, selectedIndex = AUTOMATION_240.selected_index) => {
        show(<ClockAlternativesPanel comparison={{ allColumns, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={alternatives} selectedIndex={selectedIndex} onSelect={() => {}} recommendedIndex={selectedIndex}
            pickRule={null} isGenerating={false} />);
        const row = screen.getByRole('radio', { name: fullClockName(alternatives.find(view => view.id === id)!) }).closest('tr')!;
        return [...row.querySelectorAll('td')].map(cell => cell.textContent);
    };
    const older = views.map(view => ({ ...view, checkedLanes: view.checkedLanes && { ...view.checkedLanes, copies_made: undefined } }));

    it('in the Makes column: 234.07 on the 216-tick clock, 238.77 on the 72-tick one, 240 on the stable one', () => {
        expect(cellsOf(views, 'takt_batches_observed', false)).toContain('234.07');
        cleanup();
        expect(cellsOf(views, 'euclidean_swings', false)).toContain('238.77');
        cleanup();
        expect(cellsOf(views, 'time_study_windows', false)).toContain('240');
    });

    it('in the full table\'s rate column: 234.07 on the 216-tick clock, 240.00 on the stable one', () => {
        expect(cellsOf(views, 'takt_batches_observed', true)).toContain('234.07');
        cleanup();
        expect(cellsOf(views, 'time_study_windows', true)).toContain('240.00');
    });

    it('in an older result without the rate of the copies: the clock-only rate, as before', () => {
        expect(cellsOf(older, 'takt_batches_observed', false)).toContain('240');
        cleanup();
        expect(cellsOf(older, 'takt_batches_observed', true)).toContain('240.00');
    });

    it('keeps clocks with different rates out of the folded line: electromagnetic science 330 with 2 swings', () => {
        const ems = viewsOf(ELECTROMAGNETIC_330_TWO_SWINGS);
        const { container } = show(<ClockAlternativesPanel comparison={{ allColumns: false, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={ems} selectedIndex={ELECTROMAGNETIC_330_TWO_SWINGS.selected_index} onSelect={() => {}} recommendedIndex={ELECTROMAGNETIC_330_TWO_SWINGS.selected_index}
            pickRule={null} isGenerating={false} />);
        expect(container.querySelector('[data-makes-fold]')).toBeNull();
        expect(container.textContent).toContain('318.79');
        expect(container.textContent).toContain('322.42');
        cleanup();
        // an older result of the same build folds them as before
        const folded = show(<ClockAlternativesPanel comparison={{ allColumns: false, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={ems.map(view => ({ ...view, checkedLanes: { ...view.checkedLanes!, copies_made: undefined } }))}
            selectedIndex={ELECTROMAGNETIC_330_TWO_SWINGS.selected_index} onSelect={() => {}} recommendedIndex={ELECTROMAGNETIC_330_TWO_SWINGS.selected_index}
            pickRule={null} isGenerating={false} />);
        expect(folded.container.querySelector('[data-makes-fold]')!.textContent).toBe('All 6 clocks make 330/s.');
    });
});

describe('the full table of clocks', () => {
    it('has no Belt column and no help for one', () => {
        const views = viewsOf(AUTOMATION_240);
        show(<ClockAlternativesPanel comparison={{ allColumns: true, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}} recommendedIndex={AUTOMATION_240.selected_index}
            pickRule={null} isGenerating={false} />);
        const headers = screen.getAllByRole('columnheader').map(it => it.textContent);
        expect(headers).toHaveLength(11);
        expect(headers.some(header => /belt/i.test(header ?? ''))).toBe(false);
        expect(screen.queryByRole('button', { name: /belt/i })).toBeNull();
        const firstRow = screen.getAllByRole('row').find(row => within(row).queryByRole('radio'))!;
        expect(within(firstRow).getAllByRole('cell').concat(within(firstRow).queryAllByRole('rowheader'))).toHaveLength(11);
    });
});
