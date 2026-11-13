// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CheckedLanes } from 'clock-generator/browser';
import { names, show } from '../test/fixtures';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330, MILITARY_240, STATES, viewOf } from '../test/checkedLanesFixtures';
import { rowSentenceShown } from '../utils/checkedLanes';
import { DIAGNOSTICS_COPY } from '../utils/diagnostics';
import { LaneDiagnostics, SharedLanesTable } from './CheckedLanesView';

const gameNames = names({ 'iron-gear-wheel': 'Iron gear wheel', 'copper-plate': 'Copper plate', 'automation-science-pack': 'Automation science pack',
    'accumulator': 'Accumulator', 'supercapacitor': 'Supercapacitor', 'military-science-pack': 'Military science pack', 'stone-wall': 'Stone wall',
    'piercing-rounds-magazine': 'Piercing rounds magazine', 'iron-plate': 'Iron plate' });

const COLUMNS = ['Lane', 'Role', 'Item', 'End', 'Planned for the 9 copies', 'Supply rate', 'State'];

/** The table's rows below its header, each as its cells' text */
const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

/** A row's State cell: the engine's label, then its sentence where the table shows it */
const stateText = (row: CheckedLanes['rows'][number]) => row.label + (rowSentenceShown(row) ?? '');

/** Where each text is in the rendered text, in the order given; -1 where it is not there */
const placesIn = (text: string, parts: string[]) => parts.map(part => text.indexOf(part));

describe('a clock without a cause', () => {
    const stable = checkedOf(AUTOMATION_240, 'time_study_windows');

    it('says the engine\'s line, then the table open: no control, and not what it is made for (the card says it)', () => {
        const { container } = show(<LaneDiagnostics clock={viewOf(AUTOMATION_240, 'time_study_windows')} />, { names: gameNames });
        expect(container.textContent).not.toContain('Made for 9 copies of your build.');
        expect(container.textContent!.indexOf(stable.line.sentence)).toBe(0);
        expect(screen.queryByRole('button')).toBeNull();
        const table = screen.getByRole('table', { name: 'Shared lanes' });
        expect(within(table).getAllByRole('columnheader').map(it => it.textContent)).toEqual(COLUMNS);
        const rows = bodyRows(table);
        expect(rows.map(row => within(row).getByRole('rowheader').textContent)).toEqual(stable.rows.map(row => `Belt ${row.belt_id}, lane ${row.lane}`));
        // a lane that holds says it in its label: its sentence, "Every copy gets its items.", would repeat it; the output lane's
        // sentence, where copies wait at their join, adds a fact
        rows.forEach((row, index) => {
            expect(row.textContent!.endsWith(stateText(stable.rows[index]))).toBe(true);
            if (rowSentenceShown(stable.rows[index]) === null) expect(row.textContent).not.toContain(stable.rows[index].sentence);
        });
        expect(rows[0].textContent).toBe('Belt 1, lane 1InputIron gear wheelDead endtake 120 /s120 /slane capacity' + stable.rows[0].label);
        expect(rows[2].textContent).toBe('Belt 2, lane 1OutputAutomation science packInfiniteassumed from its roledrop 240 /son lanes 1 and 2—carries 240 /s'
            + stable.rows[2].label + stable.rows[2].sentence);
        expect(screen.getByText('3 lanes · all hold')).toBeTruthy();
    });

    it('that was not run with the copies shows the engine\'s line for it and never "holds"', async () => {
        const notRun = checkedOf(AUTOMATION_240, 'takt_batches_observed_swings_4');
        const { container } = show(<LaneDiagnostics clock={viewOf(AUTOMATION_240, 'takt_batches_observed_swings_4')} />, { names: gameNames });
        expect(container.textContent).toContain(notRun.line.sentence);
        expect(bodyRows(screen.getByRole('table'))).toHaveLength(3);
        expect(container.textContent).not.toMatch(/holds/i);
    });

    it('drops into chests: the engine\'s line names the chest, and no output lane has a row', async () => {
        const chests = checkedOf(ELECTROMAGNETIC_330, 'takt_batches_observed');
        const { container } = show(<LaneDiagnostics clock={viewOf(ELECTROMAGNETIC_330, 'takt_batches_observed')} />, { names: gameNames });
        expect(container.textContent).toContain(chests.line.sentence);
        const rows = bodyRows(screen.getByRole('table', { name: 'Shared lanes' }));
        expect(rows.map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual(['Input', 'Input']);
        expect(rows.map(row => within(row).getAllByRole('cell')[1].textContent)).toEqual(['Accumulator', 'Supercapacitor']);
    });

    it('drops onto two plain output belts: two rows whose rate fits, each with the engine\'s sentence', async () => {
        const plain = checkedOf(MILITARY_240, 'coordinated_sources');
        const { container } = show(<LaneDiagnostics clock={viewOf(MILITARY_240, 'coordinated_sources')} />, { names: gameNames });
        expect(container.textContent).toContain(plain.line.sentence);
        const fits = bodyRows(screen.getByRole('table')).filter(row => row.getAttribute('data-lane-state') === 'rate_fits');
        expect(fits.map(row => within(row).getByRole('rowheader').textContent)).toEqual(['Belt 1, lane 1', 'Belt 2, lane 1']);
        for (const [index, row] of fits.entries()) {
            const engine = plain.rows.filter(it => it.state.kind === 'rate_fits')[index];
            expect(row.textContent).toContain(engine.label);
            expect(row.textContent).toContain(engine.sentence);
        }
        expect(screen.getByText('6 lanes · 2 by rate only · 4 hold')).toBeTruthy();
    });

    it('of a build of one copy says that it shares no lane, and has no table', () => {
        const one = { ...viewOf(AUTOMATION_240, 'time_study_windows'), copies: 1, checkedLanes: undefined };
        const { container } = show(<LaneDiagnostics clock={one} />, { names: gameNames });
        expect(container.textContent).toBe('A build of one copy shares no lane.');
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
    });

    it('of a result kept before the engine checked the shared lanes says so, and has no table', () => {
        const view = viewOf(AUTOMATION_240, 'time_study_windows');
        const kept = { ...view, checkedLanes: undefined, assumptions: { ...view.assumptions, lanes: undefined } };
        const { container } = show(<LaneDiagnostics clock={kept} />, { names: gameNames });
        expect(container.textContent).toBe(DIAGNOSTICS_COPY.keptBefore);
        expect(screen.queryByRole('table')).toBeNull();
    });
});

describe('a clock with a cause', () => {
    it('of 72 ticks shows its headline and pictures, then the table open without a click', () => {
        const short = checkedOf(AUTOMATION_240, 'euclidean_swings');
        const cause = short.cause!;
        const { container } = show(<LaneDiagnostics clock={viewOf(AUTOMATION_240, 'euclidean_swings')} />, { names: gameNames });
        const text = container.textContent!;
        const parts = [cause.headline.text, 'Missed swings, copy by copy', 'The 65 window cycles of copy 2', 'Read this as text', 'Shared lanes'];
        const places = placesIn(text, parts);
        expect(places.every(place => place >= 0)).toBe(true);
        expect(places).toEqual([...places].sort((a, b) => a - b));
        expect(screen.queryByRole('button', { name: 'What was checked' })).toBeNull();
        const rows = bodyRows(screen.getByRole('table', { name: 'Shared lanes' }));
        expect(rows.map(row => row.getAttribute('data-lane-state'))).toEqual(short.rows.map(row => row.state.kind));
        rows.forEach((row, index) => expect(row.textContent).toContain(stateText(short.rows[index])));
    });

    it('of 216 ticks, at a full join, shows its headline and pictures: no spacing where the engine gives none', () => {
        const join = checkedOf(AUTOMATION_240, 'takt_batches_observed');
        const cause = join.cause!;
        expect(cause.spacing).toBeNull();
        const { container } = show(<LaneDiagnostics clock={viewOf(AUTOMATION_240, 'takt_batches_observed')} />, { names: gameNames });
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
            const places = [`Lane Belt ${row.belt_id}, lane ${row.lane}`, row.label, row.sentence, 'Role', 'Item', 'End', 'Planned for the 9 copies', 'Supply rate']
                .map(part => text.indexOf(part));
            expect(places.every(place => place >= 0)).toBe(true);
            expect(places).toEqual([...places].sort((a, b) => a - b));
        });
        expect(within(blocks[2]).getByText('Automation science pack')).toBeTruthy();
        expect(blocks[2].textContent).toContain('Infiniteassumed from its role');
    });
});

describe('every state has its row as the engine gives it', () => {
    for (const [key, { row, lanes, copies }] of Object.entries(STATES)) {
        it(key, () => {
            const checked = { line: { copies }, rows: [row], cause: null } as unknown as CheckedLanes;
            show(<SharedLanesTable checked={checked} lanes={lanes} level={4} />, { names: gameNames });
            const [shown] = bodyRows(screen.getByRole('table', { name: 'Shared lanes' }));
            expect(within(shown).getByRole('rowheader').textContent).toBe(`Belt ${row.belt_id}, lane ${row.lane}`);
            const state = within(shown).getAllByRole('cell').at(-1)!;
            expect(state.textContent).toBe(stateText(row));
        });
    }
});
