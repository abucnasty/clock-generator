// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { MachineTargetRate, SerializableMachineFacts } from 'clock-generator/browser';
import { names, show } from '../test/fixtures';
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
const itemNames = names({ 'electronic-circuit': 'Electronic circuit', 'advanced-circuit': 'Advanced circuit' });

it.each([
    { rate: 'its maximum', atTarget: false, targetRate: undefined, production: 'Maximum',
        results: ['Electronic circuit: 0.5/s', 'Advanced circuit: 0.25/s expected'], notes: ['Expected'] },
    { rate: 'its own at-target rate', atTarget: true, targetRate: rates, production: 'At-target',
        results: ['Electronic circuit: 0.4/s', 'Advanced circuit: 0.2/s expected'], notes: ['Expected'] },
    // not a zero, nor a rate from an earlier target
    { rate: 'capacity without at-target data', atTarget: true, targetRate: undefined, production: 'Maximum',
        results: ['Electronic circuit: 0.5/s', 'Advanced circuit: 0.25/s expected'], notes: ['Capacity', 'Expected', 'Capacity', 'At-target rate unavailable'] },
])('shows every result inline, a coproduct as expected, at $rate', ({ atTarget, targetRate, production, results, notes }) => {
    show(<MachineProductionSummary facts={facts} targetRate={targetRate} atTarget={atTarget} />, { names: itemNames });
    const summary = within(screen.getByRole('group', { name: `${production} production per machine` }));
    expect(summary.getAllByRole('img')).toEqual(results.map(name => summary.getByRole('img', { name })));
    expect(screen.getAllByText(/^(Expected|Capacity|At-target rate unavailable)$/).map(note => note.textContent)).toEqual(notes);
});
