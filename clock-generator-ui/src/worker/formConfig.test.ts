import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { COPIES_DECIMAL_ERROR } from 'clock-generator/light';
import { copiesProblem } from '../utils/copiesProblem';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { ConfigSchema } from 'clock-generator/browser';
import { readConfigFile } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import * as edits from '../utils/configForm/edits';
import { createDefaultConfig } from '../utils/configForm/formData';
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
    return edits.updateTargetOutput(form, 'items_per_second', 0);
}

/** The file Export writes, read back the way Import reads it */
function exportAndImport(form: ReturnType<typeof createDefaultConfig>) {
    const file = JSON.stringify(formDataToConfig(form), null, 2);
    return parseFormConfig(ConfigSchema, readConfigFile(file));
}

describe('parseFormConfig', () => {
    it('imports the former belt setting and exports only backed_up_belts', () => {
        const file = { ...formDataToConfig(createDefaultConfig()), overrides: { non_moving_belts: true } };
        const imported = parseFormConfig(ConfigSchema, readConfigFile(JSON.stringify(file)));
        expect(imported.success).toBe(true);
        const exported = formDataToConfig(configToFormData(imported.data!));
        expect(exported.overrides).toEqual({ backed_up_belts: true });
        expect(JSON.stringify(exported)).not.toContain('non_moving_belts');
    });

    it('preserves imported geometry, fuel and explicit overrides, refuses unsupported geometry edits, and keeps mixed-drop drafts recoverable', () => {
        let form = edits.updateTargetOutput(createDefaultConfig(), 'recipe', 'rocket-fuel');
        form.machines[0] = { ...form.machines[0], recipe: 'rocket-fuel-from-jelly', prototype: 'biochamber', fuel: 'nutrients' };
        form = edits.addBelt(form);
        form = edits.addBelt(form);
        form = edits.addInserter(form);
        form = edits.addInserter(form);
        form.inserters[0].sink = { type: 'belt', id: 1, drop: { lane: 1, position: 0.125 } };
        form.inserters[1].sink = { type: 'belt', id: 1, drop: { lane: 2, position: 0.5 } };
        form.overrides = { check_start_dependence: false, loop_seed_items: 0, lcm: 3 };
        const original = formDataToConfig(form);
        const imported = exportAndImport(form);
        expect(imported.success).toBe(true);
        form = configToFormData(imported.data!);
        const unchanged = edits.updateInserter(form, 0, { sink: { type: 'belt', id: 1 } });
        expect(formDataToConfig(unchanged)).toEqual(original);
        expect(formDataToConfig(edits.updateInserter(form, 0, { sink: { type: 'belt', id: 2 } }))).toEqual(original);
        expect(edits.duplicateEntity(form, 'inserters', 0)).toBe(form);
        expect(edits.updateBelt(form, 0, { type: 'fast-transport-belt' })).toBe(form);
        const edited = edits.updateTargetOutput(edits.updateInserter(form, 0, { stack_size: 12 }), 'items_per_second', 2);
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
        expect(imported.target_output.items_per_second).toBe(0);
        expect(imported.machines.map((m) => m.id)).toEqual([1]);
    });

    it('gives the checked config when nothing is wrong with it', () => {
        const form = edits.updateTargetOutput(createDefaultConfig(), 'recipe', 'iron-gear-wheel');
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
});


describe('fractional Copies and metadata draft round trips', () => {
    it.each([0.0625, 0.0001, 1 / 3])('retains %s without resetting the editable build', copies => {
        const form = edits.updateTargetOutput(createDefaultConfig(), 'copies', copies);
        form.inserters = [{ id: 1, _uuid: 'bulk', prototype: 'bulk-inserter', quality: 'normal', source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 } }];
        const saved = readSavedConfig(serializeConfig(form))!;
        expect(saved.target_output.copies).toBe(copies);
        const parsed = parseFormConfig(ConfigSchema, formDataToConfig(saved));
        expect(parsed.success).toBe(true);
        const reopened = configToFormData(parsed.data!);
        expect(reopened.target_output.copies).toBe(copies);
        if (copies === 0.0625) {
            expect(reopened.inserters[0]).toMatchObject({ prototype: 'bulk-inserter', quality: 'normal' });
            expect(reopened.inserters[0].stack_size).toBeUndefined();
        }
        const file = exportAndImport(reopened);
        expect(file.success).toBe(true);
        expect(file.data!.target_output.copies).toBe(copies);
        expect(ConfigSchema.safeParse(file.data).success).toBe(copiesProblem(copies) === null);
    });

    it('does not allow other custom errors at the Copies path or the Copies message at another path', () => {
        const config = formDataToConfig(createDefaultConfig());
        for (const [path, message] of [
            [['target_output', 'copies'], 'A different custom constraint'],
            [['machines'], COPIES_DECIMAL_ERROR],
        ] as const) {
            const schema = ConfigSchema.superRefine((_value, ctx) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message }));
            expect(parseFormConfig(schema, config).success).toBe(false);
        }
    });
});


describe('editable Copies never bypasses structural validation', () => {
    it.each([1, 0.0001, 1 / 3])('rejects malformed entities alongside Copies %s', copies => {
        const config = formDataToConfig(edits.updateTargetOutput(createDefaultConfig(), 'copies', copies));
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
