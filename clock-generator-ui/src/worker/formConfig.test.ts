import { describe, expect, it } from 'vitest';
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
