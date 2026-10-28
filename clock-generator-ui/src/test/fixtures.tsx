/**
 * The build and page pieces tests start from. Each maker returns a row of the form with its usual values, the id it is
 * given and a `_uuid` made from it; a test changes only what it is about: `machine(2, { recipe: 'copper-cable' })`.
 * Add a maker here once a second test needs the same row; `show()` renders inside the page's contexts.
 */
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChestType } from 'clock-generator/light';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { CraftingMachinesContext } from '../hooks/useCraftingMachines';
import { GameNamesContext } from '../hooks/useGameNames';
import { MessageActionsContext } from '../hooks/useMessages';
import type {
    BeltFormData, BufferChestFormData, ConfigFormData, ContainerChestFormData, DrillFormData, InfinityChestFormData, InserterFormData,
    MachineFormData,
} from '../utils/configForm/formData';
import type { CraftingMachineData } from '../worker/types';
import type { GameNames } from '../utils/gameNames';

export const machine = (id = 1, fields: Partial<MachineFormData> = {}): MachineFormData =>
    ({ id, _uuid: `machine-${id}`, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1, ...fields });

/** From machine 1 to chest 1, unless told otherwise */
export const inserter = (id = 1, fields: Partial<InserterFormData> = {}): InserterFormData =>
    ({ id, _uuid: `inserter-${id}`, source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, ...fields });

/** A turbo belt of iron plates on its one lane */
export const belt = (id = 1, fields: Partial<BeltFormData> = {}): BeltFormData =>
    ({ id, _uuid: `belt-${id}`, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }], ...fields });

export const bufferChest = (id = 1, fields: Partial<BufferChestFormData> = {}): BufferChestFormData =>
    ({ id, _uuid: `chest-${id}`, type: ChestType.BUFFER_CHEST, storage_size: 48, item_filter: '', ...fields });

/** One that takes away whatever it is given */
export const infinityChest = (id = 1, fields: Partial<InfinityChestFormData> = {}): InfinityChestFormData =>
    ({ id, _uuid: `chest-${id}`, type: ChestType.INFINITY_CHEST, item_filter: [], remove_unfiltered_items: true, ...fields });

/** A car, a tank, a cargo wagon or a rocket silo, empty */
export const containerChest = (id: number, type: ContainerChestFormData['type'], fields: Partial<ContainerChestFormData> = {}): ContainerChestFormData =>
    ({ id, _uuid: `chest-${id}`, type, ...fields }) as ContainerChestFormData;

/** An electric drill mining iron ore into machine 1 */
export const drill = (id = 1, fields: Partial<DrillFormData> = {}): DrillFormData =>
    ({ id, _uuid: `drill-${id}`, type: 'electric-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0, productivity: 0,
        target: { type: 'machine', id: 1 }, ...fields });

/** A build of the given rows, making a gear wheel a second with one machine, unless told otherwise */
export const build = (fields: Partial<ConfigFormData> = {}): ConfigFormData =>
    ({ target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 }, machines: [machine()], inserters: [], belts: [], chests: [], ...fields });

/** Game names for the ids a test shows: `names({ 'iron-plate': 'Iron plate' }, { 'iron-gear-wheel': 'Iron gear wheel' })` */
export const names = (item: Record<string, string> = {}, recipe: Record<string, string> = {}): GameNames => ({ item, recipe });

interface PageContext {
    names?: GameNames;
    craftingMachines?: CraftingMachineData;
    /** What the page reads out; a mock to check */
    announce?: (text: string) => void;
}

/** What the page puts around everything it shows: the game's names, its crafting machines, its messages */
function PageContext({ names, craftingMachines, announce, children }: PageContext & { children: ReactNode }) {
    let page = children;
    if (names) page = <GameNamesContext.Provider value={names}>{page}</GameNamesContext.Provider>;
    if (craftingMachines) page = <CraftingMachinesContext value={craftingMachines}>{page}</CraftingMachinesContext>;
    if (announce) page = <MessageActionsContext.Provider value={{ notify: () => 0, dismiss: () => {}, announceMessage: () => {}, announce }}>{page}</MessageActionsContext.Provider>;
    return page;
}

/** Renders `ui` as the page would, and gives a user to drive it: `const { user } = show(<Form … />, { names })` */
export function show(ui: ReactElement, { names, craftingMachines, announce = vi.fn(), ...options }: PageContext & Omit<RenderOptions, 'wrapper'> = {}) {
    const user = userEvent.setup();
    const view = render(ui, { ...options, wrapper: ({ children }) => <PageContext names={names} craftingMachines={craftingMachines} announce={announce}>{children}</PageContext> });
    return { ...view, user, announce };
}
