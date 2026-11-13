// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330, ELECTROMAGNETIC_330_TWO_SWINGS, errorCaseViews, MILITARY_240, TRIALS_NOT_MADE_REASON, viewsOf } from '../test/checkedLanesFixtures';
import { REASON_WORDS, SUMMARY_COPY } from '../utils/clockSummary';
import { RECOMMENDED_COPY, rankOrderOf } from '../utils/recommendedClock';
import { familyCopyOf, fullClockName, strategyNameOf } from '../utils/strategyNames';
import type { ClockAlternativeView } from '../worker/types';
import { ClockAlternativesPanel } from './ClockAlternativesPanel';

describe('the help of a clock in the list of clocks', () => {
    const views = viewsOf(AUTOMATION_240);
    const panel = () => show(<ClockAlternativesPanel comparison={{ allColumns: false, showUnstable: true }} onComparisonChange={() => {}}
        alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}}
        pickRule={null} />);
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
            alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}}            pickRule={null} />);
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
        alternatives={alternatives} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}}
        pickRule={null} />);
    /** The row of the clock with `id`: its cells' text, and whether a status chip stands in it */
    const rowOf = (id: string, alternatives = views) => {
        const row = screen.getByRole('radio', { name: fullClockName(alternatives.find(view => view.id === id)!) }).closest('tr')!;
        return { row, cells: [...row.querySelectorAll('td')].map(cell => cell.textContent), chip: row.querySelector('[data-badge="status"]'),
            detail: row.querySelector('[data-status-detail]')?.textContent ?? null };
    };

    it('says Stable in the Status column of the stable clock, with no chip, and its rank 1 in bold in the Rank column', () => {
        panel();
        const { row, cells, chip } = rowOf('time_study_windows');
        expect(chip).toBeNull();
        expect(cells.at(-1)).toBe('Stable');
        expect(cells[0]).toBe('1');
        expect(getComputedStyle(row.querySelector('[data-rank]')!).fontWeight).toBe('700');
        expect(within(row).queryByText('Recommended')).toBeNull();
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

    it('has no chip beside a name: no Recommended, Fewest wakeups or Fewest deciders, in either table', () => {
        for (const allColumns of [false, true]) {
            const { container } = panel(views, allColumns);
            expect(container.querySelectorAll('[data-badge], [data-card-chip]')).toHaveLength(0);
            for (const words of ['Recommended', 'Best so far', 'Fewest wakeups', 'Fewest deciders']) expect(container.textContent).not.toContain(words);
            cleanup();
        }
    });

    it.each<[Parameters<typeof errorCaseViews>[0], string]>([
        ['not-tried', TRIALS_NOT_MADE_REASON],
        ['baseline-missed', SUMMARY_COPY.errorBaselineMissed],
        ['no-result', SUMMARY_COPY.errorNoResult],
    ])('says Error of a clock whose loss trials gave no answer (%s), with the reason as the line under its name', (kind, reason) => {
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

    it.each([false, true])('names the column Status, with a help that names each status once, then how the clocks are checked (all columns: %s)', async allColumns => {
        const { user } = panel(views, allColumns);
        expect(screen.queryByRole('columnheader', { name: /Works\?/ })).toBeNull();
        const header = screen.getAllByRole('columnheader').find(cell => cell.textContent === 'Status')!;
        await user.click(within(header).getByRole('button', { name: 'About Status' }));
        const help = (await screen.findByRole('dialog')).textContent!;
        for (const word of ['Stable', 'Underproduces', 'Overproduces', 'Oscillates', 'No recovery', 'Error', 'Start-dependent']) {
            expect(help.split(word).length - 1, word).toBe(1);
        }
        expect(help.endsWith(SUMMARY_COPY.statusChecks)).toBe(true);
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
            alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}}            pickRule={null} />);
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
            alternatives={alternatives} selectedIndex={selectedIndex} onSelect={() => {}}            pickRule={null} />);
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
            alternatives={ems} selectedIndex={ELECTROMAGNETIC_330_TWO_SWINGS.selected_index} onSelect={() => {}}            pickRule={null} />);
        expect(container.querySelector('[data-makes-fold]')).toBeNull();
        expect(container.textContent).toContain('318.79');
        expect(container.textContent).toContain('322.42');
        cleanup();
        // an older result of the same build folds them as before
        const folded = show(<ClockAlternativesPanel comparison={{ allColumns: false, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={ems.map(view => ({ ...view, checkedLanes: { ...view.checkedLanes!, copies_made: undefined } }))}
            selectedIndex={ELECTROMAGNETIC_330_TWO_SWINGS.selected_index} onSelect={() => {}}            pickRule={null} />);
        expect(folded.container.querySelector('[data-makes-fold]')!.textContent).toBe('All 6 clocks make 330/s.');
    });
});

describe('the Rank column: the engine\'s order', () => {
    const SAMPLES = { AUTOMATION_240, ELECTROMAGNETIC_330, ELECTROMAGNETIC_330_TWO_SWINGS, MILITARY_240 };
    type Options = { allColumns?: boolean; showUnstable?: boolean; pending?: string[]; running?: boolean };
    const panelOf = (alternatives: ClockAlternativeView[], selectedIndex: number, options: Options = {}) =>
        <ClockAlternativesPanel comparison={{ allColumns: options.allColumns ?? false, showUnstable: options.showUnstable ?? true }} onComparisonChange={() => {}}
            alternatives={alternatives} selectedIndex={selectedIndex} onSelect={() => {}} pickRule={null} pending={options.pending} running={options.running} />;
    const panel = (alternatives: ClockAlternativeView[], selectedIndex: number, options: Options = {}) => show(panelOf(alternatives, selectedIndex, options));
    /** The rows of clocks from the top, each its rank and the id of its clock */
    const rowsOf = (alternatives: ClockAlternativeView[]) => screen.getAllByRole('radio').map(radio => {
        const row = radio.closest('tr')!;
        return [row.querySelector('[data-rank]')!.textContent, alternatives.find(view => fullClockName(view) === radio.getAttribute('aria-label'))!.id];
    });

    it.each(Object.entries(SAMPLES))('numbers the rows of %s 1 to the last straight through both groups, in the engine\'s order, rank 1 its recommended clock', (_, result) => {
        const views = viewsOf(result);
        panel(views, result.selected_index);
        const order = rankOrderOf(views);
        expect(rowsOf(views)).toEqual(order.map((index, at) => [`${at + 1}`, views[index].id]));
        // the engine's recommended clock of the whole generation is rank 1
        expect(views[order[0]].id).toBe(result.clocks[result.selected_index].id);
    });

    it('heads the column Rank, with a help that lists the six keys in order, the tie, rank 1 and whether the slower searches ran', async () => {
        const views = viewsOf(AUTOMATION_240);
        const { user } = show(<ClockAlternativesPanel comparison={{ allColumns: false, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={views} selectedIndex={0} onSelect={() => {}} pickRule={{ searchedForFewerWakeUps: true }} />);
        const header = screen.getAllByRole('columnheader')[0];
        expect(header.textContent).toBe('Rank');
        await user.click(within(header).getByRole('button', { name: 'About Rank' }));
        const help = await screen.findByRole('dialog');
        expect(within(help).getAllByRole('listitem').map(item => item.textContent)).toEqual(RECOMMENDED_COPY.rankKeys);
        expect(help.textContent).toBe([RECOMMENDED_COPY.rankLead, ...RECOMMENDED_COPY.rankKeys, RECOMMENDED_COPY.rankTie, RECOMMENDED_COPY.rankFirst,
            RECOMMENDED_COPY.runSearched].join(''));
    });

    it('has no "How clocks are chosen" fold: its words are in the two helps', () => {
        const { container } = panel(viewsOf(AUTOMATION_240), 0);
        expect(container.textContent).not.toContain('How clocks are chosen');
        expect(container.querySelector('.MuiAccordion-root')).toBeNull();
    });

    it('puts each clock\'s help on the line of its name, and nothing on a line of its own under it', () => {
        const views = viewsOf(AUTOMATION_240);
        panel(views, 0);
        for (const view of views) {
            const line = screen.getByRole('radio', { name: fullClockName(view) }).closest('tr')!.querySelector('[data-name-line]')!;
            const help = within(line as HTMLElement).getByRole('button', { name: `About ${fullClockName(view)}` });
            expect(line.textContent!.startsWith(strategyNameOf(view))).toBe(true);
            // the (?) and the last chip in one span that does not wrap, so a narrow screen never puts the (?) on a line of its own
            const lastChip = [...line.querySelectorAll('[data-strategy-chip]')].at(-1)!;
            expect(lastChip.parentElement).toBe(help.parentElement!.parentElement);
            expect(getComputedStyle(lastChip.parentElement!).whiteSpace).toBe('nowrap');
        }
    });

    it('while a run goes, ranks the clocks made so far and gives a clock still being made no rank', () => {
        const views = viewsOf(AUTOMATION_240);
        const { container } = panel(views, 0, { pending: ['Pitch Pickups'] });
        const pendingRow = screen.getByText('Pitch Pickups: computing…').closest('tr')!;
        expect(pendingRow.querySelector('[data-rank]')!.textContent).toBe('');
        expect([...container.querySelectorAll('tbody tr [data-rank]')].map(cell => cell.textContent).filter(Boolean))
            .toEqual(views.map((_, at) => `${at + 1}`));
    });

    describe('while a run goes, the rows hold still', () => {
        const views = viewsOf(MILITARY_240);
        const recommended = views[MILITARY_240.selected_index];
        // the clocks before the recommended one was made
        const before = views.filter(view => view !== recommended);

        it('a clock that arrives and ranks first is added at the bottom of its group with rank 1; the ranks of the others change in place', () => {
            const { rerender } = panel(before, 0, { pending: [recommended.label], running: true });
            const earlier = rowsOf(before);
            // the last clock is in, and no other is still being made: the run has not ended
            rerender(panelOf(views, 0, { running: true }));
            const later = rowsOf(views);
            expect(later.filter(([, id]) => id !== recommended.id)).toEqual(earlier.map(([rank, id]) => [`${Number(rank) + 1}`, id]));
            const arrived = screen.getByRole('radio', { name: fullClockName(recommended) }).closest('tr')!;
            expect(arrived.querySelector('[data-rank]')!.textContent).toBe('1');
            // the last row of its group: the divider, or nothing, under it
            const next = arrived.nextElementSibling;
            expect(next === null || next.textContent === RECOMMENDED_COPY.unstableDivider).toBe(true);
            expect(later.at(0)![1]).not.toBe(recommended.id);
        });

        it('the rows are sorted by their ranks once the run has ended', () => {
            const { rerender } = panel(before, 0, { running: true });
            rerender(panelOf(views, 0, { running: true }));
            rerender(panelOf(views, 0, { running: false }));
            const order = rankOrderOf(views);
            expect(rowsOf(views)).toEqual(order.map((index, at) => [`${at + 1}`, views[index].id]));
        });

        it('a table opened while a run goes shows the clocks made so far by their ranks', () => {
            panel(before, 0, { running: true });
            const order = rankOrderOf(before);
            expect(rowsOf(before)).toEqual(order.map((index, at) => [`${at + 1}`, before[index].id]));
        });
    });
});

describe('the full table of clocks', () => {
    it('has no Belt column and no help for one', () => {
        const views = viewsOf(AUTOMATION_240);
        show(<ClockAlternativesPanel comparison={{ allColumns: true, showUnstable: true }} onComparisonChange={() => {}}
            alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={() => {}}            pickRule={null} />);
        const headers = screen.getAllByRole('columnheader').map(it => it.textContent);
        expect(headers).toHaveLength(12);
        expect(headers[0]).toBe('Rank');
        expect(headers.some(header => /belt/i.test(header ?? ''))).toBe(false);
        expect(screen.queryByRole('button', { name: /belt/i })).toBeNull();
        const firstRow = screen.getAllByRole('row').find(row => within(row).queryByRole('radio'))!;
        expect(within(firstRow).getAllByRole('cell').concat(within(firstRow).queryAllByRole('rowheader'))).toHaveLength(12);
    });
});

describe('the words of the compare table', () => {
    const views = viewsOf(AUTOMATION_240);
    const stableAt = views.findIndex(view => view.verdict === 'stable');
    const unstable = views.filter(view => view.verdict !== 'stable');
    const panel = (alternatives = views, showUnstable = true, selectedIndex = AUTOMATION_240.selected_index) => show(
        <ClockAlternativesPanel comparison={{ allColumns: false, showUnstable }} onComparisonChange={() => {}}
            alternatives={alternatives} selectedIndex={selectedIndex} onSelect={() => {}}            pickRule={null} />);

    it('heads the row help\'s part on whether the clock works "Status"', async () => {
        const { user } = panel();
        await user.click(screen.getByRole('button', { name: `About ${fullClockName(views[0])}` }));
        const help = await screen.findByRole('dialog');
        expect(within(help).getByText('Status', { selector: 'p' })).toBeTruthy();
        expect(help.textContent).not.toContain('Does it work?');
    });

    it('names the group of clocks that are not Stable, and its button says how many, one or several', async () => {
        expect(stableAt).toBeGreaterThanOrEqual(0);
        expect(unstable.length).toBeGreaterThan(1);
        const { user } = panel([views[stableAt], ...unstable], false, 0);
        const show = screen.getByRole('button', { name: `Show ${unstable.length} clocks that are not Stable` });
        expect(document.body.textContent).not.toMatch(/unstable clock|that were tried/i);
        await user.click(show);
        cleanup();
        panel([views[stableAt], ...unstable], true, 0);
        expect(screen.getByRole('cell', { name: 'Clocks that are not Stable' })).toBeTruthy();
        expect(screen.getByRole('button', { name: `Hide ${unstable.length} clocks that are not Stable` })).toBeTruthy();
        cleanup();
        panel([views[stableAt], unstable[0]], false, 0);
        expect(screen.getByRole('button', { name: 'Show 1 clock that is not Stable' })).toBeTruthy();
        cleanup();
        panel([views[stableAt], unstable[0]], true, 0);
        expect(screen.getByRole('button', { name: 'Hide 1 clock that is not Stable' })).toBeTruthy();
    });

    it('leaves the line that explains a clock\'s name out of its row and its help; the card keeps it', async () => {
        const { container, user } = panel(views, true);
        expect(container.querySelector('[data-strategy-line]')).toBeNull();
        for (const view of views) {
            const line = familyCopyOf(view)?.line;
            if (line) expect(container.textContent).not.toContain(line);
        }
        const clock = views[0];
        await user.click(screen.getByRole('button', { name: `About ${fullClockName(clock)}` }));
        const help = await screen.findByRole('dialog');
        expect(help.textContent).not.toContain(familyCopyOf(clock)!.line);
        expect(help.textContent).toContain(familyCopyOf(clock)!.definition);
    });

    it('says nothing of a deadlock risk: the card and About this build say it', () => {
        const risk = 'Deadlock risk: Inserters 1 and 2 both bring iron plate to the machine. An inserter that starts picking up an item the other has already filled the machine with holds its hand.';
        const { container } = panel(views.map(view => ({ ...view, deadlockRisk: risk })));
        expect(container.textContent).not.toContain('Deadlock risk');
        expect(container.textContent).not.toContain('The tests that stop a supply or block an output do not see this');
        expect(container.querySelector('.MuiAlert-root')).toBeNull();
    });
});
