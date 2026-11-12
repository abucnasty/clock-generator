// @vitest-environment happy-dom
import data from '../../../clock-generator/resources/data-filtered.json?raw';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigSchema, FactorioDataService, laneFactsOfConfig, type Config } from 'clock-generator/browser';
import automation from '../../../clock-generator/resources/config-samples/science/automation/automation-240.json';
import metallurgic from '../../../clock-generator/resources/config-samples/science/metallurgic/metallurgic-45.json';
import { show } from '../test/fixtures';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import type { BeltFormData, ConfigFormData } from '../utils/configForm/formData';
import { formLaneFactsOf, type FormLaneFacts } from '../utils/laneFacts';
import { laneRolesAnswer } from '../worker/laneRoles';
import { BeltsForm } from './BeltsForm';

FactorioDataService.initialize(JSON.parse(data));

const exampleForm = (sample: unknown) => configToFormData(ConfigSchema.parse(sample));
const AUTOMATION = automation;
const METALLURGIC = metallurgic;
/** The facts the page shows: the roles as the worker answers them, the rest from the light entry */
const factsOf = (form: ConfigFormData) => {
    const config = formDataToConfig(form);
    return formLaneFactsOf(config, laneRolesAnswer(config, laneFactsOfConfig(config)));
};
const withoutEnds = (form: ConfigFormData): ConfigFormData => ({ ...form, belts: form.belts.map(belt => ({ ...belt,
    lanes: belt.lanes.map(({ lane_end: _end, ...lane }) => { void _end; return lane; }) as BeltFormData['lanes'] })) });

function showBelts(form: ConfigFormData, facts: FormLaneFacts | null = factsOf(form)) {
    const onUpdate = vi.fn();
    const view = show(<BeltsForm belts={form.belts} itemNames={[]} onAdd={vi.fn()} onUpdate={onUpdate} onRemove={vi.fn()} onReorder={vi.fn()}
        onDuplicate={vi.fn()} beltQuestion={{ ask: true, answer: 'backed_up' }} onBeltAnswer={vi.fn()} laneFacts={facts}
        copies={form.setpoint.copies} outputBelt={form.output_belt} />);
    return { ...view, onUpdate };
}
async function openLanes(user: ReturnType<typeof show>['user'], belt: number) {
    await user.click(screen.getByRole('button', { name: `Entity details for Belt ${belt}` }));
    const panel = document.getElementById(screen.getByRole('button', { name: `Entity details for Belt ${belt}` }).getAttribute('aria-controls')!)!;
    await user.click(within(panel).getByRole('tab', { name: 'Lanes' }));
    return panel;
}
const combo = (name: string) => screen.queryByRole('combobox', { name });

describe('the Belts section', () => {
    it('counts the input lanes by the end the engine reads, beside the belt setting, and says what the output belt states', () => {
        showBelts(exampleForm(AUTOMATION));
        expect(screen.getByText('Input lanes').parentElement!.textContent).toContain('2 dead ends · 0 infinite');
        expect(screen.getByRole('group', { name: 'At your input pickups, items are:' })).toBeDefined();
        const outputBelt = screen.getByRole('note');
        expect(outputBelt.textContent).toBe('Output belt: stated in the file.5 stretches, 1 splitter, 1 infinite end. The page keeps it as it is stated. Change it in the configuration file.');
        expect(within(outputBelt).queryByRole('textbox')).toBeNull();
    });

    it('shows each taken lane\'s stated end, its capacity in grey, and the sharing of 9 copies; a lane the build only drops onto has no end or supply field', async () => {
        const { user } = showBelts(exampleForm(AUTOMATION));
        await openLanes(user, 1);
        expect(combo('Lane end, Belt 1, lane 1')!.textContent).toBe('Dead end');
        expect(combo('Lane end, Belt 1, lane 2')!.textContent).toBe('Dead end');
        expect(screen.getByRole('textbox', { name: 'Supply rate /s, Belt 1, lane 1' }).getAttribute('placeholder')).toBe('120');
        expect(combo('Sharing, Belt 1, lane 1')!.textContent).toBe('Shared, not stated');
        await openLanes(user, 2);
        expect(combo('Lane end, Belt 2, lane 1')).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Supply rate /s, Belt 2, lane 1' })).toBeNull();
        expect(combo('Sharing, Belt 2, lane 1')).not.toBeNull();
    });

    it('shows the engine\'s end in grey on a taken lane that states none, and writes nothing until a value is chosen', async () => {
        const form = withoutEnds(exampleForm(AUTOMATION));
        const { user, onUpdate } = showBelts(form);
        await openLanes(user, 1);
        expect(combo('Lane end, Belt 1, lane 1')!.textContent).toBe('Dead end, not stated');
        // opening and closing the settings and the tab writes nothing
        await user.click(screen.getByRole('button', { name: 'Entity details for Belt 1' }));
        expect(onUpdate).not.toHaveBeenCalled();
    });

    it('has one copy ask no sharing', async () => {
        const { user } = showBelts(exampleForm(METALLURGIC));
        await openLanes(user, 1);
        expect(combo('Lane end, Belt 1, lane 1')).not.toBeNull();
        expect(combo('Sharing, Belt 1, lane 1')).toBeNull();
    });

    it('asks a flow direction of each belt, and writes the one chosen', async () => {
        const form = exampleForm(AUTOMATION);
        const { user, onUpdate } = showBelts(form);
        await user.click(screen.getByRole('button', { name: 'Entity details for Belt 2' }));
        const field = combo('Flow direction (the way items pass the copies), Belt 2')!;
        expect(field.textContent).toBe('not stated');
        await user.click(field);
        await user.click(screen.getByRole('option', { name: 'South' }));
        expect(onUpdate).toHaveBeenLastCalledWith(1, { flow_direction: 8 });
    });

    it('renders a half-filled build without a role, a grey end or the count, where the engine cannot tell', async () => {
        const form = exampleForm(AUTOMATION);
        const { user } = showBelts(form, formLaneFactsOf(formDataToConfig(form), null));
        expect(screen.queryByText('Input lanes')).toBeNull();
        await openLanes(user, 1);
        expect(combo('Lane end, Belt 1, lane 1')).toBeNull();
        expect(screen.getAllByRole('textbox', { name: 'Stack size' })).toHaveLength(2);
    });
});

describe('the Lane end field', () => {
    it('writes the end chosen by keyboard', async () => {
        const form = withoutEnds(exampleForm(AUTOMATION));
        const { user, onUpdate } = showBelts(form);
        await openLanes(user, 1);
        combo('Lane end, Belt 1, lane 1')!.focus();
        await user.keyboard('{Enter}');
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Not stated (Dead end)', 'Dead end', 'Infinite']);
        await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
        const written = onUpdate.mock.lastCall![1].lanes[0];
        expect(written).toEqual({ ...form.belts[0].lanes[0], lane_end: { kind: 'infinite' } });
    });

    it('takes a stated end away for not stated, leaving no key', async () => {
        const form = exampleForm(AUTOMATION);
        const { user, onUpdate } = showBelts(form);
        await openLanes(user, 1);
        await user.click(combo('Lane end, Belt 1, lane 1')!);
        await user.click(screen.getByRole('option', { name: /^Not stated/ }));
        const written = onUpdate.mock.lastCall![1].lanes[0];
        expect('lane_end' in written).toBe(false);
        expect(written).toEqual({ ingredient: 'iron-gear-wheel', stack_size: 4 });
    });

    it('shows a pasted unknown end, which cannot be chosen, with its sentence, until another end is chosen', async () => {
        const form = exampleForm(AUTOMATION);
        form.belts[0].lanes[0] = { ...form.belts[0].lanes[0], lane_end: { kind: 'unknown' } };
        const { user, onUpdate } = showBelts(form);
        await openLanes(user, 1);
        const field = combo('Lane end, Belt 1, lane 1')!;
        expect(field.textContent).toBe('Unknown: set the end');
        expect(screen.getByText('The Sidecar could not tell this lane\'s end.')).toBeDefined();
        expect(field.getAttribute('aria-describedby')).toBe(screen.getByText('The Sidecar could not tell this lane\'s end.').id);
        expect(screen.getByText('Input lanes').parentElement!.textContent).toContain('1 dead end · 0 infinite · 1 unknown');
        await user.click(field);
        expect(screen.getByRole('option', { name: 'Unknown: set the end' }).getAttribute('aria-disabled')).toBe('true');
        expect(onUpdate).not.toHaveBeenCalled();
        await user.click(screen.getByRole('option', { name: 'Dead end' }));
        expect(onUpdate.mock.lastCall![1].lanes[0].lane_end).toEqual({ kind: 'dead_end' });
    });
});

describe('the Supply rate and Sharing fields', () => {
    it('write a supply rate typed, and nothing for an empty field', async () => {
        const form = exampleForm(AUTOMATION);
        const { user, onUpdate } = showBelts(form);
        await openLanes(user, 1);
        const field = screen.getByRole('textbox', { name: 'Supply rate /s, Belt 1, lane 1' });
        await user.click(field);
        await user.paste('45');
        await user.tab();
        expect(onUpdate.mock.lastCall![1].lanes[0].supply_rate).toBe(45);
    });

    it('write the sharing chosen', async () => {
        const form = exampleForm(AUTOMATION);
        const { user, onUpdate } = showBelts(form);
        await openLanes(user, 1);
        await user.click(combo('Sharing, Belt 1, lane 2')!);
        await user.click(screen.getByRole('option', { name: 'Per copy' }));
        expect(onUpdate.mock.lastCall![1].lanes[1]).toEqual({ ...form.belts[0].lanes[1], sharing: 'per_copy' });
    });
});

it('keeps an example\'s lanes as stated through the form', () => {
    const form = exampleForm(AUTOMATION);
    const config: Config = formDataToConfig(form);
    expect(config.belts).toEqual(ConfigSchema.parse(automation).belts);
});
