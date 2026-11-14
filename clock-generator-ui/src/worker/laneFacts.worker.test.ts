import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import automationSample from '../../../clock-generator/resources/config-samples/science/automation/automation-240.json?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { EngineQuery, WorkerRequest, WorkerResponse } from './types';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import { laneFieldUpdate, type ConfigFormData } from '../utils/configForm/formData';

let posted: WorkerResponse[];
let send: (data: WorkerRequest) => Promise<WorkerResponse>;

beforeEach(async () => {
    vi.resetModules();
    posted = [];
    const port = { postMessage: (response: WorkerResponse) => posted.push(response), onmessage: null as ((event: { data: WorkerRequest }) => Promise<void>) | null };
    vi.stubGlobal('self', port);
    await import('./simulation.worker');
    send = async data => { await port.onmessage!({ data }); return posted.at(-1)!; };
    expect(await send({ type: 'initialize', factorioData })).toEqual({ type: 'initialized' });
});
afterEach(() => { vi.unstubAllGlobals(); });

const query = (q: EngineQuery) => send({ type: 'query', requestId: 7, query: q });
/** Check, as the page asks it of the worker */
const check = (config: Config) => send({ type: 'validate', requestId: 8, config });
const automationForm = () => configToFormData(JSON.parse(automationSample) as Config);
/** The form with lane `lane` of belt 1 edited by the form's own update */
const withLane = (form: ConfigFormData, lane: 0 | 1, edit: (it: ConfigFormData['belts'][number]['lanes'][number]) => ConfigFormData['belts'][number]['lanes'][number]): ConfigFormData => {
    const lanes = [...form.belts[0].lanes] as ConfigFormData['belts'][number]['lanes'];
    lanes[lane] = edit(lanes[lane]!);
    return { ...form, belts: [{ ...form.belts[0], lanes }, ...form.belts.slice(1)] };
};

describe('the lane roles query', () => {
    it('gives each lane the engine\'s role', async () => {
        expect(await query({ kind: 'lane-roles', config: formDataToConfig(automationForm()) })).toMatchObject({ type: 'answer', answer: [
            { belt_id: 1, lane: 1, role: 'input' }, { belt_id: 1, lane: 2, role: 'input' }, { belt_id: 2, lane: 1, role: 'output' }] });
    });

    it('fails, so that the page shows no role, where a machine has no recipe yet', async () => {
        const form = automationForm();
        form.machines.push({ ...form.machines[0], id: 9, _uuid: 'm9', recipe: '' });
        expect(await query({ kind: 'lane-roles', config: formDataToConfig(form) })).toMatchObject({ type: 'query-failed' });
    });
});

describe('the engine\'s refusals reach the user at Check', () => {
    // the engine names the lane by its number and its belt's (errors.ts describeLanes); its texts are not this page's to change
    it('refuses a supply rate under what the copies take from a shared lane, with the engine\'s message', async () => {
        const config = formDataToConfig(withLane(automationForm(), 0, lane => laneFieldUpdate(lane, 'supply_rate', 5)));
        const response = await check(config);
        expect(response.type).toBe('validation-failed');
        const message = (response as { message: string }).message;
        expect(message).toBe('The 9 copies share lane 1 of belt 1. Together they take 9 × 13.33 = 120 a second from it. Its supply rate is 5 a second. '
            + 'Set the lane to per copy if the copies do not share it. If they share it, use a smaller number of copies.');
    });

    it('refuses a flow direction across the copy spacing on a shared lane, with the engine\'s message', async () => {
        const form = automationForm();
        const config = formDataToConfig({ ...form, belts: [{ ...form.belts[0], flow_direction: 0 }, ...form.belts.slice(1)] });
        const response = await check(config);
        expect(response.type).toBe('validation-failed');
        const message = (response as { message: string }).message;
        expect(message).toMatch(/^Belt 1 states flow_direction 0 \(north\), and the copies share both lanes of belt 1\. That is across the copy spacing/);
    });
});
