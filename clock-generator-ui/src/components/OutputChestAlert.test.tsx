import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChestType } from 'clock-generator/light';
import { GameNamesContext } from '../hooks/useGameNames';
import { OutputChestAlert } from './OutputChestAlert';
import type { ChestFormData, InserterFormData } from '../hooks/useConfigForm';

it('explains the output blockage and names the exact chest in its repair action', () => {
    const chest: ChestFormData = { id: 7, _uuid: 'chest-7', type: ChestType.BUFFER_CHEST, storage_size: 1, item_filter: 'iron-plate' };
    const inserter: InserterFormData = { id: 1, _uuid: 'inserter-1', stack_size: 16, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 7 } };
    const render = (chests: ChestFormData[], inserters: InserterFormData[]) => renderToStaticMarkup(<GameNamesContext.Provider value={{ item: { 'iron-plate': 'Iron plate' }, recipe: {} }}><OutputChestAlert chests={chests} inserters={inserters} onSwitchType={() => {}} onEnableRemoval={() => {}} /></GameNamesContext.Provider>);
    const html = render([chest], [inserter]);
    expect(html).toContain('aria-label="Build validation"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('No inserter takes iron plate out of this buffer chest.');
    expect(html).toContain('Chest 7 can fill up and block output');
    expect(html).toContain('Use infinity chest for Chest 7');
    expect(html).toContain('model output being taken away continuously');
    expect(render([chest], [])).toBe('');
});

it('offers an enable-removal fix on the existing infinity chest with its own icon', () => {
    const chest: ChestFormData = { id: 7, _uuid: 'chest-7', type: ChestType.INFINITY_CHEST, item_filter: [] };
    const inserter: InserterFormData = { id: 1, _uuid: 'inserter-1', stack_size: 16, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 7 } };
    const render = (current = chest) => renderToStaticMarkup(<OutputChestAlert chests={[current]} inserters={[inserter]} onSwitchType={() => {}} onEnableRemoval={() => {}} />);
    expect(render()).toContain('Chest 7 needs output removal enabled');
    expect(render()).toContain('An inserter already delivers to this infinity chest');
    expect(render()).toContain('Enable Remove unfiltered items for Chest 7');
    expect(render()).toContain('id="validation-issue-chest:7:removal-disabled"');
    expect(render()).toContain('infinity-chest');
    expect(render({ ...chest, remove_unfiltered_items: true })).toBe('');
});

it('warns of a car, a tank, a cargo wagon or a rocket silo at the end of a line, each with its own icon', () => {
    const into: InserterFormData = { id: 1, _uuid: 'inserter-1', stack_size: 16, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 7 } };
    const out: InserterFormData = { id: 2, _uuid: 'inserter-2', stack_size: 16, source: { type: 'chest', id: 7 }, sink: { type: 'machine', id: 2 } };
    const render = (chest: ChestFormData, inserters = [into]) => renderToStaticMarkup(
        <OutputChestAlert chests={[chest]} inserters={inserters} onSwitchType={() => {}} onEnableRemoval={() => {}} />);
    for (const [type, text] of [[ChestType.CAR, 'out of this car.'], [ChestType.TANK, 'out of this tank.'],
        [ChestType.CARGO_WAGON, 'or swap it at a station'], [ChestType.ROCKET_SILO, 'launches rockets, which the simulator does not model yet']] as const) {
        const chest = { id: 7, _uuid: 'chest-7', type } as ChestFormData;
        const html = render(chest);
        expect(html).toContain('Chest 7 can fill up and block output');
        expect(html).toContain(text);
        expect(html).toContain(`/icons/${type}.png`);
        expect(html).toContain('Use infinity chest for Chest 7');
        // a container between two inserters holds the line: no warning
        expect(render(chest, [into, out])).toBe('');
    }
});
