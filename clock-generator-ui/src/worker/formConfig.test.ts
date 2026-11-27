import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { COPIES_DECIMAL_ERROR } from 'clock-generator/light';
import { copiesProblem } from '../utils/copiesProblem';
import { readConfigFile, readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { ConfigSchema, FactorioDataService } from 'clock-generator/browser';
import { inserter } from '../test/fixtures';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import * as edits from '../utils/configForm/edits';
import { createDefaultConfig, type ConfigFormData } from '../utils/configForm/formData';
import { parseFormConfig } from './formConfig';

/** A form whose inserter took from a machine that was then removed, set to make 0 items per second */
function formWithUnsetEnd() {
    let form = createDefaultConfig();
    form = edits.updateMachine(form, 0, 'recipe', 'iron-gear-wheel');
    form = edits.addMachine(form);
    form = edits.updateMachine(form, 1, 'recipe', 'iron-gear-wheel');
    form = edits.addBelt(form);
    form = edits.addInserter(form);
    form = edits.updateInserter(form, 0, { source: { type: 'machine', id: 2 } });
    form = edits.removeMachine(form, 1);
    return edits.updateSetpoint(form, 'items_per_second', 0);
}

/** The file Export writes, read back the way Import reads it */
const exportAndImport = (form: ConfigFormData) => parseFormConfig(ConfigSchema, readConfigFile(JSON.stringify(formDataToConfig(form), null, 2)));

describe('parseFormConfig', () => {
    it('preserves imported geometry, fuel and explicit overrides, refuses unsupported geometry edits, and keeps mixed-drop drafts recoverable', () => {
        let form = edits.updateSetpoint(createDefaultConfig(), 'item', 'rocket-fuel');
        form.machines[0] = { ...form.machines[0], recipe: 'rocket-fuel-from-jelly', prototype: 'biochamber', fuel: 'nutrients' };
        form = edits.addBelt(form);
        form = edits.addBelt(form);
        form = edits.addInserter(form);
        form = edits.addInserter(form);
        form.inserters[0].sink = { type: 'belt', id: 1, drop: { lane: 1, position: 0.125 } };
        form.inserters[1].sink = { type: 'belt', id: 1, drop: { lane: 2, position: 0.5 } };
        form.overrides = { check_start_dependence: false, kick_start_items: 0, lcm: 3 };
        const original = formDataToConfig(form);
        const imported = exportAndImport(form);
        expect(imported.success).toBe(true);
        form = configToFormData(imported.data!);
        expect(formDataToConfig(edits.updateInserter(form, 0, { sink: { type: 'belt', id: 1 } }))).toEqual(original);
        expect(formDataToConfig(edits.updateInserter(form, 0, { sink: { type: 'belt', id: 2 } }))).toEqual(original);
        expect(edits.duplicateEntity(form, 'inserters', 0)).toBe(form);
        expect(edits.updateBelt(form, 0, { type: 'fast-transport-belt' })).toBe(form);
        const edited = edits.updateSetpoint(edits.updateInserter(form, 0, { stack_size: 12 }), 'items_per_second', 2);
        const reopened = configToFormData(exportAndImport(edited).data!);
        expect(reopened.inserters.map(ins => ins.sink)).toEqual(form.inserters.map(ins => ins.sink));
        expect(reopened.machines[0].fuel).toBe('nutrients');
        expect(reopened.overrides).toEqual(original.overrides);
        expect(readSavedConfig(serializeConfig(reopened))!.inserters.map(ins => ins.sink)).toEqual(form.inserters.map(ins => ins.sink));
        // An accepted paste/new route can create an incomplete geometry set. It must remain a draft on reload,
        // with the strict generator schema still rejecting it and a normal destination correction available.
        const mixed = edits.addInserter(reopened);
        const strict = ConfigSchema.safeParse(formDataToConfig(mixed));
        expect(strict.success).toBe(false);
        expect(strict.error!.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['inserters', 2, 'sink', 'drop'] })]));
        const draft = exportAndImport(mixed);
        expect(draft.success).toBe(true);
        expect(readSavedConfig(serializeConfig(configToFormData(draft.data!)))).not.toBeNull();
        const corrected = edits.updateInserter(mixed, 2, { sink: { type: 'belt', id: 2 } });
        expect(ConfigSchema.safeParse(formDataToConfig(corrected)).success).toBe(true);
        expect(corrected.inserters.slice(0, 2).map(ins => ins.sink)).toEqual(form.inserters.map(ins => ins.sink));
    });

    it('imports an exported form with an unset inserter end and 0 items per second', () => {
        const form = formWithUnsetEnd();
        expect(form.inserters[0].source).toEqual({ type: 'machine', id: 0 });
        // the generator's own check rejects it
        expect(ConfigSchema.safeParse(readConfigFile(JSON.stringify(formDataToConfig(form)))).success).toBe(false);

        const result = exportAndImport(form);
        expect(result.success).toBe(true);
        const imported = configToFormData(result.data!);
        expect(imported.inserters[0].source).toEqual({ type: 'machine', id: 0 });
        expect(imported.inserters[0].sink).toEqual({ type: 'belt', id: 1 });
        expect(imported.setpoint.items_per_second).toBe(0);
        expect(imported.machines.map((m) => m.id)).toEqual([1]);
    });

    it('gives the checked config when nothing is wrong with it', () => {
        const form = edits.updateSetpoint(createDefaultConfig(), 'item', 'iron-gear-wheel');
        const result = exportAndImport(form);
        expect(result.success).toBe(true);
        expect(result.data).toEqual(ConfigSchema.parse(formDataToConfig(form)));
    });

    it('rejects a broken structure', () => {
        const config = { ...formDataToConfig(formWithUnsetEnd()), inserters: [{ source: 'machine 1' }] };
        const result = parseFormConfig(ConfigSchema, config);
        expect(result.success).toBe(false);
        expect(result.error!.issues.some((issue) => issue.code === 'invalid_type')).toBe(true);
    });

    it('rejects a file that is not a config', () => {
        expect(parseFormConfig(ConfigSchema, readConfigFile('[1, 2]')).success).toBe(false);
        expect(() => readConfigFile('{ not json')).toThrow();
    });

    it.each([1, 0.0001, 1 / 3])('never lets editable Copies %s bypass structural validation: rejects malformed entities alongside it', copies => {
        const config = formDataToConfig(edits.updateSetpoint(createDefaultConfig(), 'copies', copies));
        const withoutMachines: Record<string, unknown> = { ...config };
        delete withoutMachines.machines;
        expect(parseFormConfig(ConfigSchema, withoutMachines).success).toBe(false);
        for (const malformed of [
            { machines: 'broken' },
            { machines: [{ ...config.machines[0], id: 1.5 }] },
            { inserters: [{ source: 'machine 1', sink: { type: 'belt', id: 1 } }] },
            { inserters: [{ source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 }, quality: 'mythical' }] },
        ]) expect(parseFormConfig(ConfigSchema, { ...config, ...malformed }).success).toBe(false);
    });
});

describe('fractional Copies and metadata draft round trips', () => {
    it.each([0.0625, 0.0001, 1 / 3])('retains %s without resetting the editable build', copies => {
        const form = edits.updateSetpoint(createDefaultConfig(), 'copies', copies);
        form.inserters = [inserter(1, { prototype: 'bulk-inserter', quality: 'normal', sink: { type: 'belt', id: 1 } })];
        const saved = readSavedConfig(serializeConfig(form))!;
        expect(saved.setpoint.copies).toBe(copies);
        const parsed = parseFormConfig(ConfigSchema, formDataToConfig(saved));
        expect(parsed.success).toBe(true);
        const reopened = configToFormData(parsed.data!);
        expect(reopened.setpoint.copies).toBe(copies);
        if (copies === 0.0625) {
            expect(reopened.inserters[0]).toMatchObject({ prototype: 'bulk-inserter', quality: 'normal' });
            expect(reopened.inserters[0].stack_size).toBeUndefined();
        }
        const file = exportAndImport(reopened);
        expect(file.success).toBe(true);
        expect(file.data!.setpoint.copies).toBe(copies);
        expect(ConfigSchema.safeParse(file.data).success).toBe(copiesProblem(copies) === null);
    });

    it.each([
        ['other custom errors at the Copies path', ['setpoint', 'copies'], 'A different custom constraint'],
        ['the Copies message at another path', ['machines'], COPIES_DECIMAL_ERROR],
    ])('does not allow %s', (_, path, message) => {
        const schema = ConfigSchema.superRefine((_value, ctx) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message }));
        expect(parseFormConfig(schema, formDataToConfig(createDefaultConfig())).success).toBe(false);
    });
});

describe('parseFormConfig, for a setpoint the engine does not count yet', () => {
    // the refusal reads the game data, which the worker loads
    beforeAll(() => { FactorioDataService.initialize(JSON.parse(factorioData)); });
    const jellyForm = (item: string) => ({ ...formDataToConfig(createDefaultConfig()), setpoint: { item, items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: 'jellynut-processing', productivity: 0, crafting_speed: 1 }] });

    it('accepts the refusal of the setpoint\'s item, which the form shows and Check refuses, and keeps what it holds', () => {
        for (const item of ['jellynut-seed', 'sulfuric-acid']) {
            const form = jellyForm(item);
            const strict = ConfigSchema.safeParse(form);
            expect(strict.success).toBe(false);
            const parsed = parseFormConfig(ConfigSchema, form);
            expect(parsed.success).toBe(true);
            expect(parsed.data).toBe(form);
        }
    });

    it('still refuses a structure that is broken next to it', () => {
        const form = { ...jellyForm('jellynut-seed'), machines: 'none' };
        expect(parseFormConfig(ConfigSchema, form).success).toBe(false);
    });
});

it('keeps a valid pair through an editable precision failure and rejects a malformed pair beside it', () => {
    const config = formDataToConfig(createDefaultConfig());
    const rate = { denominator: 100_000_000_000_000, numerator: 1 };
    const build = { ...config, setpoint: { ...config.setpoint, copies: 2, items_per_second: rate } };
    expect(ConfigSchema.safeParse(build).success).toBe(false);
    const draft = parseFormConfig(ConfigSchema, readConfigFile(JSON.stringify(build)));
    expect(JSON.stringify(draft.data?.setpoint.items_per_second)).toBe('{"numerator":1,"denominator":100000000000000}');
    expect(draft.data?.setpoint.copies).toBe(2);
    expect(ConfigSchema.safeParse({ ...build, setpoint: { ...build.setpoint, copies: 1 } }).success).toBe(true);
    expect(parseFormConfig(ConfigSchema, { ...build, setpoint: { ...build.setpoint, copies: 0,
        items_per_second: { numerator: 2, denominator: 4 } } }).success).toBe(false);
});
