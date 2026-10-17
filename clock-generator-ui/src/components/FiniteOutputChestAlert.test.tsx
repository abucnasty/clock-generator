import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChestType } from 'clock-generator/light';
import { GameNamesContext } from '../hooks/useGameNames';
import { FiniteOutputChestAlert } from './FiniteOutputChestAlert';
import type { ChestFormData, InserterFormData } from '../hooks/useConfigForm';

it('explains the output blockage and names the exact chest in its repair action', () => {
    const chest: ChestFormData = { id: 7, _uuid: 'chest-7', type: ChestType.BUFFER_CHEST, storage_size: 1, item_filter: 'iron-plate' };
    const inserter: InserterFormData = { id: 1, _uuid: 'inserter-1', stack_size: 16, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 7 } };
    const render = (chests: ChestFormData[], inserters: InserterFormData[]) => renderToStaticMarkup(<GameNamesContext.Provider value={{ item: { 'iron-plate': 'Iron plate' }, recipe: {} }}><FiniteOutputChestAlert chests={chests} inserters={inserters} onSwitchType={() => {}} /></GameNamesContext.Provider>);
    const html = render([chest], [inserter]);
    expect(html).toContain('role="alert"');
    expect(html).toContain('No inserter takes iron plate out of this buffer chest.');
    expect(html).toContain('Chest 7 can fill up and block output');
    expect(html).toContain('Use infinity chest for Chest 7');
    expect(html).toContain('model output being taken away continuously');
    expect(render([chest], [])).toBe('');
});
