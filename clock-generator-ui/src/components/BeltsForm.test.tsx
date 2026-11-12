// @vitest-environment happy-dom
import data from '../../../clock-generator/resources/data-filtered.json?raw';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigSchema, FactorioDataService, laneFactsOfConfig, type Config } from 'clock-generator/browser';
import automation from '../../../clock-generator/resources/config-samples/science/automation/automation-240.json';
import metallurgic from '../../../clock-generator/resources/config-samples/science/metallurgic/metallurgic-45.json';
import military from '../../../clock-generator/resources/config-samples/science/military/military-240.json';
import logistic from '../../../clock-generator/resources/config-samples/science/logistic/logistic-240.json';
import utility from '../../../clock-generator/resources/config-samples/science/utility/utility-120.json';
import chemical from '../../../clock-generator/resources/config-samples/science/chemical/chemical-240-shared-foundry.json';
import electromagnetic from '../../../clock-generator/resources/config-samples/science/electromagnetic/electromagnetic-330.json';
import production from '../../../clock-generator/resources/config-samples/science/production/production-120-two-belts.json';
import agriculture from '../../../clock-generator/resources/config-samples/science/agricultural/agricultural-250.json';
import { belt as beltRow, build, inserter, machine, show } from '../test/fixtures';
import { configToFormData, formDataToConfig } from '../utils/configForm/configMapping';
import type { BeltFormData, ConfigFormData } from '../utils/configForm/formData';
import { formLaneFactsOf, type FormLaneFacts } from '../utils/laneFacts';
import { laneRolesAnswer } from '../worker/laneRoles';
import { BeltsForm } from './BeltsForm';
import { BeltLaneFields } from './EntityFields';

FactorioDataService.initialize(JSON.parse(data));

const exampleForm = (sample: unknown) => configToFormData(ConfigSchema.parse(sample));
const AUTOMATION = automation;
const METALLURGIC = metallurgic;
const MILITARY = military;
/** The facts as the page has them: none of the engine's where it throws (a machine with no recipe) */
const pageFactsOf = (form: ConfigFormData) => {
    const config = formDataToConfig(form);
    try {
        return formLaneFactsOf(config, laneRolesAnswer(config, laneFactsOfConfig(config)));
    } catch {
        return formLaneFactsOf(config, null);
    }
};
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
        await openLanes(user, 2);
        const field = combo('Flow direction (the way items pass the copies), Belt 2')!;
        expect(field.textContent).toBe('Not stated');
        await user.click(field);
        await user.click(screen.getByRole('option', { name: 'South' }));
        expect(onUpdate).toHaveBeenLastCalledWith(1, { flow_direction: 8 });
    });

    it('takes a stated flow direction away for not stated', async () => {
        const form = exampleForm(AUTOMATION);
        expect(form.belts[0].flow_direction).toBe(4);
        const { user, onUpdate } = showBelts(form);
        await openLanes(user, 1);
        const field = combo('Flow direction (the way items pass the copies), Belt 1')!;
        expect(field.textContent).toBe('East');
        await user.click(field);
        await user.click(screen.getByRole('option', { name: 'Not stated' }));
        expect(onUpdate).toHaveBeenLastCalledWith(0, { flow_direction: undefined });
    });

    it('shows the stated ends, with no grey value and no count, before the engine has given the roles', async () => {
        const form = exampleForm(AUTOMATION);
        const { user } = showBelts(form, formLaneFactsOf(formDataToConfig(form), null));
        expect(screen.queryByText('Input lanes')).toBeNull();
        await openLanes(user, 1);
        expect(combo('Lane end, Belt 1, lane 1')!.textContent).toBe('Dead end');
        expect(screen.queryByRole('textbox', { name: 'Supply rate /s, Belt 1, lane 1' })).toBeNull();
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

describe('a stated value is never hidden', () => {
    it('shows a lane the build only drops onto with the end it states, and no field where it states none', async () => {
        const { user, unmount } = showBelts(exampleForm(MILITARY));
        await openLanes(user, 1);
        expect(combo('Lane end, Belt 1, lane 1')!.textContent).toBe('Infinite');
        expect(screen.queryByRole('textbox', { name: 'Supply rate /s, Belt 1, lane 1' })).toBeNull();
        unmount();
        const { user: other } = showBelts(exampleForm(AUTOMATION));
        await openLanes(other, 2);
        expect(combo('Lane end, Belt 2, lane 1')).toBeNull();
    });

    it('shows every stated end, supply rate and sharing where the engine cannot give the roles, with no grey default and no count', async () => {
        const form = exampleForm(AUTOMATION);
        form.machines.push({ ...form.machines[0], id: 9, _uuid: 'm9', recipe: '' });
        form.belts[0].lanes[1] = { ...form.belts[0].lanes[1]!, supply_rate: 30 };
        expect(() => laneFactsOfConfig(formDataToConfig(form))).toThrow();
        const { user } = showBelts(form, pageFactsOf(form));
        expect(screen.queryByText('Input lanes')).toBeNull();
        expect(screen.queryByText(/^input belt/)).toBeNull();
        await openLanes(user, 1);
        expect(combo('Lane end, Belt 1, lane 1')!.textContent).toBe('Dead end');
        expect(screen.queryByRole('textbox', { name: 'Supply rate /s, Belt 1, lane 1' })).toBeNull();
        const supply = screen.getByRole('textbox', { name: 'Supply rate /s, Belt 1, lane 2' }) as HTMLInputElement;
        expect([supply.value, supply.getAttribute('placeholder')]).toEqual(['30', null]);
        // a lane that states no sharing has no Sharing field, which would be empty
        expect(combo('Sharing, Belt 1, lane 1')).toBeNull();
    });

    it('shows no Lane end on a lane with a consumption rate, whose end is infinite', async () => {
        const form = exampleForm(AUTOMATION);
        form.belts[1] = { ...form.belts[1], strategy: 'export', lanes: [{ ...form.belts[1].lanes[0], consumption_per_second: 5 }] };
        const { user } = showBelts(form);
        await openLanes(user, 2);
        expect(combo('Lane end, Belt 2, lane 1')).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Consumed /s' })).toBeDefined();
    });
});

describe('the grey default follows the engine', () => {
    it.each([
        [false, 'Infinite, not stated'],
        [undefined, 'Dead end, not stated'],
        [true, 'Dead end, not stated'],
    ])('with backed_up_belts %s a taken lane that states no end shows %s', async (backed_up_belts, shown) => {
        const form = withoutEnds(exampleForm(AUTOMATION));
        if (backed_up_belts !== undefined) form.overrides = { ...form.overrides, backed_up_belts };
        const { user } = showBelts(form);
        await openLanes(user, 1);
        expect(combo('Lane end, Belt 1, lane 1')!.textContent).toBe(shown);
    });
});

describe('the role line under each belt', () => {
    it.each([
        ['automation science, belt 1', AUTOMATION, 1, 'input belt · the 9 copies share it'],
        ['automation science, belt 2', AUTOMATION, 2, 'output belt · the output inserters drop on it'],
        ['military science, belt 5', MILITARY, 5, 'input belt · each copy has its own'],
        ['military science, belt 3', MILITARY, 3, 'input belt · the 5 copies share it'],
        ['metallurgic science, belt 1', METALLURGIC, 1, 'input belt'],
    ])('%s: %s', (_name, sample, belt, line) => {
        const { container } = showBelts(exampleForm(sample));
        const lines = [...container.querySelectorAll('[data-belt-role]')].map(it => it.textContent);
        const form = exampleForm(sample);
        expect(lines[form.belts.findIndex(it => it.id === belt)]).toBe(line);
    });
});

describe('a half-filled form', () => {
    const lanes = (...items: string[]) => items.map(ingredient => ({ ingredient, stack_size: 4 })) as BeltFormData['lanes'];
    const takes = (fields = {}) => inserter(1, { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, ...fields });
    it.each([
        ['a lane with no item', build({ machines: [machine(1, { recipe: 'iron-gear-wheel' })], belts: [beltRow(1, { lanes: lanes('') })], inserters: [takes()] })],
        ['a belt with no lane', build({ machines: [machine(1, { recipe: 'iron-gear-wheel' })], belts: [beltRow(1, { lanes: [] as unknown as BeltFormData['lanes'] })], inserters: [takes()] })],
        ['an inserter with no source', build({ machines: [machine(1, { recipe: 'iron-gear-wheel' })], belts: [beltRow(1, { lanes: lanes('iron-plate') })],
            inserters: [takes({ source: { type: 'belt', id: 0 } })] })],
        ['an inserter with no sink', build({ machines: [machine(1, { recipe: 'iron-gear-wheel' })], belts: [beltRow(1, { lanes: lanes('iron-plate') })],
            inserters: [takes({ sink: { type: 'machine', id: 0 } })] })],
        ['a build with no machine', build({ machines: [], belts: [beltRow(1, { lanes: lanes('iron-plate') })], inserters: [takes()] })],
        ['a machine with no recipe', build({ machines: [machine(1, { recipe: '' })], belts: [beltRow(1, { lanes: lanes('iron-plate') })], inserters: [takes()] })],
    ])('%s: the Belts section renders, with no role and no grey default where the engine cannot tell', async (_name, form) => {
        const { user } = showBelts(form, pageFactsOf(form));
        expect(screen.getByRole('heading', { name: 'Belts (1)' })).toBeDefined();
        expect(screen.queryByText(/belt ·|^input belt$|^lane 1/)).toBeNull();
        await openLanes(user, 1);
        // no inserter takes this lane's item, or the engine cannot tell: no Lane end and no grey value
        expect(combo('Lane end, Belt 1, lane 1')).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Supply rate /s, Belt 1, lane 1' })).toBeNull();
    });
});

describe('the Lanes fields of the 9 examples follow the engine', () => {
    const EXAMPLES = { logistic, automation, utility, chemical, electromagnetic, military, production, metallurgic, agriculture };
    const ENDS = { dead_end: 'Dead end', infinite: 'Infinite', unknown: 'Unknown: set the end' } as const;
    it.each(Object.entries(EXAMPLES).flatMap(([name, sample]) => [[name, sample, 'as stated'], [name, sample, 'with no end stated']] as const))(
        '%s, %s: a lane has a Lane end field where it is taken from or states one, showing the stated end or the engine\'s in grey, and a Supply rate field where it is taken from or states one',
        (_name, sample, variant) => {
            const form = variant === 'as stated' ? exampleForm(sample) : withoutEnds(exampleForm(sample));
            const config = formDataToConfig(form);
            const engine = laneFactsOfConfig(config);
            const facts = factsOf(form);
            for (const belt of form.belts) {
                const { unmount } = show(<BeltLaneFields belt={belt} itemNames={[]} readOnly={false} facts={facts} copies={form.setpoint.copies} onChange={vi.fn()} />);
                belt.lanes.forEach((lane, index) => {
                    const fact = engine.of(belt.id, index + 1 as 1 | 2);
                    const taken = fact.role === 'input' || fact.role === 'buffer';
                    const owner = `Belt ${belt.id}, lane ${index + 1}`;
                    const end = combo(`Lane end, ${owner}`);
                    expect(end !== null).toBe(lane.consumption_per_second === undefined && (taken || lane.lane_end !== undefined));
                    if (end !== null) {
                        expect(end.textContent).toBe(lane.lane_end !== undefined ? ENDS[lane.lane_end.kind] : `${ENDS[fact.lane_end.kind]}, not stated`);
                    }
                    expect(screen.queryByRole('textbox', { name: `Supply rate /s, ${owner}` }) !== null).toBe(taken || lane.supply_rate !== undefined);
                });
                unmount();
            }
        });
});

describe('no control of the Lanes tab is empty', () => {
    it.each([
        ['the engine gives the facts', false],
        ['a machine has no recipe, so the engine gives no facts', true],
    ])('%s: every field shows a value, a grey default or "Not stated"', async (_name, noRecipe) => {
        const form = withoutEnds(exampleForm(AUTOMATION));
        form.belts[0].lanes[1] = { ...form.belts[0].lanes[1]!, sharing: 'per_copy', lane_end: { kind: 'dead_end' } };
        form.belts[1] = { ...form.belts[1], flow_direction: undefined };
        if (noRecipe) form.machines.push({ ...form.machines[0], id: 9, _uuid: 'm9', recipe: '' });
        const { user } = showBelts(form, pageFactsOf(form));
        for (const belt of [1, 2]) {
            const panel = await openLanes(user, belt);
            for (const field of within(panel).getAllByRole('combobox')) {
                expect(field.textContent!.trim(), field.getAttribute('aria-label')!).not.toBe('');
            }
            for (const field of within(panel).getAllByRole('textbox')) {
                const input = field as HTMLInputElement;
                expect(input.value !== '' || (input.getAttribute('placeholder') ?? '') !== '', input.getAttribute('aria-label') ?? 'textbox').toBe(true);
            }
        }
        if (noRecipe) {
            expect(combo('Sharing, Belt 1, lane 1')).toBeNull();
            expect(combo('Sharing, Belt 1, lane 2')!.textContent).toBe('Per copy');
            expect(combo('Flow direction (the way items pass the copies), Belt 2')!.textContent).toBe('Not stated');
        }
    });
});
