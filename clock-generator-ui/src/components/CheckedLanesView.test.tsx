// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CheckedLanes } from 'clock-generator/browser';
import { names, show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330, MILITARY_240, STATES, viewOf } from '../test/checkedLanesFixtures';
import { CheckedLanesSummary, SharedLanesTable } from './CheckedLanesView';

const gameNames = names({ 'iron-gear-wheel': 'Iron gear wheel', 'copper-plate': 'Copper plate', 'automation-science-pack': 'Automation science pack',
    'accumulator': 'Accumulator', 'supercapacitor': 'Supercapacitor', 'military-science-pack': 'Military science pack', 'stone-wall': 'Stone wall',
    'piercing-rounds-magazine': 'Piercing rounds magazine', 'iron-plate': 'Iron plate' });

const COLUMNS = ['Lane', 'Role', 'Item', 'End', 'The 9 copies together', 'Supply rate', 'State'];

/** The table's rows below its header, each as its cells' text */
const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

/** Where each text is in the rendered text, in the order given; -1 where it is not there */
const placesIn = (text: string, parts: string[]) => parts.map(part => text.indexOf(part));

describe('a clock without a cause', () => {
    const stable = checkedOf(AUTOMATION_240, 'time_study_windows');

    it('says what it is made for and the engine\'s line, with the table closed until a click', async () => {
        const { user, container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, 'time_study_windows')} />, { names: gameNames });
        expect(container.textContent).toContain('Made for 9 copies of your build.');
        expect(container.textContent).toContain(stable.line.sentence);
        const control = screen.getByRole('button', { name: 'What was checked' });
        expect(control.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('table')).toBeNull();

        await user.click(control);
        expect(control.getAttribute('aria-expanded')).toBe('true');
        const table = screen.getByRole('table', { name: 'Shared lanes' });
        expect(within(table).getAllByRole('columnheader').map(it => it.textContent)).toEqual(COLUMNS);
        const rows = bodyRows(table);
        expect(rows.map(row => within(row).getByRole('rowheader').textContent)).toEqual(stable.rows.map(row => `Belt ${row.belt_id}, lane ${row.lane}`));
        rows.forEach((row, index) => {
            expect(row.textContent).toContain(stable.rows[index].label);
            expect(row.textContent).toContain(stable.rows[index].sentence);
        });
        expect(rows[0].textContent).toBe('Belt 1, lane 1InputIron gear wheelDead endtake 120 /s120 /slane capacity' + stable.rows[0].label + stable.rows[0].sentence);
        expect(rows[2].textContent).toBe('Belt 2, lane 1OutputAutomation science packInfiniteassumed from its roledrop 240 /son lanes 1 and 2—carries 240 /s'
            + stable.rows[2].label + stable.rows[2].sentence);
        expect(screen.getByText('3 lanes · all hold')).toBeTruthy();
    });

    it('that was not run with the copies shows the engine\'s line for it and never "holds"', async () => {
        const notRun = checkedOf(AUTOMATION_240, 'takt_batches_observed_swings_4');
        const { user, container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, 'takt_batches_observed_swings_4')} />, { names: gameNames });
        expect(container.textContent).toContain(notRun.line.sentence);
        await user.click(screen.getByRole('button', { name: 'What was checked' }));
        expect(bodyRows(screen.getByRole('table'))).toHaveLength(3);
        expect(container.textContent).not.toMatch(/holds/i);
    });

    it('drops into chests: the engine\'s line names the chest, and no output lane has a row', async () => {
        const chests = checkedOf(ELECTROMAGNETIC_330, 'takt_batches_observed');
        const { user, container } = show(<CheckedLanesSummary clock={viewOf(ELECTROMAGNETIC_330, 'takt_batches_observed')} />, { names: gameNames });
        expect(container.textContent).toContain('Made for 11 copies of your build.');
        expect(container.textContent).toContain(chests.line.sentence);
        await user.click(screen.getByRole('button', { name: 'What was checked' }));
        const rows = bodyRows(screen.getByRole('table', { name: 'Shared lanes' }));
        expect(rows.map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual(['Input', 'Input']);
        expect(rows.map(row => within(row).getAllByRole('cell')[1].textContent)).toEqual(['Accumulator', 'Supercapacitor']);
    });

    it('drops onto two plain output belts: two rows whose rate fits, each with the engine\'s sentence', async () => {
        const plain = checkedOf(MILITARY_240, 'coordinated_sources');
        const { user, container } = show(<CheckedLanesSummary clock={viewOf(MILITARY_240, 'coordinated_sources')} />, { names: gameNames });
        expect(container.textContent).toContain(plain.line.sentence);
        await user.click(screen.getByRole('button', { name: 'What was checked' }));
        const fits = bodyRows(screen.getByRole('table')).filter(row => row.getAttribute('data-lane-state') === 'rate_fits');
        expect(fits.map(row => within(row).getByRole('rowheader').textContent)).toEqual(['Belt 1, lane 1', 'Belt 2, lane 1']);
        for (const [index, row] of fits.entries()) {
            const engine = plain.rows.filter(it => it.state.kind === 'rate_fits')[index];
            expect(row.textContent).toContain(engine.label);
            expect(row.textContent).toContain(engine.sentence);
        }
        expect(screen.getByText('6 lanes · 2 by rate only · 4 hold')).toBeTruthy();
    });

    it('of a build of one copy says what it is made for, and has no table', () => {
        const one = { ...viewOf(AUTOMATION_240, 'time_study_windows'), copies: 1, checkedLanes: undefined };
        const { container } = show(<CheckedLanesSummary clock={one} />, { names: gameNames });
        expect(container.textContent).toBe('Made for 1 copy of your build.');
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
    });
});

describe('a clock with a cause', () => {
    it('of 72 ticks shows its headline and pictures, then the table open without a click', () => {
        const short = checkedOf(AUTOMATION_240, 'euclidean_swings');
        const cause = short.cause!;
        const { container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, 'euclidean_swings')} />, { names: gameNames });
        const text = container.textContent!;
        const parts = [cause.headline.text, 'Missed swings, copy by copy', 'The 65 window cycles of copy 2', 'Read this as text', 'Shared lanes'];
        const places = placesIn(text, parts);
        expect(places.every(place => place >= 0)).toBe(true);
        expect(places).toEqual([...places].sort((a, b) => a - b));
        expect(screen.queryByRole('button', { name: 'What was checked' })).toBeNull();
        const rows = bodyRows(screen.getByRole('table', { name: 'Shared lanes' }));
        expect(rows.map(row => row.getAttribute('data-lane-state'))).toEqual(short.rows.map(row => row.state.kind));
        rows.forEach((row, index) => expect(row.textContent).toContain(short.rows[index].label + short.rows[index].sentence));
    });

    it('of 216 ticks, at a full join, shows its headline and pictures: no spacing where the engine gives none', () => {
        const join = checkedOf(AUTOMATION_240, 'takt_batches_observed');
        const cause = join.cause!;
        expect(cause.spacing).toBeNull();
        const { container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, 'takt_batches_observed')} />, { names: gameNames });
        const text = container.textContent!;
        expect(text).not.toContain('Travel between copies');
        const places = placesIn(text, [cause.headline.text, 'Missed swings, copy by copy', 'The 63 window cycles of copies 4 and 8', 'Read this as text', 'Shared lanes']);
        expect(places.every(place => place >= 0)).toBe(true);
        expect(places).toEqual([...places].sort((a, b) => a - b));
        expect(screen.getByText('3 lanes · 1 join full · 2 take less')).toBeTruthy();
    });
});

describe('on a narrow page', () => {
    it('gives each lane a block: the lane and its state first, then the columns as names and values, with nothing beside it', () => {
        const short = checkedOf(AUTOMATION_240, 'euclidean_swings');
        show(<SharedLanesTable checked={short} lanes={AUTOMATION_240.lanes} level={4} narrow />, { names: gameNames });
        expect(screen.queryByRole('table')).toBeNull();
        const list = screen.getByRole('list', { name: 'Shared lanes' });
        const blocks = within(list).getAllByRole('listitem');
        expect(blocks).toHaveLength(short.rows.length);
        blocks.forEach((block, index) => {
            const row = short.rows[index];
            const text = block.textContent!;
            // the lane, then the engine's label and sentence, then the other columns
            const places = [`Lane Belt ${row.belt_id}, lane ${row.lane}`, row.label, row.sentence, 'Role', 'Item', 'End', 'The 9 copies together', 'Supply rate']
                .map(part => text.indexOf(part));
            expect(places.every(place => place >= 0)).toBe(true);
            expect(places).toEqual([...places].sort((a, b) => a - b));
        });
        expect(within(blocks[2]).getByText('Automation science pack')).toBeTruthy();
        expect(blocks[2].textContent).toContain('Infiniteassumed from its role');
    });
});

it('leaves the parts and pictures out of the card where the note on why no clock is stable shows them, and keeps the table', () => {
    const { container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, 'euclidean_swings')} causeShownAbove />, { names: gameNames });
    const cause = checkedOf(AUTOMATION_240, 'euclidean_swings').cause!;
    for (const part of [cause.headline.text, cause.where.text, cause.alone.text]) expect(container.textContent).not.toContain(part);
    expect(container.querySelector('[data-picture]')).toBeNull();
    expect(container.textContent).toContain('Made for 9 copies of your build.');
    expect(screen.getByRole('table', { name: 'Shared lanes' })).toBeTruthy();
});

describe('every state has its row as the engine gives it', () => {
    for (const [key, { row, lanes, copies }] of Object.entries(STATES)) {
        it(key, () => {
            const checked = { line: { copies }, rows: [row], cause: null } as unknown as CheckedLanes;
            show(<SharedLanesTable checked={checked} lanes={lanes} level={4} />, { names: gameNames });
            const [shown] = bodyRows(screen.getByRole('table', { name: 'Shared lanes' }));
            expect(within(shown).getByRole('rowheader').textContent).toBe(`Belt ${row.belt_id}, lane ${row.lane}`);
            const state = within(shown).getAllByRole('cell').at(-1)!;
            expect(state.textContent).toBe(row.label + row.sentence);
        });
    }
});
