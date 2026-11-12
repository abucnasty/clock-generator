import { describe, expect, it } from 'vitest';
import { BeltConfigSchema, ConfigSchema, migrateMachineTypes, type Config } from 'clock-generator/browser';
import { Option } from 'clock-generator/light';
import { ConfigPaths } from '../../../../clock-generator/dist/config/config-paths.js';
import { readConfigFile, readSavedConfig, serializeConfig } from '../../hooks/usePersistedConfigForm';
import { parseFormConfig } from '../../worker/formConfig';
import type { PastedEntities } from '../../worker/types';
import { applyPaste } from '../pastePreview';
import { decodeShareLink, encodeShareLink, readShareHash } from '../shareLink';
import { configToFormData, formDataToConfig } from './configMapping';
import { laneFieldUpdate, type ConfigFormData } from './formData';

const SAMPLE_FILES = import.meta.glob('../../../../clock-generator/resources/config-samples/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
/** The text of a sample, by the path the catalog gives it */
function sampleText(file: string): string {
    const key = Object.keys(SAMPLE_FILES).find(it => file.endsWith(it.replace(/^(\.\.\/)+clock-generator/, '')));
    if (key === undefined) throw new Error(`no sample ${file}`);
    return SAMPLE_FILES[key];
}

/** A configuration file as the page reads it: the former names, then the worker's 'config-file' */
function configFile(text: string): Config {
    const result = parseFormConfig(ConfigSchema, migrateMachineTypes(readConfigFile(text)));
    if (!result.success) throw new Error(result.error.message);
    return result.data as Config;
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
/** Every path at which two JSON values differ */
function differences(a: unknown, b: unknown, path = ''): string[] {
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
        const keys = Array.isArray(a) ? [...Array(Math.max(a.length, (b as unknown[]).length)).keys()].map(String)
            : [...new Set([...Object.keys(a), ...Object.keys(b as object)])];
        return keys.flatMap(key => differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`));
    }
    return [path];
}
/**
 * What the form writes that a sample's file does not state, before the lane fields were added: an inserter's number and
 * its pickup length, an empty list of chests, and a chest's filter it fills in
 */
const WRITTEN_BEFORE = [/^\/inserters\/\d+\/id$/, /^\/inserters\/\d+\/source\/pickup_length$/, /^\/chests$/, /^\/chests\/\d+\/item_filter$/];

async function throughShareLink(config: Config): Promise<Config> {
    const link = await encodeShareLink({ name: 'build', config }, 'https://example.invalid/');
    const hash = readShareHash(new URL(link).hash);
    if (hash.kind !== 'link') throw new Error('no link');
    const decoded = await decodeShareLink(hash);
    if (decoded.kind !== 'build') throw new Error(decoded.problem);
    return configFile(JSON.stringify(decoded.config));
}
const throughSave = (form: ConfigFormData) => formDataToConfig(migrateMachineTypes(readSavedConfig(serializeConfig(form))) as ConfigFormData);

describe('nothing is written that the user did not state', () => {
    const samples = Object.entries(ConfigPaths) as [string, string][];

    it('has the 33 samples, the 9 examples among them', () => {
        expect(samples).toHaveLength(33);
    });

    it.each(samples)('%s: through the form, a share link and a saved build, only what the form wrote before, and nothing under belts', async (_name, file) => {
        const text = sampleText(file);
        const stated = plain(JSON.parse(text));
        const form = configToFormData(configFile(text), 'sample');
        for (const after of [formDataToConfig(form), await throughShareLink(formDataToConfig(form)), throughSave(form)]) {
            const found = differences(stated, plain(after));
            expect(found.filter(path => !WRITTEN_BEFORE.some(pattern => pattern.test(path)))).toEqual([]);
            expect(plain(after.belts)).toEqual((stated as Config).belts);
        }
    });
});

describe('each lane fact round-trips', () => {
    const automation = sampleText(ConfigPaths.AUTOMATION_SCIENCE_240);
    /** The example with every lane fact of the form set on belt 1 by the form's own edit */
    function edited(lane_end: { kind: 'dead_end' | 'infinite' | 'unknown' } | undefined): ConfigFormData {
        const form = configToFormData(configFile(automation));
        const belt = form.belts[0];
        let lane = laneFieldUpdate(belt.lanes[0], 'lane_end', lane_end);
        lane = laneFieldUpdate(lane, 'supply_rate', 45);
        lane = laneFieldUpdate(lane, 'sharing', 'per_copy');
        form.belts[0] = { ...belt, flow_direction: 12, lanes: [lane, belt.lanes[1]!] };
        return form;
    }

    it.each([{ kind: 'dead_end' as const }, { kind: 'infinite' as const }, { kind: 'unknown' as const }, undefined])('lane end %o, a supply rate, a sharing and a flow direction, through a file, a saved build, a share link and a paste', async lane_end => {
        const form = edited(lane_end);
        const config = formDataToConfig(form);
        const lane = { ingredient: 'iron-gear-wheel', stack_size: 4, ...(lane_end && { lane_end }), supply_rate: 45, sharing: 'per_copy' };
        expect(plain(config.belts[0])).toEqual({ id: 1, type: 'turbo-transport-belt', flow_direction: 12, lanes: [lane, plain(config.belts[0].lanes[1])] });
        const file = formDataToConfig(configToFormData(configFile(JSON.stringify(config))));
        const pasted = formDataToConfig(applyPaste(configToFormData(configFile(automation)), { machines: [], drills: [], inserters: [], chests: [],
            belts: config.belts.map(belt => BeltConfigSchema.parse(plain(belt))), guidance: Option.none, suggested_target: Option.none } satisfies PastedEntities,
            { machines: false, drills: false, inserters: false, belts: true, chests: false, target: false }));
        for (const after of [file, throughSave(form), await throughShareLink(config), pasted]) {
            expect(plain(after.belts)).toEqual(plain(config.belts));
        }
    });

    it('takes a stated fact away again, leaving no key', () => {
        const form = edited({ kind: 'infinite' });
        const lane = ['lane_end', 'supply_rate', 'sharing'].reduce((it, field) => laneFieldUpdate(it, field as 'lane_end', undefined), form.belts[0].lanes[0]);
        expect(Object.keys(lane)).toEqual(['ingredient', 'stack_size']);
    });

    it('drops a lane end where a consumption rate is set, and a consumption rate where a lane end is set, as the config takes only one', () => {
        const lane = { ingredient: 'iron-plate', stack_size: 4 };
        expect(laneFieldUpdate({ ...lane, lane_end: { kind: 'dead_end' } }, 'consumption_per_second', 5)).toEqual({ ...lane, consumption_per_second: 5 });
        expect(laneFieldUpdate({ ...lane, consumption_per_second: 5 }, 'lane_end', { kind: 'dead_end' })).toEqual({ ...lane, lane_end: { kind: 'dead_end' } });
    });
});
