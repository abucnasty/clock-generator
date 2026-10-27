import { expect, it } from 'vitest';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OutputTransferSummary } from 'clock-generator/browser';
import { GameNamesContext } from '../hooks/useGameNames';
import type { ResultTargetBuild } from '../utils/resultTarget';
import { InputRoutesPanel } from './InputRoutesPanel';

const names = { item: { iron: 'Iron', copper: 'Copper', fuel: 'Fuel' }, recipe: {} };
const build = (overrides: Partial<ResultTargetBuild> = {}): ResultTargetBuild => ({
    machines: [{ id: 1, recipe: 'smelt', fuel: 'fuel' } as unknown as ResultTargetBuild['machines'][number]],
    belts: [{ id: 2, lanes: [{ ingredient: 'iron' }, { ingredient: 'copper' }] } as unknown as ResultTargetBuild['belts'][number]],
    chests: [], inserters: [], drills: [], ...overrides,
});
const summary = (source: OutputTransferSummary['source'], target: OutputTransferSummary['physical_target'], item: string, direct: OutputTransferSummary['results'][number]['direct'], mechanism: OutputTransferSummary['mechanism'] = 'result-placement'): OutputTransferSummary => ({
    source, physical_target: target, mechanism, status: 'known', results: [{ item_name: item, direct, inserters: [], coverage: direct === 'accepted' ? 'covered' : 'unknown' }],
});
const render = (props: Partial<ComponentProps<typeof InputRoutesPanel>> = {}) => renderToStaticMarkup(<GameNamesContext.Provider value={names}>
    <InputRoutesPanel machineId={1} build={build()} inputs={['iron', 'fuel']} transfers={[]} {...props} />
</GameNamesContext.Provider>);

it('shows configured belt routes only for recipe/fuel inputs and preserves source filtering', () => {
    const html = render({ build: build({ inserters: [
        { id: 4, source: { type: 'belt', id: 2 }, sink: { type: 'machine', id: 1 }, filters: ['iron'] } as unknown as ResultTargetBuild['inserters'][number],
    ] }), onEditInserter: () => {} });
    expect(html).toContain('Iron');
    expect(html).toContain('From Belt 2');
    expect(html).toContain('Edit Inserter 4');
    expect(html).not.toContain('Copper');
});

it('omits blacklisted source items and shows accepted direct and drill-drop routes only', () => {
    const direct = summary({ type: 'machine', id: 8 }, { type: 'machine', id: 1 }, 'iron', 'accepted');
    const rejected = summary({ type: 'machine', id: 9 }, { type: 'machine', id: 1 }, 'fuel', 'rejected');
    const unknown = summary({ type: 'machine', id: 10 }, { type: 'machine', id: 1 }, 'fuel', 'unknown');
    const drill = summary({ type: 'drill', id: 3 }, { type: 'machine', id: 1 }, 'fuel', 'accepted', 'mining-drop');
    const html = render({
        build: build({ inserters: [{ id: 5, source: { type: 'belt', id: 2 }, sink: { type: 'machine', id: 1 }, filters: ['copper'], filter_mode: 'blacklist' } as unknown as ResultTargetBuild['inserters'][number]] }),
        transfers: [direct, rejected, unknown, drill],
    });
    expect(html).toContain('Direct machine output: Machine 8');
    expect(html).toContain('Drill drop: Drill 3');
    expect(html).not.toContain('Direct machine output: Machine 9');
    expect(html).not.toContain('Direct machine output: Machine 10');
    expect(html).not.toContain('Copper');
});

it('keeps unavailable metadata distinct from a known empty input and exposes unknown source connections', () => {
    const missing = render({ transfers: null });
    expect(missing).toContain('Input route details unavailable');
    expect(missing).toContain('Input routes unavailable');
    const unavailable = render({ transfers: [{ ...summary({ type: 'machine', id: 8 }, { type: 'machine', id: 1 }, 'iron', 'unknown'), status: 'unavailable' }] });
    expect(unavailable).toContain('Some input route details unavailable');
    expect(unavailable).toContain('Input routes unavailable');
    const extra = render({ build: build({ inserters: [{ id: 6, source: { type: 'belt', id: 2 }, sink: { type: 'machine', id: 1 } } as unknown as ResultTargetBuild['inserters'][number]] }) });
    expect(extra).toContain('Unassigned configured connections');
    expect(extra).toContain('Copper');
    expect(extra).toContain('item not in known inputs');
});

it('retains a configured fuel input from source facts even when the machine form has no fuel field', () => {
    const html = render({ build: build({
        machines: [{ id: 1, recipe: 'smelt' } as unknown as ResultTargetBuild['machines'][number]],
        belts: [{ id: 2, lanes: [{ ingredient: 'fuel' }] } as unknown as ResultTargetBuild['belts'][number]],
        inserters: [{ id: 7, source: { type: 'belt', id: 2 }, sink: { type: 'machine', id: 1 } } as unknown as ResultTargetBuild['inserters'][number]],
    }) });
    expect(html).toContain('Fuel');
    expect(html).toContain('From Belt 2');
});

it('shows configured routes with missing source items and scopes unavailable transfer data to relevant routes', () => {
    const missingSource = render({ build: build({
        belts: [], inserters: [{ id: 8, source: { type: 'belt', id: 99 }, sink: { type: 'machine', id: 1 } } as unknown as ResultTargetBuild['inserters'][number]],
    }), onEditInserter: () => {} });
    expect(missingSource).toContain('source items unavailable or none inferred');
    expect(missingSource).toContain('Edit Inserter 8');

    const unrelatedUnavailable = summary({ type: 'machine', id: 77 }, null, 'iron', 'unknown');
    unrelatedUnavailable.status = 'unavailable';
    const scoped = render({ transfers: [unrelatedUnavailable] });
    expect(scoped).not.toContain('Some input route details unavailable');
    expect(scoped).toContain('No known incoming route');
});

it('keeps explicit inserter route facts when a machine transfer summary is otherwise unavailable', () => {
    const knownRoute = summary({ type: 'machine', id: 9 }, null, 'iron', 'unknown');
    knownRoute.status = 'unavailable';
    knownRoute.results[0].inserters = [{ inserter_id: 10, target: { type: 'machine', id: 1 } }];
    const html = render({
        build: build({ inserters: [{ id: 10, source: { type: 'machine', id: 9 }, sink: { type: 'machine', id: 1 } } as unknown as ResultTargetBuild['inserters'][number]] }),
        transfers: [knownRoute],
    });
    expect(html).toContain('Configured machine inserter: Machine 9 → Machine 1');
    expect(html).toContain('Some input route details unavailable');
});

it('marks per-input fallback unavailable when an incoming machine source has no transfer DTO', () => {
    const html = render({ build: build({
        inserters: [{ id: 11, source: { type: 'machine', id: 9 }, sink: { type: 'machine', id: 1 } } as unknown as ResultTargetBuild['inserters'][number]],
    }), transfers: [] });
    expect(html).toContain('Input routes unavailable');
    expect(html).toContain('item route unavailable');
    expect(html).not.toContain('No known incoming route');
});

it('keeps an inserter visible when its filters exclude every source item', () => {
    const html = render({ build: build({
        inserters: [{ id: 12, source: { type: 'belt', id: 2 }, sink: { type: 'machine', id: 1 }, filters: ['not-on-belt'] } as unknown as ResultTargetBuild['inserters'][number]],
    }), onEditInserter: () => {} });
    expect(html).toContain('all inferred items excluded by inserter filters');
    expect(html).toContain('Edit Inserter 12');
});

it('shows configured direct and drill targets as unassigned when their transfer DTOs are absent', () => {
    const html = render({ build: build({
        machines: [
            { id: 1, recipe: 'smelt' },
            { id: 13, recipe: 'ore', result_target: { type: 'machine', id: 1 } },
        ] as unknown as ResultTargetBuild['machines'],
        drills: [{ id: 14, target: { type: 'machine', id: 1 }, mined_item_name: 'iron' } as unknown as ResultTargetBuild['drills'][number]],
    }), transfers: [] });
    expect(html).toContain('Configured direct output: Machine 13 → Machine 1 · acceptance unavailable');
    expect(html).toContain('Configured drill drop: Drill 14 → Machine 1 · acceptance unavailable');
    expect(html).toContain('Input routes unavailable');
    expect(html).not.toContain('No known incoming route');
    expect(html).not.toContain('Direct machine output: Machine 13');
    expect(html).not.toContain('Drill drop: Drill 14');
});
