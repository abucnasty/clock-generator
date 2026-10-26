import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OutputTransferSummary, SerializableMachineFacts } from 'clock-generator/browser';
import { GameNamesContext } from '../hooks/useGameNames';
import { OutputTransferPanel } from './OutputTransferPanel';
import { ResultTargetField } from './ResultTargetField';
import type { ChestFormData } from '../hooks/useConfigForm';

const names = { item: { 'electronic-circuit': 'Electronic circuit', 'advanced-circuit': 'Advanced circuit' }, recipe: {} };
const facts: SerializableMachineFacts = {
    recipe: 'processing-unit-recycling', crafting_speed: 1, productivity: 0, type: 'recycler', output_item: 'electronic-circuit',
    output_per_craft: 3, output_rate_per_second: 0.5, output_block_size: 10, overload_multiplier: 1,
    ticks_per_craft: 60, ticks_per_bonus_craft: 60, insertion_duration_ticks: 1, inputs: [], outputs: [
        { item_name: 'electronic-circuit', amount_per_craft: 3, rate_per_second: 0.5, rate_ratio: { numerator: 1, denominator: 2 }, output_block_size: 10, stochastic: false },
        { item_name: 'advanced-circuit', amount_per_craft: 1.5, rate_per_second: 0.25, rate_ratio: { numerator: 1, denominator: 4 }, output_block_size: 10, stochastic: true },
    ],
};

function render(summary: OutputTransferSummary | null, onFix?: (item: string) => void, loading = false, chests: ChestFormData[] = []) {
    return renderToStaticMarkup(<GameNamesContext.Provider value={names}><OutputTransferPanel summary={summary} chests={chests} facts={facts} fallbackItems={facts.outputs?.map(output => output.item_name)} loading={loading} onFix={onFix} /></GameNamesContext.Provider>);
}

it('keeps all known products visible while route data is pending', () => {
    const html = render(null, undefined, true);
    expect(html).toContain('Checking output routes…');
    expect(html).toContain('Electronic circuit');
    expect(html).toContain('Advanced circuit');
    expect(html).toContain('Expected 1.5 per craft');
    expect(html).toContain('Output routes unavailable');
});

it('shows both recycler results, a single accepted direct target, and the separate actual inserter route', () => {
    const summary: OutputTransferSummary = {
        source: { type: 'machine', id: 7 }, physical_target: { type: 'machine', id: 3 }, mechanism: 'result-placement', status: 'known', results: [
            { item_name: 'electronic-circuit', direct: 'accepted', inserters: [], coverage: 'covered' },
            { item_name: 'advanced-circuit', direct: 'rejected', inserters: [{ inserter_id: 4, target: { type: 'belt', id: 2 } }], coverage: 'covered' },
        ],
    };
    const html = render(summary);
    expect(html).toContain('Output transfer');
    expect(html).toContain('Electronic circuit');
    expect(html).toContain('Advanced circuit');
    expect(html).toContain('Direct to Machine 3');
    expect(html).toContain('Stays in machine output');
    expect(html).toContain('Inserter 4 → Belt 2');
    expect(html).toContain('Expected 1.5 per craft');
});

it('distinguishes known missing output from unavailable route data and links to the existing repair action', () => {
    const fix = vi.fn();
    const missing: OutputTransferSummary = {
        source: { type: 'machine', id: 7 }, physical_target: null, mechanism: 'result-placement', status: 'known', results: [
            { item_name: 'advanced-circuit', direct: 'none', inserters: [], coverage: 'missing' },
        ],
    };
    const html = render(missing, fix);
    expect(html).toContain('No route for this item');
    expect(html).toContain('Fix output route');
    const unknown = render({ ...missing, status: 'unavailable', results: [{ ...missing.results[0], direct: 'unknown', coverage: 'unknown' }] });
    expect(unknown).toContain('Output routes unavailable');
    expect(unknown).not.toContain('Fix output route');
});

it('shows the observed zero-acceptance target without drawing a direct product route', () => {
    const summary: OutputTransferSummary = {
        source: { type: 'machine', id: 7 }, physical_target: { type: 'machine', id: 8 }, mechanism: 'result-placement', status: 'known', results: [
            { item_name: 'advanced-circuit', direct: 'rejected', inserters: [], coverage: 'missing' },
        ],
    };
    expect(render(summary)).toContain('This target currently takes none of these results. Change the target or its settings, or remove the results with inserters.');
    expect(render(summary)).not.toContain('enable “Also remove unfiltered items”');
});

it('identifies enabling infinity-chest removal as an alternative for rejected direct outputs', () => {
    const summary: OutputTransferSummary = {
        source: { type: 'machine', id: 7 }, physical_target: { type: 'chest', id: 3 }, mechanism: 'result-placement', status: 'known', results: [
            { item_name: 'advanced-circuit', direct: 'rejected', inserters: [], coverage: 'missing' },
        ],
    };
    const chest = { id: 3, _uuid: 'chest-3', type: 'infinity-chest', item_filter: [{ item_name: 'iron-plate', request_count: 200 }], remove_unfiltered_items: false } satisfies ChestFormData;
    expect(render(summary, undefined, false, [chest])).toContain('On Chest 3, enable “Also remove unfiltered items” to accept these results directly.');
    expect(render(summary)).not.toContain('enable “Also remove unfiltered items”');
    expect(render(summary, undefined, false, [{ ...chest, remove_unfiltered_items: true }])).not.toContain('enable “Also remove unfiltered items”');
    expect(render({ ...summary, results: [{ ...summary.results[0], direct: 'accepted', coverage: 'covered' }] }, undefined, false, [chest])).not.toContain('enable “Also remove unfiltered items”');
});

it('starts a compact machine row with its physical target visible and route details unmounted', () => {
    const summary: OutputTransferSummary = {
        source: { type: 'machine', id: 7 }, physical_target: null, mechanism: 'result-placement', status: 'known', results: [
            { item_name: 'electronic-circuit', direct: 'none', inserters: [{ inserter_id: 4, target: { type: 'belt', id: 2 } }], coverage: 'covered' },
            { item_name: 'advanced-circuit', direct: 'none', inserters: [{ inserter_id: 5, target: { type: 'belt', id: 3 } }], coverage: 'covered' },
        ],
    };
    const html = renderToStaticMarkup(<GameNamesContext.Provider value={names}>
        <OutputTransferPanel collapsible summary={summary} chests={[]} facts={facts}
            control={<ResultTargetField machine={{ id: 7 }} machineLabel="Machine 7"
                build={{ machines: [], chests: [], belts: [], inserters: [], drills: [] }} onChange={() => {}} />} />
    </GameNamesContext.Provider>);
    expect(html).toContain('aria-label="Direct output target, Machine 7"');
    expect(html).toContain('No direct receiver (ground)');
    expect(html).toContain('Output routes (2)');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    expect(html).not.toContain('Electronic circuit');
    expect(html).not.toContain('Inserter 4');
    expect(html).not.toContain('Expected 1.5 per craft');
});

it('keeps missing-route counts and generation refusals visible while details are collapsed', () => {
    const summary: OutputTransferSummary = {
        source: { type: 'machine', id: 7 }, physical_target: { type: 'machine', id: 8 }, mechanism: 'result-placement', status: 'known', results: [
            { item_name: 'advanced-circuit', direct: 'rejected', inserters: [], coverage: 'missing' },
        ],
    };
    const html = renderToStaticMarkup(<OutputTransferPanel collapsible summary={summary} chests={[]} facts={facts}
        generationIssues={[{ code: 'no-accepted-results', machine_id: 7, target_machine_id: 8, accepted_items: [], message: 'This physical target cannot be clocked.' }]} />);
    expect(html).toContain('1 output needs a route');
    expect(html).toContain('This physical target cannot be clocked.');
    expect(html).not.toContain('This target currently takes none of these results.');
});

it('keeps loading and unavailable states distinct from a missing route in compact rows', () => {
    const renderCompact = (loading: boolean) => renderToStaticMarkup(<OutputTransferPanel collapsible summary={null} chests={[]} facts={facts} loading={loading} />);
    expect(renderCompact(true)).toContain('Checking output routes…');
    expect(renderCompact(false)).toContain('Output routes unavailable');
    expect(renderCompact(false)).not.toContain('needs a route');
});
