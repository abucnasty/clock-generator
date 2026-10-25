import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OutputTransferSummary, SerializableMachineFacts } from 'clock-generator/browser';
import { GameNamesContext } from '../hooks/useGameNames';
import { OutputTransferPanel } from './OutputTransferPanel';

const names = { item: { 'electronic-circuit': 'Electronic circuit', 'advanced-circuit': 'Advanced circuit' }, recipe: {} };
const facts: SerializableMachineFacts = {
    recipe: 'processing-unit-recycling', crafting_speed: 1, productivity: 0, type: 'recycler', output_item: 'electronic-circuit',
    output_per_craft: 3, output_rate_per_second: 0.5, output_block_size: 10, overload_multiplier: 1,
    ticks_per_craft: 60, ticks_per_bonus_craft: 60, insertion_duration_ticks: 1, inputs: [], outputs: [
        { item_name: 'electronic-circuit', amount_per_craft: 3, rate_per_second: 0.5, rate_ratio: { numerator: 1, denominator: 2 }, output_block_size: 10, stochastic: false },
        { item_name: 'advanced-circuit', amount_per_craft: 1.5, rate_per_second: 0.25, rate_ratio: { numerator: 1, denominator: 4 }, output_block_size: 10, stochastic: true },
    ],
};

function render(summary: OutputTransferSummary | null, onFix?: (item: string) => void, loading = false) {
    return renderToStaticMarkup(<GameNamesContext.Provider value={names}><OutputTransferPanel summary={summary} chests={[]} facts={facts} fallbackItems={facts.outputs?.map(output => output.item_name)} loading={loading} onFix={onFix} /></GameNamesContext.Provider>);
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
    expect(render(summary)).toContain('This target takes none of these results. Inserters must take them from the machine output.');
});
