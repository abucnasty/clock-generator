// @vitest-environment happy-dom
import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import ironScaffold from '../../../clock-generator/resources/config-samples/smelting/iron-plate/iron-plate-80-car-chest.scaffold?raw';
import { applyResearch, BeltConfigSchema, ChestConfigSchema, importBlueprint, InserterConfigSchema, MachineConfigurationSchema, MiningDrillConfigSchema, researchDifferences, type Config, type FactorioData } from 'clock-generator/browser';
import { Option } from 'clock-generator/light';
import { show } from '../test/fixtures';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig, type ConfigFormData } from '../utils/configForm/formData';
import { applyPaste } from '../utils/pastePreview';
import { openProfileStore, PROFILES_KEY } from '../utils/researchProfiles';
import { decodeShareLink, encodeShareLink, readShareHash } from '../utils/shareLink';
import type { EngineQuery } from '../worker/types';
import { RESEARCH_LINE } from '../utils/researchLine';
import { BuildResearchLine } from './BuildResearchLine';

const data = JSON.parse(factorioData) as FactorioData;
// the worker, which alone holds the data
vi.mock('../worker/engineClient', () => ({
    askEngine: async (query: EngineQuery) => query.kind === 'apply-research' ? applyResearch(query.build, query.base, query.choice, data)
        : query.kind === 'research-differences' ? researchDifferences(query.build, data) : null,
}));

const none = { mining_drill_productivity_bonus: 0, inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0, belt_stack_size_bonus: 0, recipes: {} };

/** The iron build pasted as a blueprint with No research, as the paste writes it into a new build */
function pastedIron(): ConfigFormData {
    const outcome = importBlueprint(ironScaffold.trim(), { research: { profile: 'No research', template: 'no-research', bonuses: none }, answers: { 'drill-ore:1': 'iron-ore' } }, data);
    if (outcome.kind !== 'build') throw new Error('no build');
    // with the defaults of the schema, as the worker gives them
    const incoming = { ...outcome, guidance: Option.none, suggested_target: Option.none,
        machines: outcome.machines.map(row => MachineConfigurationSchema.parse(row)), drills: outcome.drills.map(row => MiningDrillConfigSchema.parse(row)),
        inserters: outcome.inserters.map(row => InserterConfigSchema.parse(row)), belts: outcome.belts.map(row => BeltConfigSchema.parse(row)),
        chests: outcome.chests.map(row => ChestConfigSchema.parse(row)) };
    const all = { target: false, machines: true, drills: true, inserters: true, belts: true, chests: true };
    return applyPaste(createDefaultConfig(), incoming, all, undefined, { research: outcome.research, copy_offset: outcome.copy_offset });
}

/** A storage that keeps what is written to it, for a profile store in a test */
function memory() {
    const items = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { items.set(key, value); });
    return { setItem, storage: { getItem: (key: string) => items.get(key) ?? null, setItem, removeItem: (key: string) => { items.delete(key); },
        key: (i: number) => [...items.keys()][i] ?? null, get length() { return items.size; } } };
}

const line = () => screen.getByText((_, element) => element?.hasAttribute('data-research-line') ?? false);
const settled = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('the research line of an open build', () => {
    let onApply: ReturnType<typeof vi.fn<(next: ConfigFormData, message: string) => void>>;
    beforeEach(() => { onApply = vi.fn<(next: ConfigFormData, message: string) => void>(); });

    it('says the research numbers are not recorded for a build with no block, with no chooser', () => {
        show(<BuildResearchLine form={createDefaultConfig()} onApply={onApply} storage={memory().storage} />);
        expect(line().textContent).toBe(RESEARCH_LINE.notRecorded);
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('shows the block\'s profile and the numbers used, and nothing changed by hand', async () => {
        show(<BuildResearchLine form={pastedIron()} onApply={onApply} storage={memory().storage} />);
        await settled();
        expect(screen.getByRole('combobox', { name: RESEARCH_LINE.label }).textContent).toBe('No research');
        expect(line().textContent).toContain('numbers used: mining +0 %');
        expect(line().querySelector('[data-research-edited]')).toBeNull();
    });

    it('shows the values changed by hand and the rows not from the blueprint, worked out on load', async () => {
        const form = pastedIron();
        form.machines = [{ ...form.machines[0], productivity: 250 }, ...form.machines.slice(1), { ...form.machines[0], id: 99, _uuid: 'by-hand' }];
        show(<BuildResearchLine form={form} onApply={onApply} storage={memory().storage} />);
        await settled();
        expect(line().querySelector('[data-research-edited]')!.textContent).toBe(`1 value changed by hand: machine ${form.machines[0].id} productivity 250 %`);
        expect(line().querySelector('[data-research-outside]')!.textContent).toBe('Not from the blueprint: machine 99 (a profile does not change them)');
    });

    it('puts another profile on at once, as one step, where nothing was changed by hand', async () => {
        const form = pastedIron();
        const { user } = show(<BuildResearchLine form={form} onApply={onApply} storage={memory().storage} />);
        await settled();
        await user.click(screen.getByRole('combobox', { name: RESEARCH_LINE.label }));
        await user.click(await screen.findByRole('option', { name: /All finite research/ }));
        await settled();
        expect(onApply).toHaveBeenCalledOnce();
        const [next, message] = onApply.mock.calls[0];
        expect(message).toBe('Research profile set to "All finite research".');
        expect(next.research).toMatchObject({ profile: 'All finite research', template: 'all-finite-research', base: form.research!.base });
        expect(next.drills!.configs.map(drill => drill.productivity)).toEqual(form.drills!.configs.map(drill => drill.productivity + 20));
        expect(next.belts.flatMap(belt => belt.lanes.map(lane => lane.stack_size))).toEqual(form.belts.flatMap(belt => belt.lanes.map(() => 4)));
        // each row keeps what only the form holds
        expect(next.machines.map(machine => machine._uuid)).toEqual(form.machines.map(machine => machine._uuid));
        expect(next.machines.map(machine => machine._prototype_source)).toEqual(form.machines.map(machine => machine._prototype_source));
    });

    it.each([
        ['Cancel', null],
        ['Keep mine', 'kept'],
        ["Use the profile's", 'overwritten'],
    ] as const)('asks first where a value was changed by hand: %s', async (button, outcome) => {
        const form = pastedIron();
        const drill = form.drills!.configs[0];
        form.drills = { configs: [{ ...drill, productivity: drill.productivity + 5 }, ...form.drills!.configs.slice(1)] };
        const { user } = show(<BuildResearchLine form={form} onApply={onApply} storage={memory().storage} />);
        await settled();
        await user.click(screen.getByRole('combobox', { name: RESEARCH_LINE.label }));
        await user.click(await screen.findByRole('option', { name: /All finite research/ }));
        const dialog = await screen.findByRole('dialog', { name: RESEARCH_LINE.questionTitle });
        expect(dialog.textContent).toContain('1 value was changed by hand. The profile "All finite research" gives:');
        expect(dialog.textContent).toContain(`drill ${drill.id} productivity ${drill.productivity + 20} % (yours ${drill.productivity + 5} %)`);
        expect(onApply).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole('button', { name: button }));
        if (outcome === null) {
            expect(onApply).not.toHaveBeenCalled();
            return;
        }
        expect(onApply).toHaveBeenCalledOnce();
        const next = onApply.mock.calls[0][0];
        expect(next.research!.profile).toBe('All finite research');
        expect(next.drills!.configs[0].productivity).toBe(outcome === 'kept' ? drill.productivity + 5 : drill.productivity + 20);
        expect(next.belts[0].lanes[0].stack_size).toBe(4);
    });

    it('shows a profile that is not in the store by its name, with no choice, and writes nothing to the store', async () => {
        const form = pastedIron();
        form.research = { ...form.research!, profile: 'His megabase', template: null };
        const { storage, setItem } = memory();
        show(<BuildResearchLine form={form} onApply={onApply} storage={storage} />);
        await settled();
        expect(line().textContent).toContain('"His megabase" is not one of your profiles.');
        expect(screen.getByRole('combobox', { name: RESEARCH_LINE.label }).textContent).not.toMatch(/No research|All finite research|His megabase/);
        expect(setItem).not.toHaveBeenCalled();
        expect(storage.getItem(PROFILES_KEY)).toBeNull();
    });

    it('shows a profile made in the profiles dialog since it opened', async () => {
        const form = pastedIron();
        form.research = { ...form.research!, profile: 'Megabase' };
        const { storage } = memory();
        const view = show(<BuildResearchLine form={form} onApply={onApply} storage={storage} />);
        await settled();
        expect(line().textContent).toContain('"Megabase" is not one of your profiles.');
        openProfileStore(storage).create('Megabase', 'no-research');
        view.rerender(<BuildResearchLine form={{ ...form }} onApply={onApply} storage={storage} />);
        await settled();
        expect(line().textContent).not.toContain('is not one of your profiles');
        expect(screen.getByRole('combobox', { name: RESEARCH_LINE.label }).textContent).toBe('Megabase');
    });

    it('gives the same marks to the build saved and reopened, and to the build opened from a share link', async () => {
        const form = pastedIron();
        form.machines = [{ ...form.machines[0], productivity: 250 }, ...form.machines.slice(1), { ...form.machines[0], id: 99, _uuid: 'by-hand' }];
        const saved = readSavedConfig(serializeConfig(form))!;
        const link = await encodeShareLink({ name: null, config: formDataToConfig(form) }, 'https://example.test/');
        const shared = await decodeShareLink(readShareHash(link.slice(link.indexOf('#'))) as { version: string; data: string });
        if (shared.kind !== 'build') throw new Error('no build');
        const marks = async (build: ConfigFormData) => {
            const view = show(<BuildResearchLine form={build} onApply={onApply} storage={memory().storage} />);
            await settled();
            const text = [...view.container.querySelectorAll('[data-research-edited], [data-research-outside]')].map(element => element.textContent);
            view.unmount();
            return text;
        };
        const opened = await marks(form);
        expect(opened.length).toBe(2);
        expect(await marks(saved)).toEqual(opened);
        expect(await marks(configToFormData(shared.config as Config))).toEqual(opened);
    });
});
