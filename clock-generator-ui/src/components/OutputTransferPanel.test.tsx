// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import type { OutputTransferSummary, SerializableMachineFacts } from 'clock-generator/browser';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { infinityChest, names, show } from '../test/fixtures';
import { RESULT_TARGET_TEXT, resultTargetName } from '../utils/resultTarget';
import { OutputTransferPanel } from './OutputTransferPanel';
import { ResultTargetField } from './ResultTargetField';

type Result = OutputTransferSummary['results'][number];
/** A recycler of 3 electronic circuits and an expected 1.5 advanced circuits a craft */
const facts: SerializableMachineFacts = {
    recipe: 'processing-unit-recycling', crafting_speed: 1, productivity: 0, type: 'recycler', output_item: 'electronic-circuit',
    output_per_craft: 3, output_rate_per_second: 0.5, output_block_size: 10, overload_multiplier: 1,
    ticks_per_craft: 60, ticks_per_bonus_craft: 60, insertion_duration_ticks: 1, inputs: [], outputs: [
        { item_name: 'electronic-circuit', amount_per_craft: 3, rate_per_second: 0.5, rate_ratio: { numerator: 1, denominator: 2 }, output_block_size: 10, stochastic: false },
        { item_name: 'advanced-circuit', amount_per_craft: 1.5, rate_per_second: 0.25, rate_ratio: { numerator: 1, denominator: 4 }, output_block_size: 10, stochastic: true },
    ],
};
/** What the engine says came of machine 7's results at the target it places them into */
const transfer = (physical_target: OutputTransferSummary['physical_target'], ...results: Result[]): OutputTransferSummary =>
    ({ source: { type: 'machine', id: 7 }, physical_target, mechanism: 'result-placement', status: 'known', results });
const result = (item_name: string, direct: Result['direct'], coverage: Result['coverage'], ...inserters: Result['inserters']): Result =>
    ({ item_name, direct, coverage, inserters });
const MACHINE_8 = { type: 'machine', id: 8 } as const, CHEST_3 = { type: 'chest', id: 3 } as const;
/** Advanced circuits the target takes none of, with nothing else to take them away */
const REJECTED = result('advanced-circuit', 'rejected', 'missing');
/** Chest 3, which takes its iron plates and keeps everything else out */
const keeping = infinityChest(3, { item_filter: [{ item_name: 'iron-plate', request_count: 200 }], remove_unfiltered_items: false });

type Props = Partial<ComponentProps<typeof OutputTransferPanel>>;
const panel = (props: Props = {}) => <OutputTransferPanel summary={null} chests={[]} facts={facts} {...props} />;
const showPanel = (props?: Props) => show(panel(props), { names: names({ 'electronic-circuit': 'Electronic circuit', 'advanced-circuit': 'Advanced circuit' }) });
const product = (name: string) => within(screen.getByRole('group', { name }));
const products = (scope: Pick<typeof screen, 'getAllByRole'> = screen) => scope.getAllByRole('group').map(group => group.getAttribute('aria-label'));
const ADVANCED_RATE = 'Expected 1.5 per craft · Expected capacity: 0.25/s', UNAVAILABLE = 'Output routes unavailable';
const TAKES_NONE = 'This target currently takes none of these results. Change the target or its settings, or remove the results with inserters.';
const ENABLE_REMOVAL = 'On Chest 3, enable “Also remove unfiltered items” to accept these results directly.';
/** The notices above the products, in full */
const notices = () => screen.queryAllByText(/takes none of these results|Also remove unfiltered items/).map(notice => notice.textContent);

it('keeps all known products visible while route data is pending', () => {
    showPanel({ loading: true });
    expect(screen.getByText('Checking output routes…')).toBeDefined();
    expect(products()).toEqual(['Electronic circuit', 'Advanced circuit']);
    expect(product('Electronic circuit').getByText('3 per craft · Capacity: 0.5/s')).toBeDefined();
    expect(product('Advanced circuit').getByText(ADVANCED_RATE)).toBeDefined();
    for (const name of products()) expect(product(name!).getByText(UNAVAILABLE)).toBeDefined();
});

it('shows both recycler results, a single accepted direct target, and the separate actual inserter route', () => {
    showPanel({ summary: transfer({ type: 'machine', id: 3 }, result('electronic-circuit', 'accepted', 'covered'),
        result('advanced-circuit', 'rejected', 'covered', { inserter_id: 4, target: { type: 'belt', id: 2 } })) });
    expect(screen.getByRole('region', { name: 'Output transfer' })).toBeDefined();
    expect(screen.getAllByText(/^Direct to /)).toEqual([product('Electronic circuit').getByText('Direct to Machine 3')]);
    expect(product('Electronic circuit').queryByText(/Inserter/)).toBeNull();
    expect(product('Advanced circuit').getByText('Stays in machine output')).toBeDefined();
    expect(product('Advanced circuit').getByText('Inserter 4 → Belt 2')).toBeDefined();
    expect(product('Advanced circuit').getByText(ADVANCED_RATE)).toBeDefined();
});

it('distinguishes known missing output from unavailable route data and links to the existing repair action', async () => {
    const onFix = vi.fn();
    const missing = transfer(null, result('advanced-circuit', 'none', 'missing'));
    const { user, rerender } = showPanel({ summary: missing, onFix });
    expect(product('Advanced circuit').getByText('No route for this item')).toBeDefined();
    await user.click(product('Advanced circuit').getByRole('button', { name: 'Fix output route' }));
    expect(onFix).toHaveBeenCalledExactlyOnceWith('advanced-circuit');

    rerender(panel({ summary: { ...missing, status: 'unavailable', results: [result('advanced-circuit', 'unknown', 'unknown')] }, onFix }));
    // one overall notice and one item status, without repeating the item's unknown direct/coverage facts
    expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(2);
    expect(product('Advanced circuit').getAllByText(UNAVAILABLE)).toHaveLength(1);
    expect(screen.queryByText('No route for this item')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
});

it.each([
    { why: 'a machine', target: MACHINE_8, chests: [], shown: [TAKES_NONE] },
    { why: 'a chest the build does not have', target: CHEST_3, chests: [], shown: [TAKES_NONE] },
    { why: 'an infinity chest without removal', target: CHEST_3, chests: [keeping], shown: [TAKES_NONE, ENABLE_REMOVAL] },
    { why: 'an infinity chest with removal on', target: CHEST_3, chests: [{ ...keeping, remove_unfiltered_items: true }], shown: [TAKES_NONE] },
    { why: 'an infinity chest that takes them', target: CHEST_3, chests: [keeping], shown: [], direct: 'Direct to Chest 3' },
])('says what $why at the output does with the results, offering removal only where it would take them', ({ target, chests, shown, direct }) => {
    showPanel({ summary: transfer(target, direct ? result('advanced-circuit', 'accepted', 'covered') : REJECTED), chests });
    expect(notices()).toEqual(shown);
    // a direct route only to a target that takes the result
    expect(screen.queryByText(/^Direct to /)?.textContent).toBe(direct);
});

it('starts a compact machine row with its physical target visible and route details unmounted until disclosed', async () => {
    const summary = transfer(null, result('electronic-circuit', 'none', 'covered', { inserter_id: 4, target: { type: 'belt', id: 2 } }),
        result('advanced-circuit', 'none', 'covered', { inserter_id: 5, target: { type: 'belt', id: 3 } }));
    const { user } = showPanel({ collapsible: true, summary, control: <ResultTargetField machine={{ id: 7 }} machineLabel="Machine 7"
        build={{ machines: [], chests: [], belts: [], inserters: [], drills: [] }} onChange={vi.fn()} /> });
    expect(screen.getByRole('combobox', { name: resultTargetName('Machine 7') }).textContent).toBe(RESULT_TARGET_TEXT.none);
    const routes = screen.getByRole('button', { name: 'Output routes (2)' });
    const details = document.getElementById(routes.getAttribute('aria-controls')!)!;
    expect(routes.getAttribute('aria-expanded')).toBe('false');
    expect(details.hidden).toBe(true);
    expect(screen.queryByText(/Electronic circuit|Inserter 4|per craft/)).toBeNull();

    await user.click(routes);
    expect(routes.getAttribute('aria-expanded')).toBe('true');
    expect(details.hidden).toBe(false);
    expect(products(within(details))).toEqual(['Electronic circuit', 'Advanced circuit']);
    expect(product('Electronic circuit').getByText('Inserter 4 → Belt 2')).toBeDefined();
    expect(product('Advanced circuit').getByText(ADVANCED_RATE)).toBeDefined();
});

it('keeps missing-route counts and generation refusals visible while details are collapsed', () => {
    showPanel({ collapsible: true, summary: transfer(MACHINE_8, REJECTED), generationIssues: [
        { code: 'no-accepted-results', machine_id: 7, target_machine_id: 8, accepted_items: [], message: 'This physical target cannot be clocked.' },
    ] });
    expect(screen.getByText('1 output needs a route')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toBe('This physical target cannot be clocked.');
    expect(notices()).toEqual([]);
});

it.each([
    { loading: true, status: 'Checking output routes…' },
    { loading: false, status: UNAVAILABLE },
])('says $status in a compact row without route data, never that a route is missing', ({ loading, status }) => {
    showPanel({ collapsible: true, loading });
    expect(screen.getByText(status)).toBeDefined();
    expect(screen.queryByText(/needs? a route/)).toBeNull();
});
