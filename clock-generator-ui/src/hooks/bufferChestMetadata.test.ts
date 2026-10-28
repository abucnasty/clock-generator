import { describe, expect, it } from 'vitest';
import { BufferChestConfigSchema } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { readConfigFile, readSavedConfig, serializeConfig } from './usePersistedConfigForm';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';

const targetOutput = { recipe: 'electromagnetic-science-pack', items_per_second: 240, copies: 5 };
/** The native metadata of a steel chest, besides its id and position */
const steelChest = { storage_size: 48, item_filter: 'electromagnetic-science-pack', prototype: 'steel-chest' };
const typedChest = { type: ChestType.BUFFER_CHEST, id: 3, ...steelChest, position: { x: -598.5, y: 0 } };

/** A chest as it is saved, and the buffer chest config it is read as */
const chestCases = [
    { name: 'a modern typed buffer chest', chest: typedChest, expected: typedChest },
    { name: 'a legacy buffer chest without a type', chest: { id: 4, ...steelChest, position: { x: 0, y: -4.5 } },
        expected: { type: ChestType.BUFFER_CHEST, id: 4, ...steelChest, position: { x: 0, y: -4.5 } } },
    // the default type, storage and filter, and no prototype or position
    { name: 'a legacy buffer chest with only an id', chest: { id: 7 }, expected: { type: ChestType.BUFFER_CHEST, id: 7, storage_size: 1, item_filter: '' } },
];

function serializedConfig(chest: object): string {
    return JSON.stringify({ ...formDataToConfig(createDefaultConfig()), target_output: targetOutput, chests: [chest] });
}

/** The one chest of the list, after checking it is the only one */
function onlyChest<T>(chests: T[] | undefined): T {
    expect(chests).toHaveLength(1);
    return chests![0]!;
}

it('takes a typed buffer chest as a valid buffer chest config as it is', () => {
    expect(BufferChestConfigSchema.parse(typedChest)).toEqual(typedChest);
});

describe.each(chestCases)('$name is read as its buffer chest config', ({ chest, expected }) => {
    it('through saved-form round trips, with a UI-only UUID', () => {
        const inForm = { ...expected, _uuid: expect.any(String) };
        const first = readSavedConfig(serializedConfig(chest))!;
        expect(onlyChest(first.chests)).toStrictEqual(inForm);
        expect(BufferChestConfigSchema.parse(onlyChest(formDataToConfig(first).chests))).toEqual(expected);

        const saved = serializeConfig(first);
        expect(JSON.parse(saved).chests[0]).not.toHaveProperty('_uuid');
        const reopened = readSavedConfig(saved)!;
        expect(onlyChest(reopened.chests)).toStrictEqual(inForm);

        const exported = onlyChest(formDataToConfig(reopened).chests);
        expect(exported).not.toHaveProperty('_uuid');
        expect(BufferChestConfigSchema.parse(exported)).toEqual(expected);
    });

    it('from an imported config file', () => {
        const imported = readConfigFile(serializedConfig(chest)) as { chests: unknown[] };
        expect(BufferChestConfigSchema.parse(imported.chests[0])).toEqual(expected);
    });
});
