import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MachineTargetRate, SerializableMachineFacts } from 'clock-generator/browser';
import { GameNamesContext } from '../hooks/useGameNames';
import { MachineProductionSummary } from './MachineProductionSummary';

const facts: SerializableMachineFacts = {
    recipe: 'processing-unit-recycling', crafting_speed: 1, productivity: 0, type: 'recycler', output_item: 'electronic-circuit',
    output_per_craft: 3, output_rate_per_second: 0.5, output_block_size: 10, overload_multiplier: 1,
    ticks_per_craft: 60, ticks_per_bonus_craft: 60, insertion_duration_ticks: 1, inputs: [], outputs: [
        { item_name: 'electronic-circuit', amount_per_craft: 3, rate_per_second: 0.5, rate_ratio: { numerator: 1, denominator: 2 }, output_block_size: 10, stochastic: false },
        { item_name: 'advanced-circuit', amount_per_craft: 1.5, rate_per_second: 0.25, rate_ratio: { numerator: 1, denominator: 4 }, output_block_size: 10, stochastic: true },
    ],
};
const rates: MachineTargetRate = { machine_id: 7, output_rate_per_second: 0.4, crafting_share: 0.8, outputs: [
    { item_name: 'electronic-circuit', rate_per_second: 0.4 }, { item_name: 'advanced-circuit', rate_per_second: 0.2 },
] };
const names = { item: { 'electronic-circuit': 'Electronic circuit', 'advanced-circuit': 'Advanced circuit' }, recipe: {} };

it('shows every result inline, including expected coproduct rates, and uses the per-result at-target vector', () => {
    const render = (targetRate?: MachineTargetRate) => renderToStaticMarkup(<GameNamesContext.Provider value={names}>
        <MachineProductionSummary facts={facts} targetRate={targetRate} atTarget={targetRate !== undefined} />
    </GameNamesContext.Provider>);
    const maximum = render();
    expect(maximum).toContain('Electronic circuit');
    expect(maximum).toContain('Advanced circuit');
    expect(maximum).toContain('0.5/s');
    expect(maximum).toContain('0.25/s');
    expect(maximum).toContain('Expected');
    const atTarget = render(rates);
    expect(atTarget).toContain('0.4/s');
    expect(atTarget).toContain('0.2/s');
});

it('falls back to capacity instead of a zero or stale rate when at-target data is unavailable', () => {
    const html = renderToStaticMarkup(<GameNamesContext.Provider value={names}>
        <MachineProductionSummary facts={facts} atTarget />
    </GameNamesContext.Provider>);
    expect(html).toContain('Capacity');
    expect(html).toContain('At-target rate unavailable');
    expect(html).toContain('0.25/s');
});
