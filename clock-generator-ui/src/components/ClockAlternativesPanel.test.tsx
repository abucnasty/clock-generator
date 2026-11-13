// @vitest-environment happy-dom
import { act, cleanup, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330, ELECTROMAGNETIC_330_TWO_SWINGS, errorCaseViews, MILITARY_240, TRIALS_NOT_MADE_REASON, viewsOf } from '../test/checkedLanesFixtures';
import { REASON_WORDS, SUMMARY_COPY } from '../utils/clockSummary';
import { RECOMMENDED_COPY, rankOrderOf } from '../utils/recommendedClock';
import { familyCopyOf, fullClockName, strategyNameOf } from '../utils/strategyNames';
import type { ClockAlternativeView } from '../worker/types';
import { ClockAlternativesPanel, CompareClocksDialog } from './ClockAlternativesPanel';

/**
 * The widths a test gives the table's box and the table, as the browser would measure them (happy-dom lays nothing out):
 * the table with every column is EVERY_COLUMN wide, so a box of WIDE has them all and a box of NARROW the default ones
 */
const EVERY_COLUMN = 1500;
const NARROW = 1200;
const WIDE = 1900;
let widths = { box: WIDE, everyColumn: EVERY_COLUMN };
/** The prototype that defines `name`, from `start` up */
const ownerOf = (start: object, name: string) => {
    let at: object | null = start;
    while (at && !Object.hasOwn(at, name)) at = Object.getPrototypeOf(at);
    return at!;
};
const clientOwner = ownerOf(HTMLElement.prototype, 'clientWidth');
const offsetOwner = ownerOf(HTMLElement.prototype, 'offsetWidth');
const client = Object.getOwnPropertyDescriptor(clientOwner, 'clientWidth')!;
const offset = Object.getOwnPropertyDescriptor(offsetOwner, 'offsetWidth')!;
Object.defineProperty(clientOwner, 'clientWidth', { configurable: true, get(this: Element) {
    return this.hasAttribute('data-compare-fit') ? widths.box : client.get!.call(this);
} });
Object.defineProperty(offsetOwner, 'offsetWidth', { configurable: true, get(this: HTMLElement) {
    if (this.tagName !== 'TABLE') return offset.get!.call(this);
    return this.hasAttribute('data-all-columns') ? Math.max(widths.everyColumn, widths.box) : widths.box;
} });
afterAll(() => {
    Object.defineProperty(clientOwner, 'clientWidth', client);
    Object.defineProperty(offsetOwner, 'offsetWidth', offset);
});
afterEach(() => { widths = { box: WIDE, everyColumn: EVERY_COLUMN }; });

type Options = { pending?: string[]; running?: boolean; onSelect?: (index: number) => void; pickRule?: Parameters<typeof ClockAlternativesPanel>[0]['pickRule'] };
const tableOf = (alternatives: ClockAlternativeView[], selectedIndex: number, options: Options = {}) =>
    <ClockAlternativesPanel alternatives={alternatives} selectedIndex={selectedIndex} onSelect={options.onSelect ?? (() => {})}
        pickRule={options.pickRule ?? null} pending={options.pending} running={options.running} />;
/** The table in a box `width` pixels wide */
const table = (alternatives: ClockAlternativeView[], selectedIndex: number, width = NARROW, options: Options = {}) => {
    widths = { ...widths, box: width };
    return show(tableOf(alternatives, selectedIndex, options));
};
/** The row of the clock with `id`: its cells' text by column, and whether a status chip stands in it */
const rowOf = (id: string, alternatives: ClockAlternativeView[]) => {
    const row = screen.getByRole('radio', { name: fullClockName(alternatives.find(view => view.id === id)!) }).closest('tr')!;
    const cells = Object.fromEntries([...row.querySelectorAll<HTMLElement>('td[data-column]')].map(cell => [cell.dataset.column, cell.textContent]));
    return { row, cells, chip: row.querySelector('[data-badge="status"]'), detail: row.querySelector('[data-status-detail]')?.textContent ?? null };
};

describe('the help of a clock in the compare table', () => {
    const views = viewsOf(AUTOMATION_240);
    /** Opens the help of the clock with `id` and gives its text */
    const helpOf = async (id: string) => {
        const { user } = table(views, AUTOMATION_240.selected_index);
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

describe('the status of a clock that underproduces, in the compare table', () => {
    const views = viewsOf(AUTOMATION_240);

    it('of the 72-tick clock: the word and the words for its reason code', () => {
        table(views, AUTOMATION_240.selected_index);
        const row = within(rowOf('euclidean_swings', views).row);
        expect(row.getAllByText('Underproduces').length).toBeGreaterThan(0);
        expect(row.getByText('Missed pickups due to belt gaps')).toBeTruthy();
    });

    it('of the 216-tick clock at a full join: the word and the words for the code of a full join', () => {
        table(views, AUTOMATION_240.selected_index);
        const row = within(rowOf('takt_batches_observed', views).row);
        expect(row.getAllByText('Underproduces').length).toBeGreaterThan(0);
        expect(row.getByText(REASON_WORDS.target_full)).toBeTruthy();
    });
});

describe('the status of every clock, in the compare table: the Status column, no chip', () => {
    const views = viewsOf(AUTOMATION_240);

    it('says Stable in the Status column of the stable clock, with no chip, and its rank 1 in bold in the Rank column', () => {
        table(views, AUTOMATION_240.selected_index);
        const { row, cells, chip } = rowOf('time_study_windows', views);
        expect(chip).toBeNull();
        expect(cells.status).toBe('Stable');
        expect(cells.rank).toBe('1');
        expect(getComputedStyle(row.querySelector('[data-rank]')!).fontWeight).toBe('700');
        expect(within(row).queryByText('Recommended')).toBeNull();
    });

    it('says Underproduces and No recovery in the column, and keeps the line under the name', () => {
        table(views, AUTOMATION_240.selected_index);
        const short = rowOf('euclidean_swings', views);
        expect([short.chip, short.cells.status, short.detail]).toEqual([null, 'Underproduces', 'Missed pickups due to belt gaps']);
        const none = rowOf('pitch_pickups', views);
        expect([none.chip, none.cells.status, none.detail]).toEqual([null, 'No recovery', null]);
        const off = rowOf('takt_batches_observed_swings_4', views);
        expect([off.cells.status, off.detail]).toEqual(['Underproduces', 'makes 180/s of 240/s']);
    });

    it.each([NARROW, WIDE])('has no chip beside a name: no Recommended, Fewest wakeups or Fewest deciders, in a box of %s px', width => {
        const { container } = table(views, AUTOMATION_240.selected_index, width);
        expect(container.querySelectorAll('[data-badge], [data-card-chip]')).toHaveLength(0);
        for (const words of ['Recommended', 'Best so far', 'Fewest wakeups', 'Fewest deciders']) expect(container.textContent).not.toContain(words);
    });

    it.each<[Parameters<typeof errorCaseViews>[0], string]>([
        ['not-tried', TRIALS_NOT_MADE_REASON],
        ['baseline-missed', SUMMARY_COPY.errorBaselineMissed],
        ['no-result', SUMMARY_COPY.errorNoResult],
    ])('says Error of a clock whose loss trials gave no answer (%s), with the reason as the line under its name, at both widths', (kind, reason) => {
        const alternatives = errorCaseViews(kind);
        for (const width of [NARROW, WIDE]) {
            table(alternatives, AUTOMATION_240.selected_index, width);
            const { row, cells, chip, detail } = rowOf('time_study_windows', alternatives);
            expect([chip, cells.status, detail]).toEqual([null, 'Error', reason]);
            // the mark of a failed check
            expect(row.querySelector('td[data-column="status"] [data-status-mark]')!.getAttribute('data-status-mark')).toBe('error');
            cleanup();
        }
    });

    it.each([NARROW, WIDE])('names the column Status, with a help that names each status once, then how the clocks are checked (%s px)', async width => {
        const { user } = table(views, AUTOMATION_240.selected_index, width);
        expect(screen.queryByRole('columnheader', { name: /Works\?/ })).toBeNull();
        const header = screen.getAllByRole('columnheader').find(cell => cell.textContent === 'Status')!;
        await user.click(within(header).getByRole('button', { name: 'About Status' }));
        const help = (await screen.findByRole('dialog')).textContent!;
        for (const word of ['Stable', 'Underproduces', 'Overproduces', 'Oscillates', 'No recovery', 'Error', 'Start-dependent']) {
            expect(help.split(word).length - 1, word).toBe(1);
        }
        expect(help.endsWith(SUMMARY_COPY.statusChecks)).toBe(true);
    });

    it('says with every column the word of the Status column, Stable in place of "Recovery: Yes"', () => {
        table(views, AUTOMATION_240.selected_index, WIDE);
        expect(rowOf('time_study_windows', views).cells.status).toBe('Stable');
        expect(document.body.textContent).not.toContain('Recovery: Yes');
    });
});

describe('the status of a stable clock above the setpoint, with every column', () => {
    // the time study windows clock made stable above the setpoint, as the engine ranks one (ranking.stable_above_target)
    const views = viewsOf(AUTOMATION_240).map(view => view.id !== 'time_study_windows' ? view : { ...view,
        assessment: { ...view.assessment, items_per_second: 252 }, ranking: { ...view.ranking, meets_target_rate: false, rate_off_target: 12, stable_above_target: true } });

    it('reads Overproduces in its Status, with the rate as the line under its name, with the mark of an unstable clock', () => {
        table(views, AUTOMATION_240.selected_index, WIDE);
        const { row, cells, detail } = rowOf('time_study_windows', views);
        expect([cells.status, detail]).toEqual(['Overproduces', 'makes 252/s of 240/s']);
        expect(row.querySelector('td[data-column="status"] [data-status-mark]')!.getAttribute('data-status-mark')).toBe('overproduces');
        expect(row.querySelector('.MuiChip-root')).toBeNull();
    });
});

describe('the rate of a clock with a loss on a shared lane, in the compare table: what all the copies made together', () => {
    const views = viewsOf(AUTOMATION_240);
    const makesOf = (alternatives: ClockAlternativeView[], id: string, width: number) => {
        table(alternatives, AUTOMATION_240.selected_index, width);
        const { cells } = rowOf(id, alternatives);
        cleanup();
        return cells.makes;
    };
    const older = views.map(view => ({ ...view, checkedLanes: view.checkedLanes && { ...view.checkedLanes, copies_made: undefined } }));

    it.each([NARROW, WIDE])('in the Makes column: 234.07 on the 216-tick clock, 238.77 on the 72-tick one, 240 on the stable one (%s px)', width => {
        expect(makesOf(views, 'takt_batches_observed', width)).toBe('234.07');
        expect(makesOf(views, 'euclidean_swings', width)).toBe('238.77');
        expect(makesOf(views, 'time_study_windows', width)).toBe('240');
    });

    it('has no Rate column, which said the same as Makes', () => {
        table(views, AUTOMATION_240.selected_index, WIDE);
        expect(screen.getAllByRole('columnheader').map(head => head.textContent)).not.toContainEqual(expect.stringMatching(/^Rate/));
    });

    it.each([NARROW, WIDE])('in an older result without the rate of the copies: the clock-only rate, as before (%s px)', width => {
        expect(makesOf(older, 'takt_batches_observed', width)).toBe('240');
    });

    it('keeps clocks with different rates out of the folded line: electromagnetic science 330 with 2 swings', () => {
        const ems = viewsOf(ELECTROMAGNETIC_330_TWO_SWINGS);
        const { container } = table(ems, ELECTROMAGNETIC_330_TWO_SWINGS.selected_index);
        expect(container.querySelector('[data-makes-fold]')).toBeNull();
        expect(container.textContent).toContain('318.79');
        expect(container.textContent).toContain('322.42');
        cleanup();
        // an older result of the same build folds them as before
        const folded = table(ems.map(view => ({ ...view, checkedLanes: { ...view.checkedLanes!, copies_made: undefined } })), ELECTROMAGNETIC_330_TWO_SWINGS.selected_index);
        expect(folded.container.querySelector('[data-makes-fold]')!.textContent).toBe('All 6 clocks make 330/s.');
    });
});

describe('the Rank column: the engine\'s order', () => {
    const SAMPLES = { AUTOMATION_240, ELECTROMAGNETIC_330, ELECTROMAGNETIC_330_TWO_SWINGS, MILITARY_240 };
    /** The rows of clocks from the top, each its rank and the id of its clock */
    const rowsOf = (alternatives: ClockAlternativeView[]) => screen.getAllByRole('radio').map(radio => {
        const row = radio.closest('tr')!;
        return [row.querySelector('[data-rank]')!.textContent, alternatives.find(view => fullClockName(view) === radio.getAttribute('aria-label'))!.id];
    });

    it.each(Object.entries(SAMPLES))('numbers the rows of %s 1 to the last straight through both groups, in the engine\'s order, rank 1 its recommended clock', (_, result) => {
        const views = viewsOf(result);
        table(views, result.selected_index);
        const order = rankOrderOf(views);
        expect(rowsOf(views)).toEqual(order.map((index, at) => [`${at + 1}`, views[index].id]));
        // the engine's recommended clock of the whole generation is rank 1
        expect(views[order[0]].id).toBe(result.clocks[result.selected_index].id);
    });

    it('heads the column Rank, with a help that lists the six keys in order, the tie, rank 1 and whether the slower searches ran', async () => {
        const { user } = table(viewsOf(AUTOMATION_240), 0, NARROW, { pickRule: { searchedForFewerWakeUps: true } });
        const header = screen.getAllByRole('columnheader').find(head => head.textContent === 'Rank')!;
        await user.click(within(header).getByRole('button', { name: 'About Rank' }));
        const help = await screen.findByRole('dialog');
        expect(within(help).getAllByRole('listitem').map(item => item.textContent)).toEqual(RECOMMENDED_COPY.rankKeys);
        expect(help.textContent).toBe([RECOMMENDED_COPY.rankLead, ...RECOMMENDED_COPY.rankKeys, RECOMMENDED_COPY.rankTie, RECOMMENDED_COPY.rankFirst,
            RECOMMENDED_COPY.runSearched].join(''));
    });

    it('has no "How clocks are chosen" fold: its words are in the two helps', () => {
        const { container } = table(viewsOf(AUTOMATION_240), 0);
        expect(container.textContent).not.toContain('How clocks are chosen');
        expect(container.querySelector('.MuiAccordion-root')).toBeNull();
    });

    it('puts each clock\'s help on the line of its name, and nothing on a line of its own under it', () => {
        const views = viewsOf(AUTOMATION_240);
        table(views, 0);
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
        const { container } = table(views, 0, NARROW, { pending: ['Pitch Pickups'] });
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
            const { rerender } = table(before, 0, NARROW, { pending: [recommended.label], running: true });
            const earlier = rowsOf(before);
            // the last clock is in, and no other is still being made: the run has not ended
            rerender(tableOf(views, 0, { running: true }));
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
            const { rerender } = table(before, 0, NARROW, { running: true });
            rerender(tableOf(views, 0, { running: true }));
            rerender(tableOf(views, 0, { running: false }));
            const order = rankOrderOf(views);
            expect(rowsOf(views)).toEqual(order.map((index, at) => [`${at + 1}`, views[index].id]));
        });

        it('a table opened while a run goes shows the clocks made so far by their ranks', () => {
            table(before, 0, NARROW, { running: true });
            const order = rankOrderOf(before);
            expect(rowsOf(before)).toEqual(order.map((index, at) => [`${at + 1}`, before[index].id]));
        });
    });
});

describe('the compare table\'s two widths', () => {
    const views = viewsOf(AUTOMATION_240);
    const heads = () => screen.getAllByRole('columnheader').map(head => head.textContent);
    // the clocks were made for 9 copies of the build
    const MAKES = `Makes(items/s,\u00a0all\u00a0${views[0].copies}\u00a0copies)`;
    const EXTRA = ['Output swings', 'Window cycle time', 'Enable windows', 'Output per window cycle(1\u00a0copy)'];

    it('where every figure fits as a column with every name on one line: every figure a column, no Belt column, no details control', () => {
        table(views, AUTOMATION_240.selected_index, EVERY_COLUMN);
        expect(screen.getByRole('table').hasAttribute('data-all-columns')).toBe(true);
        expect(heads()).toEqual(['Rank', 'Select', 'Clock', MAKES, 'Wakeups/min(1\u00a0copy)', 'Signals/min(1\u00a0copy)', 'Deciders', ...EXTRA, 'Status']);
        expect(heads().some(head => /belt/i.test(head ?? ''))).toBe(false);
        expect(screen.queryByRole('button', { name: /belt|^Details of/i })).toBeNull();
        const firstRow = screen.getAllByRole('row').find(row => within(row).queryByRole('radio'))!;
        expect(within(firstRow).getAllByRole('cell')).toHaveLength(12);
    });

    it('where they do not fit: the default columns, and a control on each row that opens its other figures under it', async () => {
        const { user } = table(views, AUTOMATION_240.selected_index, EVERY_COLUMN - 2);
        expect(heads()).toEqual(['Details', 'Rank', 'Select', 'Clock', MAKES, 'Wakeups/min(1\u00a0copy)', 'Signals/min(1\u00a0copy)', 'Deciders', 'Status']);
        const clock = views.find(view => view.id === 'time_study_windows')!;
        const control = screen.getByRole('button', { name: `Details of ${fullClockName(clock)}` });
        expect(control.getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelector('[data-details-row]')).toBeNull();
        await user.click(control);
        expect(control.getAttribute('aria-expanded')).toBe('true');
        const details = document.getElementById(control.getAttribute('aria-controls')!)!;
        expect([...details.querySelectorAll('dt')].map(term => term.textContent)).toEqual(EXTRA.map(label => label.replace('(', ' (')));
        expect([...details.querySelectorAll('dd')].map(value => value.textContent)).toEqual([
            `${clock.terminalSwingCount} per ${clock.cycleTicks} ticks`, `${clock.simulationDurationTicks} ticks`, `${clock.inserterWindowCount}`,
            clock.asBuilt ? `${clock.asBuilt.actual_output_items} / ${clock.expectedOutputItems}` : '—']);
        // the control opens the details and does not select the clock
        expect((screen.getByRole('radio', { name: fullClockName(clock) }) as HTMLInputElement).checked).toBe(views.indexOf(clock) === AUTOMATION_240.selected_index);
        await user.click(control);
        expect(document.querySelector('[data-details-row]')).toBeNull();
    });

    it('tries every column again when the rows change: a clock that arrives may let them fit', () => {
        const before = views.slice(0, -1);
        const { rerender } = table(before, 0, NARROW);
        expect(screen.getByRole('table').hasAttribute('data-all-columns')).toBe(false);
        widths = { ...widths, everyColumn: NARROW };
        rerender(tableOf(views, 0));
        expect(screen.getByRole('table').hasAttribute('data-all-columns')).toBe(true);
        // and keeps the default ones where they still do not fit
        widths = { ...widths, everyColumn: EVERY_COLUMN };
        rerender(tableOf(before, 0));
        expect(screen.getByRole('table').hasAttribute('data-all-columns')).toBe(false);
    });

    it.each([[WIDE, 'About Wakeups/min (1\u00a0copy)', /average over 12 start points/], [NARROW, 'Terms for Wakeups/min (1\u00a0copy)', /./]])(
        'keeps the help of each table on the Wakeups head: with every column what is counted and how, else the Terms (%s px)', async (width, name, words) => {
            const { user } = table(views, AUTOMATION_240.selected_index, width);
            const head = screen.getAllByRole('columnheader').find(cell => cell.querySelector('[data-head-name]')?.textContent === 'Wakeups/min')!;
            const button = within(head).getByRole('button');
            expect(button.getAttribute('aria-label')).toBe(name);
            await user.click(button);
            expect((await screen.findByRole('dialog')).textContent).toMatch(words);
        });

    it('never lets a name wrap with every column', () => {
        table(views, AUTOMATION_240.selected_index, WIDE);
        for (const line of document.querySelectorAll<HTMLElement>('[data-name-line]')) {
            expect(getComputedStyle(line).flexWrap).toBe('nowrap');
            expect(getComputedStyle(line).whiteSpace).toBe('nowrap');
        }
    });

    it('heads each column with its name on the first line, with its (?), and its unit or "(1 copy)" under it', () => {
        table(views, AUTOMATION_240.selected_index, WIDE);
        const head = (name: string) => screen.getAllByRole('columnheader').find(cell => cell.querySelector('[data-head-name]')?.textContent === name)!;
        const wakeUps = head('Wakeups/min');
        expect(wakeUps.querySelector('[data-head-unit]')!.textContent).toBe('(1\u00a0copy)');
        expect(within(wakeUps.querySelector<HTMLElement>('[data-head-name]')!).getByRole('button')).toBeTruthy();
        expect(head('Makes').querySelector('[data-head-unit]')!.textContent).toBe(`(items/s,\u00a0all\u00a0${views[0].copies}\u00a0copies)`);
        expect(head('Deciders').querySelector('[data-head-unit]')).toBeNull();
        for (const name of document.querySelectorAll<HTMLElement>('[data-head-name], [data-head-unit]')) expect(getComputedStyle(name).whiteSpace).toBe('nowrap');
    });

    it('selects the clock of a row that is pressed', async () => {
        const onSelect = vi.fn();
        const { user } = table(views, AUTOMATION_240.selected_index, WIDE, { onSelect });
        await user.click(rowOf('euclidean_swings', views).row.querySelector('td[data-column="deciders"]')!);
        expect(onSelect).toHaveBeenLastCalledWith(views.findIndex(view => view.id === 'euclidean_swings'));
    });
});

describe('the words of the compare table', () => {
    const views = viewsOf(AUTOMATION_240);
    const stableAt = views.findIndex(view => view.verdict === 'stable');
    const unstable = views.filter(view => view.verdict !== 'stable');

    it('heads the row help\'s part on whether the clock works "Status"', async () => {
        const { user } = table(views, AUTOMATION_240.selected_index);
        await user.click(screen.getByRole('button', { name: `About ${fullClockName(views[0])}` }));
        const help = await screen.findByRole('dialog');
        expect(within(help).getByText('Status', { selector: 'p' })).toBeTruthy();
        expect(help.textContent).not.toContain('Does it work?');
    });

    it('lists every clock: those that are not Stable under their divider, with no button to hide them', () => {
        table([views[stableAt], ...unstable], 0);
        expect(screen.getByRole('cell', { name: 'Clocks that are not Stable' })).toBeTruthy();
        expect(screen.getAllByRole('radio')).toHaveLength(unstable.length + 1);
        expect(screen.queryByRole('button', { name: /^(Show|Hide) / })).toBeNull();
        expect(document.body.textContent).not.toMatch(/unstable clock|that were tried/i);
    });

    it('leaves the line that explains a clock\'s name out of its row and its help; the card keeps it', async () => {
        const { container, user } = table(views, AUTOMATION_240.selected_index);
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
        const { container } = table(views.map(view => ({ ...view, deadlockRisk: risk })), AUTOMATION_240.selected_index);
        expect(container.textContent).not.toContain('Deadlock risk');
        expect(container.textContent).not.toContain('The tests that stop a supply or block an output do not see this');
        expect(container.querySelector('.MuiAlert-root')).toBeNull();
    });
});

describe('the compare table over the page', () => {
    const views = viewsOf(AUTOMATION_240);
    const dialog = (onClose = vi.fn(), onSelect = vi.fn()) => {
        const view = show(<CompareClocksDialog open onClose={onClose} alternatives={views} selectedIndex={AUTOMATION_240.selected_index} onSelect={onSelect} pickRule={null} />);
        return { ...view, onClose, onSelect };
    };

    it('is a dialog named Compare clocks, with the table, its help and a close button', async () => {
        const { user, onClose } = dialog();
        const window = screen.getByRole('dialog', { name: /^Compare clocks/ });
        expect(within(window).getByRole('table', { name: 'Clocks' })).toBeTruthy();
        expect(within(window).getByRole('button', { name: 'About comparing clocks' })).toBeTruthy();
        await user.click(within(window).getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes on Escape; with a help open, Escape closes the help only', async () => {
        const { user, onClose } = dialog();
        await user.click(screen.getByRole('button', { name: 'About Status' }));
        expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2);
        await user.keyboard('{Escape}');
        expect(onClose).not.toHaveBeenCalled();
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
        expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1);
        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('selects the clock of a row and stays open', async () => {
        const { user, onSelect, onClose } = dialog();
        await user.click(screen.getByRole('radio', { name: fullClockName(views.find(view => view.id === 'euclidean_swings')!) }));
        expect(onSelect).toHaveBeenLastCalledWith(views.findIndex(view => view.id === 'euclidean_swings'));
        expect(onClose).not.toHaveBeenCalled();
    });
});
