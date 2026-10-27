import { describe, expect, it } from 'vitest';
import { BufferChestConfigSchema } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { readConfigFile, readSavedConfig, serializeConfig } from './usePersistedConfigForm';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';

const targetOutput = { recipe: 'electromagnetic-science-pack', items_per_second: 240, copies: 5 };

const metadataCases = [
    {
        name: 'a modern typed buffer chest',
        chest: {
            type: ChestType.BUFFER_CHEST,
            id: 3,
            storage_size: 48,
            item_filter: 'electromagnetic-science-pack',
            prototype: 'steel-chest',
            position: { x: -598.5, y: 0 },
        },
    },
    {
        name: 'a legacy buffer chest without a type',
        chest: {
            id: 4,
            storage_size: 48,
            item_filter: 'electromagnetic-science-pack',
            prototype: 'steel-chest',
            position: { x: 0, y: -4.5 },
        },
    },
] as const;

function serializedConfig(chest: object): string {
    return JSON.stringify({ ...formDataToConfig(createDefaultConfig()), target_output: targetOutput, chests: [chest] });
}

describe.each(metadataCases)('$name preserves native metadata', ({ chest }) => {
    it('keeps prototype, position, storage and filter through saved-form round trips', () => {
        const expected = {
            type: ChestType.BUFFER_CHEST,
            id: chest.id,
            storage_size: 48,
            item_filter: 'electromagnetic-science-pack',
            prototype: 'steel-chest',
            position: chest.position,
        };

        if ('type' in chest) {
            expect(BufferChestConfigSchema.parse(chest)).toMatchObject(expected);
        }

        const first = readSavedConfig(serializedConfig(chest))!;
        expect(first.chests).toHaveLength(1);
        const firstChest = first.chests[0]!;
        expect(firstChest).toMatchObject(expected);
        expect(firstChest._uuid).toEqual(expect.any(String));
        const firstExport = formDataToConfig(first).chests!;
        expect(firstExport).toHaveLength(1);
        expect(BufferChestConfigSchema.parse(firstExport[0]!)).toMatchObject(expected);

        const saved = serializeConfig(first);
        expect(JSON.parse(saved).chests[0]).not.toHaveProperty('_uuid');
        const reopened = readSavedConfig(saved)!;
        expect(reopened.chests).toHaveLength(1);
        const reopenedChest = reopened.chests[0]!;
        expect(reopenedChest).toMatchObject(expected);
        expect(reopenedChest._uuid).toEqual(expect.any(String));

        const exportedChests = formDataToConfig(reopened).chests!;
        expect(exportedChests).toHaveLength(1);
        const exported = exportedChests[0]!;
        expect(exported).not.toHaveProperty('_uuid');
        expect(BufferChestConfigSchema.parse(exported)).toMatchObject(expected);
    });

    it('applies the same metadata migration to imported config files', () => {
        const imported = readConfigFile(serializedConfig(chest)) as { chests: unknown[] };
        const parsed = BufferChestConfigSchema.parse(imported.chests[0]);
        expect(parsed).toMatchObject({
            type: ChestType.BUFFER_CHEST,
            id: chest.id,
            storage_size: 48,
            item_filter: 'electromagnetic-science-pack',
            prototype: 'steel-chest',
            position: chest.position,
        });
    });
});

describe('legacy buffer chests without optional metadata', () => {
    const legacyChest = { id: 7 };

    it('keeps the existing type, storage and filter defaults and UI-only UUID behavior', () => {
        const form = readSavedConfig(serializedConfig(legacyChest))!;
        expect(form.chests).toHaveLength(1);
        const formChest = form.chests[0]!;
        expect(formChest).toMatchObject({
            type: ChestType.BUFFER_CHEST,
            id: 7,
            storage_size: 1,
            item_filter: '',
        });
        expect(formChest).not.toHaveProperty('prototype');
        expect(formChest).not.toHaveProperty('position');
        expect(formChest._uuid).toEqual(expect.any(String));

        const saved = serializeConfig(form);
        expect(JSON.parse(saved).chests[0]).not.toHaveProperty('_uuid');
        const reopened = readSavedConfig(saved)!;
        expect(reopened.chests).toHaveLength(1);
        expect(reopened.chests[0]!._uuid).toEqual(expect.any(String));
        const exported = formDataToConfig(reopened).chests!;
        expect(exported).toHaveLength(1);
        expect(exported[0]!).not.toHaveProperty('_uuid');
    });

    it('keeps the existing defaults on the readConfigFile path', () => {
        const imported = readConfigFile(serializedConfig(legacyChest)) as { chests: unknown[] };
        expect(BufferChestConfigSchema.parse(imported.chests[0])).toEqual({
            type: ChestType.BUFFER_CHEST,
            id: 7,
            storage_size: 1,
            item_filter: '',
        });
    });
});
