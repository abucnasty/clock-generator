// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configFormatProblem, Option } from 'clock-generator/light';
import { ConfigImportExport, type BuildEntryHandle } from './ConfigImportExport';
import { createDefaultConfig } from '../utils/configForm/formData';
import { REFUSED_CONFIG_ERRORS, type EngineQuery, type PastedEntities } from '../worker/types';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import ironScaffold from '../../../clock-generator/resources/config-samples/smelting/iron-plate/iron-plate-80-car-chest.scaffold?raw';
import { encodeBlueprintFileBrowser, FactorioDataService, importBlueprint, type FactorioData } from 'clock-generator/browser';
import { BLUEPRINT_FAILED_PROMPT, BLUEPRINT_PROMPTS } from '../utils/blueprintPaste';
import { targetToFill } from '../utils/pasteTarget';
import { templateOf } from '../utils/researchProfiles';
import { PASTE_PROMPTS } from '../utils/sidecarGuide';

const validate = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useDisplayPreferences', () => ({ useDisplayPreferences: () => ({ scheme: 'dark', setScheme: vi.fn() }) }));
vi.mock('../worker/engineClient', () => ({ askEngine: (request: unknown) => validate(request) }));

type Props = Parameters<typeof ConfigImportExport>[0];
let props: Props, incoming: PastedEntities, entry: { current: BuildEntryHandle | null };
function Render() {
    const view = render(<ConfigImportExport {...props} />);
    const rerender = (next: Partial<Props>) => { props = { ...props, ...next }; view.rerender(<ConfigImportExport {...props} />); };
    return { user: userEvent.setup(), rerender };
}
const apply = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Import Selected' });
// a disabled Apply takes no pointer events; a click dispatched on it still must not import
const tryApply = () => fireEvent.click(apply());
beforeEach(() => {
    vi.clearAllMocks(); entry = { current: null };
    const currentForm = createDefaultConfig();
    currentForm.inserters = [{ id: 1, _uuid: 'existing-inserter', source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 0 } }];
    incoming = { machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0, prototype: 'assembling-machine-1' }],
        drills: [], inserters: [], belts: [], chests: [], guidance: Option.none, suggested_target: Option.none };
    validate.mockResolvedValue(incoming);
    props = { ref: entry, config: null, currentForm, target: currentForm.setpoint, onImport: vi.fn(), onApplyPaste: vi.fn(), onReset: vi.fn(), onBuildReplaced: vi.fn(), onUndoable: vi.fn(), onShowIntro: vi.fn(),
        pasteIsNextStep: false, buildName: null, buildTitle: 'Test build' };
});

it('shows no Research profiles item in the menu without its prop, as on the site', async () => {
    const { user } = Render();
    await user.click(screen.getByRole('button', { name: 'More options' }));
    const names = screen.getAllByRole('menuitem').map(item => item.textContent);
    expect(names).toContain('Copy share link');
    expect(names.some(name => name?.includes('Research profiles'))).toBe(false);
});

it('shows the Research profiles item after Copy share link when given its prop, and calls it', async () => {
    const onOpenResearchProfiles = vi.fn();
    props = { ...props, onOpenResearchProfiles };
    const { user } = Render();
    await user.click(screen.getByRole('button', { name: 'More options' }));
    const names = screen.getAllByRole('menuitem').map(item => item.textContent);
    expect(names.indexOf('Research profiles…')).toBe(names.indexOf('Copy share link') + 1);
    await user.click(screen.getByRole('menuitem', { name: 'Research profiles…' }));
    expect(onOpenResearchProfiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
});

// ---------------------------------------------------------------- a pasted blueprint

describe('a pasted blueprint', () => {
    const data = JSON.parse(factorioData) as FactorioData;
    const iron = ironScaffold.trim();
    /** The worker's answer to a blueprint query, from the import itself */
    const blueprintAnswer = (query: Extract<EngineQuery, { kind: 'pasted-blueprint' }>) => {
        const outcome = importBlueprint(query.text, query.inputs, data);
        return outcome.kind === 'problem' ? outcome : { ...outcome, guidance: Option.none, suggested_target: Option.fromNullable(outcome.suggested_target) };
    };
    const asked = (kind: string) => validate.mock.calls.map(([query]) => query as EngineQuery).filter(query => query.kind === kind);
    const lastBlueprintQuery = () => asked('pasted-blueprint').at(-1) as Extract<EngineQuery, { kind: 'pasted-blueprint' }>;
    beforeEach(() => {
        // as the worker loads it: the suggested setpoint reads the data service
        FactorioDataService.initialize(data);
        window.localStorage.clear();
        validate.mockImplementation(async (query: EngineQuery) => query.kind === 'pasted-blueprint' ? blueprintAnswer(query) : incoming);
        props.currentForm = createDefaultConfig();
        props.target = props.currentForm.setpoint;
        props.itemNames = ['iron-ore', 'iron-plate', 'copper-ore', 'stone'];
    });
    /** Copies the text in the game and pastes it from the intro card */
    async function pasteText(text: string) {
        await navigator.clipboard.writeText(text);
        act(() => entry.current!.pasteFromFactorio());
    }
    const dialogOpen = () => screen.findByRole('dialog', { name: 'Confirm Import from Factorio' });
    const pastePrompt = () => screen.findByRole('dialog', { name: 'Paste from Factorio' });

    it('keeps the empty prompt for a blank text and asks nothing', async () => {
        Render();
        await pasteText('  \n ');
        expect((await pastePrompt()).textContent).toContain(PASTE_PROMPTS.empty.text);
        expect(validate).not.toHaveBeenCalled();
    });

    it.each(['{', '['])('says Sidecar exports are no longer supported for JSON that opens with %s and is no build file, and asks the worker nothing', async opening => {
        Render();
        await pasteText(` ${opening === '{' ? JSON.stringify({ machines: incoming.machines }) : '[]'}`);
        expect(await screen.findByRole('dialog', { name: 'Sidecar exports are no longer supported' })).toBeDefined();
        expect(validate).not.toHaveBeenCalled();
    });

    it('sends any other text to the import, with the research of No research and no answer', async () => {
        Render();
        await pasteText(`  ${iron}\n`);
        await dialogOpen();
        const query = asked('pasted-blueprint')[0] as Extract<EngineQuery, { kind: 'pasted-blueprint' }>;
        expect(query.text).toBe(iron);
        expect(query.inputs.answers).toEqual({});
        expect(query.inputs.research).toMatchObject({ profile: 'No research', template: 'no-research', bonuses: { mining_drill_productivity_bonus: 0 } });
    });

    it.each(Object.keys(BLUEPRINT_PROMPTS) as (keyof typeof BLUEPRINT_PROMPTS)[])('says its own prompt for the problem %s', async problem => {
        validate.mockResolvedValue({ kind: 'problem', problem });
        Render();
        await pasteText('0eNqsomething');
        expect((await pastePrompt()).textContent).toContain(BLUEPRINT_PROMPTS[problem].text);
    });

    it('says a book is to be pasted one blueprint at a time, from the real import', async () => {
        Render();
        await pasteText(encodeBlueprintFileBrowser({ blueprint_book: { item: 'blueprint-book', blueprints: [], version: 562949954076673 } } as never));
        expect((await pastePrompt()).textContent).toMatch(/copy one blueprint of it/);
    });

    it('gives its own prompt, not the Sidecar\'s, where the worker throws', async () => {
        validate.mockRejectedValue(new Error('Invalid machine at index 0: bad'));
        Render();
        await pasteText(iron);
        const prompt = await pastePrompt();
        expect(prompt.textContent).toContain(BLUEPRINT_FAILED_PROMPT.text);
        expect(prompt.textContent).not.toMatch(/update the Sidecar mod/);
    });

    it('shows the chooser, the counts, the question, the setpoint, the machines and the notes, and imports nothing while the question is open', async () => {
        const { user } = Render();
        await pasteText(iron);
        const dialog = await dialogOpen();
        expect(within(dialog).getByRole('combobox', { name: 'Research profile' })).toBeDefined();
        expect(dialog.textContent).toMatch(/Numbers used: mining \+0 %, stack inserter 5, bulk inserter 1, inserter 1, belt stacks 1/);
        expect(dialog.textContent).toMatch(/Read: \d+ machines?, .*\d+ inserters?/);
        const direct = importBlueprint(iron, lastBlueprintQuery().inputs, data);
        if (direct.kind !== 'build') throw new Error('no build');
        expect(dialog.textContent?.includes('Not read: ')).toBe(direct.ignored.length > 0);
        expect(within(dialog).getByRole('combobox', { name: 'Drill 1 mines' })).toBeDefined();
        // the candidates as item icons, each an answer
        expect(within(dialog).getByRole('button', { name: /iron.ore/i })).toBeDefined();
        expect(within(dialog).getByRole('group', { name: 'Setpoint' })).toBeDefined();
        expect(within(dialog).queryByRole('region', { name: 'Notes' }) !== null).toBe(direct.notes.some(note => note.code !== 'world:unknown-name'));
        expect(apply().disabled).toBe(true);
        tryApply();
        expect(props.onApplyPaste).not.toHaveBeenCalled();

        await user.click(within(dialog).getByRole('button', { name: /iron.ore/i }));
        await screen.findByRole('checkbox', { name: /^Drills \(1\)/ });
        // the machines wait on the ore their recipe comes from; once answered, each shows what its values are made of
        const values = within(dialog).getByRole('group', { name: 'Machine values' });
        expect(values.textContent).toMatch(/speed [\d.]+ \(\d+ beacons?, \d+ modules?\); productivity [\d.]+ % = base [\d.]+ \+ modules [\d.]+ \+ research [\d.]+, at most \d+/);
        expect(lastBlueprintQuery().inputs.answers).toEqual({ 'drill-ore:1': 'iron-ore' });
        expect(within(dialog).queryByRole('combobox', { name: 'Drill 1 mines' })).toBeNull();
        expect(apply().disabled).toBe(false);
        await user.click(apply());
        const next = vi.mocked(props.onApplyPaste).mock.calls[0][0];
        expect(next.drills!.configs.map(drill => drill.mined_item_name)).toEqual(['iron-ore']);
        expect(next.research).toMatchObject({ profile: 'No research', template: 'no-research' });
        expect(next.machines.every(machine => machine._prototype_source === 'blueprint')).toBe(true);
        expect(next.setpoint.item).toBe('iron-plate');
    });

    it('shows one setpoint row after the questions, the machine values under Machines, and the notes last', async () => {
        const { user } = Render();
        await pasteText(iron);
        const dialog = await dialogOpen();
        const follows = (first: Element, second: Element) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const setpoint = within(dialog).getByRole('group', { name: 'Setpoint' });
        expect(follows(within(dialog).getByRole('group', { name: 'Questions' }), setpoint)).toBe(true);
        // with no item yet, the row writes nothing: its box is off and cannot be ticked
        const box0 = within(setpoint).getByRole<HTMLInputElement>('checkbox', { name: 'Setpoint' });
        expect([box0.checked, box0.disabled]).toEqual([false, true]);
        await user.click(within(dialog).getByRole('button', { name: /iron.ore/i }));
        const machines = await screen.findByRole('checkbox', { name: /^Machines \(/ });
        // the setpoint is shown once: its checkbox, item, rate and copies in one row
        expect(within(dialog).getAllByRole('group', { name: 'Setpoint' })).toHaveLength(1);
        expect(within(dialog).queryByRole('checkbox', { name: /^Setpoint:/ })).toBeNull();
        expect(within(setpoint).getByRole('checkbox', { name: 'Setpoint' })).toBeDefined();
        expect(within(dialog).getAllByRole('combobox', { name: 'Setpoint item' })).toHaveLength(1);
        const values = within(dialog).getByRole('group', { name: 'Machine values' });
        const box = (name: string) => dialog.querySelector(`[data-paste-category="${name}"]`)!;
        expect(box('machines').contains(values)).toBe(true);
        const notes = await within(dialog).findByRole('region', { name: 'Notes' });
        const order = [setpoint, machines, values, box('drills'), box('inserters'), box('belts'), box('chests'), notes];
        order.slice(1).forEach((element, index) => expect(follows(order[index], element), `row ${index + 1} before row ${index}`).toBe(true));
        expect(follows(box('chests'), notes)).toBe(true);
    });

    it('asks the worker again when the user picks another setpoint item', async () => {
        const { user } = Render();
        await pasteText(iron);
        const dialog = await dialogOpen();
        await user.click(within(dialog).getByRole('button', { name: /iron.ore/i }));
        await vi.waitFor(() => expect(lastBlueprintQuery().inputs.setpoint).toEqual({ item: 'iron-plate', copies: 1 }));
        const before = asked('pasted-blueprint').length;
        await user.click(within(within(dialog).getByRole('group', { name: 'Setpoint' })).getByRole('combobox', { name: 'Setpoint item' }));
        await user.click(await screen.findByRole('option', { name: /^stone/i }));
        await vi.waitFor(() => expect(asked('pasted-blueprint').length).toBe(before + 1));
        expect(lastBlueprintQuery().inputs.setpoint).toEqual({ item: 'stone', copies: 1 });
        // the row is ticked for the item the user chose
        expect(within(within(dialog).getByRole('group', { name: 'Setpoint' })).getByRole<HTMLInputElement>('checkbox', { name: 'Setpoint' }).checked).toBe(true);
    });

    it('marks a value that rests on no read of the game "please check", beside the entity it is about', async () => {
        const { user } = Render();
        await pasteText(iron);
        const dialog = await dialogOpen();
        await user.click(within(dialog).getByRole('button', { name: /iron.ore/i }));
        const notes = await within(dialog).findByRole('region', { name: 'Notes' });
        const direct = importBlueprint(iron, lastBlueprintQuery().inputs, data);
        if (direct.kind !== 'build') throw new Error('no build');
        const checked = direct.notes.filter(note => note.please_check);
        expect(checked.length).toBeGreaterThan(0);
        expect(notes.querySelectorAll('[data-note]').length).toBe(direct.notes.filter(note => note.code !== 'world:unknown-name').length);
        expect(within(notes).getAllByText('please check').length).toBe(checked.length);
        expect(notes.textContent).toMatch(/Belt \d+: [^.]+: its lane is not checked in the game yet\./);
    });

    it('asks the worker again with another profile\'s numbers, and remembers the choice', async () => {
        const { user } = Render();
        await pasteText(iron);
        const dialog = await dialogOpen();
        const before = asked('pasted-blueprint').length;
        await user.click(within(dialog).getByRole('combobox', { name: 'Research profile' }));
        await user.click(await screen.findByRole('option', { name: /All research/ }));
        await screen.findByText(/Numbers used: mining \+20 %/);
        expect(asked('pasted-blueprint').length).toBe(before + 1);
        expect(lastBlueprintQuery().inputs.research).toMatchObject({ profile: 'All research', template: 'all-finite-research', bonuses: { mining_drill_productivity_bonus: 20 } });
        expect(JSON.parse(window.localStorage.getItem('clock-generator-research-profiles')!).lastUsed).toBe('all-finite-research');
    });

    // the answers the worker is asked for while they are held back, each as the function that gives it
    const heldAnswers: Array<() => void> = [];
    const holdBlueprintAnswers = () => validate.mockImplementation((query: EngineQuery) => query.kind === 'pasted-blueprint'
        ? new Promise(resolve => { heldAnswers.push(() => resolve(blueprintAnswer(query))); })
        : Promise.resolve(incoming));
    const stopHolding = () => validate.mockImplementation(async (query: EngineQuery) => query.kind === 'pasted-blueprint' ? blueprintAnswer(query) : incoming);
    const releaseHeldAnswers = () => act(() => { heldAnswers.splice(0).forEach(answer => answer()); });
    /** Pastes the iron build and answers its drill ore, to the point where both asks of the answer are in and the button is on */
    async function reachSettledBuild(user: ReturnType<typeof userEvent.setup>) {
        heldAnswers.length = 0;
        await pasteText(iron);
        const dialog = await dialogOpen();
        await user.click(within(dialog).getByRole('button', { name: /iron.ore/i }));
        await screen.findByRole('checkbox', { name: /^Drills \(1\)/ });
        await vi.waitFor(() => expect(apply().disabled).toBe(false));
        // the answer, then the suggested item
        expect(lastBlueprintQuery().inputs.setpoint).toEqual({ item: 'iron-plate', copies: 1 });
        return dialog;
    }

    it('imports nothing while the answer to a changed research profile is out, and saves that profile\'s numbers once it is in', async () => {
        const { user } = Render();
        const dialog = await reachSettledBuild(user);
        const before = importBlueprint(iron, lastBlueprintQuery().inputs, data);
        if (before.kind !== 'build') throw new Error('no build');
        holdBlueprintAnswers();
        const finite = templateOf('all-finite-research')!;
        await user.click(within(dialog).getByRole('combobox', { name: 'Research profile' }));
        await user.click(await screen.findByRole('option', { name: new RegExp(`^${finite.name}`) }));
        await vi.waitFor(() => expect(heldAnswers.length).toBeGreaterThan(0));
        // in the gap the preview still holds the answer of the previous profile
        tryApply();
        expect(props.onApplyPaste).not.toHaveBeenCalled();
        expect(apply().disabled).toBe(true);

        stopHolding();
        releaseHeldAnswers();
        await vi.waitFor(() => expect(apply().disabled).toBe(false));
        await user.click(apply());
        const next = vi.mocked(props.onApplyPaste).mock.calls[0][0];
        const after = importBlueprint(iron, lastBlueprintQuery().inputs, data);
        if (after.kind !== 'build') throw new Error('no build');
        expect(lastBlueprintQuery().inputs.research).toMatchObject({ template: 'all-finite-research' });
        expect(next.research).toMatchObject({ template: 'all-finite-research' });
        expect(next.drills!.configs.map(drill => drill.productivity)).toEqual(after.drills.map(drill => drill.productivity));
        expect(next.drills!.configs[0].productivity).toBeCloseTo(before.drills[0].productivity + finite.bonuses.mining_drill_productivity_bonus, 6);
    });

    it.each([
        ['the setpoint item', async (dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) => {
            await user.click(within(within(dialog).getByRole('group', { name: 'Setpoint' })).getByRole('combobox', { name: 'Setpoint item' }));
            await user.click(await screen.findByRole('option', { name: /^stone/i }));
        }],
        ['the copies', async (dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) => {
            const copies = within(within(dialog).getByRole('group', { name: 'Setpoint' })).getByRole('textbox', { name: 'Copies' });
            await user.clear(copies);
            await user.type(copies, '3');
            await user.tab();
        }],
    ])('keeps Import Selected off while the answer to changed %s is out, and on again when it is in', async (_name, change) => {
        const { user } = Render();
        const dialog = await reachSettledBuild(user);
        holdBlueprintAnswers();
        await change(dialog, user);
        await vi.waitFor(() => expect(heldAnswers.length).toBeGreaterThan(0));
        expect(apply().disabled).toBe(true);
        tryApply();
        expect(props.onApplyPaste).not.toHaveBeenCalled();

        stopHolding();
        const query = lastBlueprintQuery();
        releaseHeldAnswers();
        const answer = blueprintAnswer(query);
        // the button follows the answer: on for a build with no open question
        await vi.waitFor(() => expect(apply().disabled).toBe(!(answer.kind === 'build' && answer.questions.length === 0)));
    });

    it('opens the button again for a new paste after a cancel in the gap', async () => {
        const { user } = Render();
        const dialog = await reachSettledBuild(user);
        holdBlueprintAnswers();
        await user.click(within(dialog).getByRole('combobox', { name: 'Research profile' }));
        await user.click(await screen.findByRole('option', { name: new RegExp(`^${templateOf('all-finite-research')!.name}`) }));
        await vi.waitFor(() => expect(heldAnswers.length).toBeGreaterThan(0));
        expect(apply().disabled).toBe(true);
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm Import from Factorio' })).toBeNull());

        stopHolding();
        const again = await reachSettledBuild(user);
        expect(within(again).getByRole('button', { name: 'Import Selected' })).toBeDefined();
        expect(apply().disabled).toBe(false);
    });

    /** Picks the finite-research profile, which asks the import again, and waits until that answer is held back */
    async function changeProfileAndHold(dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
        holdBlueprintAnswers();
        await user.click(within(dialog).getByRole('combobox', { name: 'Research profile' }));
        await user.click(await screen.findByRole('option', { name: new RegExp(`^${templateOf('all-finite-research')!.name}`) }));
        await vi.waitFor(() => expect(heldAnswers.length).toBeGreaterThan(0));
    }
    /** Clears a field, types the value and leaves the field, as a user commits it */
    async function typeInto(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, value: string) {
        await user.clear(field);
        await user.type(field, value);
        await user.tab();
    }

    it.each([
        ['a machine\'s speed', async (dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) => {
            const speeds = within(within(dialog).getByRole('group', { name: 'Machine values' })).getAllByRole('textbox', { name: /^Speed, / });
            await typeInto(user, speeds[0], '7.5');
        }, (next: Parameters<Props['onApplyPaste']>[0]) => expect(next.machines[0].crafting_speed).toBe(7.5)],
        ['the items per second', async (dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) => {
            await typeInto(user, within(within(dialog).getByRole('group', { name: 'Setpoint' })).getByRole('textbox', { name: 'Items per second' }), '37.5');
        }, (next: Parameters<Props['onApplyPaste']>[0]) => expect(next.setpoint.items_per_second).toBe(37.5)],
    ])('keeps %s typed while the answer to a changed research profile is out, and saves it with that profile\'s numbers', async (_name, typeInGap, expectTyped) => {
        const { user } = Render();
        const dialog = await reachSettledBuild(user);
        await changeProfileAndHold(dialog, user);
        await typeInGap(dialog, user);
        // typing in the gap does not ask: the one answer that is out is the one that comes
        expect(heldAnswers.length).toBe(1);

        stopHolding();
        releaseHeldAnswers();
        await vi.waitFor(() => expect(apply().disabled).toBe(false));
        await user.click(apply());
        const next = vi.mocked(props.onApplyPaste).mock.calls[0][0];
        expectTyped(next);
        const after = importBlueprint(iron, lastBlueprintQuery().inputs, data);
        if (after.kind !== 'build') throw new Error('no build');
        expect(next.research).toMatchObject({ template: 'all-finite-research' });
        expect(next.drills!.configs.map(drill => drill.productivity)).toEqual(after.drills.map(drill => drill.productivity));
    });

    it('still moves the setpoint to the new suggestion when nothing was typed in the gap', async () => {
        const { user } = Render();
        const dialog = await reachSettledBuild(user);
        const before = importBlueprint(iron, lastBlueprintQuery().inputs, data);
        if (before.kind !== 'build' || before.suggested_target === null) throw new Error('no suggestion');
        await changeProfileAndHold(dialog, user);
        stopHolding();
        releaseHeldAnswers();
        await vi.waitFor(() => expect(apply().disabled).toBe(false));
        await user.click(apply());
        const next = vi.mocked(props.onApplyPaste).mock.calls[0][0];
        const after = importBlueprint(iron, lastBlueprintQuery().inputs, data);
        if (after.kind !== 'build' || after.suggested_target === null) throw new Error('no suggestion');
        expect(next.setpoint.items_per_second).toEqual(targetToFill(after.suggested_target).items_per_second);
        // the profile moves the suggested rate, so a fix that took the rate shown before the answer would fail here
        expect(targetToFill(after.suggested_target).items_per_second).not.toEqual(targetToFill(before.suggested_target).items_per_second);
    });

    it('asks the worker again when the copies change, and with the setpoint item it was given', async () => {
        const { user } = Render();
        await pasteText(iron);
        const dialog = await dialogOpen();
        // the suggestion follows the answer that settles the drill, and is asked again with its item
        await user.click(within(dialog).getByRole('button', { name: /iron.ore/i }));
        await vi.waitFor(() => expect(lastBlueprintQuery().inputs.setpoint).toEqual({ item: 'iron-plate', copies: 1 }));
        const copies = within(within(dialog).getByRole('group', { name: 'Setpoint' })).getByRole('textbox', { name: 'Copies' });
        await user.clear(copies);
        await user.type(copies, '3');
        await user.tab();
        expect(lastBlueprintQuery().inputs.setpoint).toEqual({ item: 'iron-plate', copies: 3 });
    });

    it('fills the lane that holds the other ingredient when one lane is answered, asks no second question, and saves both lanes', async () => {
        // a belt of two ingredients that nothing puts on it: a taker into a machine of logistic science packs and a taker into a chest
        const belt = (entity_number: number, y: number) => ({ entity_number, name: 'transport-belt', position: { x: 0.5, y }, direction: 8 });
        const entities = [
            belt(1, 0.5), belt(2, 1.5), belt(3, 2.5), belt(4, 3.5),
            { entity_number: 5, name: 'stack-inserter', position: { x: 1.5, y: 0.5 }, direction: 12 },
            { entity_number: 6, name: 'assembling-machine-3', position: { x: 3.5, y: 0.5 }, recipe: 'logistic-science-pack' },
            { entity_number: 7, name: 'stack-inserter', position: { x: 1.5, y: 3.5 }, direction: 12 },
            { entity_number: 8, name: 'steel-chest', position: { x: 2.5, y: 3.5 } },
        ];
        const { user } = Render();
        await pasteText(encodeBlueprintFileBrowser({ blueprint: { item: 'blueprint', version: 562949954076673, entities } } as never));
        const dialog = await dialogOpen();
        const question = (lane: number) => dialog.querySelector<HTMLElement>(`[data-question="lane-item:1:${lane}"]`);
        expect(question(1)).not.toBeNull();
        expect(question(2)).not.toBeNull();
        expect(apply().disabled).toBe(true);

        await user.click(within(question(1)!).getByRole('button', { name: /^inserter$/i }));
        await vi.waitFor(() => expect(question(2)).toBeNull());
        expect(lastBlueprintQuery().inputs.answers).toEqual({ 'lane-item:1:1': 'inserter' });
        await vi.waitFor(() => expect(apply().disabled).toBe(false));
        await user.click(apply());
        const next = vi.mocked(props.onApplyPaste).mock.calls[0][0];
        expect(next.belts.map(belt => belt.lanes.map(lane => lane.ingredient))).toEqual([['inserter', 'transport-belt']]);
    });

    it('asks the rate of a lane that a throttle empties, keeps Import Selected off until it is answered, and saves the lane as an export at that rate', async () => {
        // a belt of iron plate going south: a taker into a machine of gears, and below it an inserter that takes into an infinity chest that removes every item
        const belt = (entity_number: number, y: number) => ({ entity_number, name: 'transport-belt', position: { x: 0.5, y }, direction: 8 });
        const entities = [
            belt(1, 0.5), belt(2, 1.5), belt(3, 2.5), belt(4, 3.5), belt(5, 4.5), belt(6, 5.5),
            { entity_number: 10, name: 'stack-inserter', position: { x: 1.5, y: 0.5 }, direction: 12 },
            { entity_number: 11, name: 'assembling-machine-1', position: { x: 3.5, y: 0.5 }, recipe: 'iron-gear-wheel' },
            { entity_number: 12, name: 'stack-inserter', position: { x: -0.5, y: 5.5 }, direction: 4 },
            { entity_number: 13, name: 'infinity-chest', position: { x: -1.5, y: 5.5 }, infinity_settings: { remove_unfiltered_items: true } },
        ];
        const { user } = Render();
        await pasteText(encodeBlueprintFileBrowser({ blueprint: { item: 'blueprint', version: 562949954076673, entities } } as never));
        const dialog = await dialogOpen();
        const row = () => dialog.querySelector<HTMLElement>('[data-question="lane-export:1:2"]');
        expect(row()).not.toBeNull();
        expect(apply().disabled).toBe(true);

        const field = within(row()!).getByRole('textbox', { name: /a second leave Belt 1, lane 2\?$/ });
        await user.type(field, '40');
        await user.tab();
        await vi.waitFor(() => expect(lastBlueprintQuery().inputs.answers).toEqual({ 'lane-export:1:2': '40' }));
        await vi.waitFor(() => expect(apply().disabled).toBe(false));
        // the answered row stays, marked
        expect(row()!.getAttribute('data-answered')).toBe('');
        await user.click(apply());
        const next = vi.mocked(props.onApplyPaste).mock.calls[0][0];
        expect(next.belts.map(belt => [belt.strategy, belt.lanes.map(lane => lane.consumption_per_second)])).toEqual([['export', [undefined, 40]]]);
    });

    it('opens a blueprint saved as a text file, and a build file as before', async () => {
        const { container } = render(<ConfigImportExport {...props} />);
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
        expect(input.accept).toMatch(/\.txt/);
        fireEvent.change(input, { target: { files: [new File([iron], 'iron.txt', { type: 'text/plain' })] } });
        await dialogOpen();
        expect(asked('pasted-blueprint').length).toBeGreaterThan(0);
        expect(asked('config-file')).toEqual([]);
    });

    it('opens a build file as before', async () => {
        const { container } = render(<ConfigImportExport {...props} />);
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
        fireEvent.change(input, { target: { files: [new File([JSON.stringify({ format: 1, setpoint: { item: 'iron-plate', items_per_second: 1, copies: 1 }, machines: [] })], 'build.json')] } });
        await vi.waitFor(() => expect(asked('config-file').length).toBe(1));
        expect(asked('pasted-blueprint')).toEqual([]);
    });
});

describe('a configuration of another format', () => {
    const old = { setpoint: { item: 'iron-plate', items_per_second: 1, copies: 1 }, machines: [] };
    // the worker refuses it at its door, before any check, with the message its answer carries
    const refusing = (problem: 'old' | 'newer') => validate.mockImplementation(async (request: EngineQuery) => {
        if (request.kind === 'config-file') throw new Error(REFUSED_CONFIG_ERRORS[problem]);
        return incoming;
    });

    it.each(['old', 'newer'] as const)('opened as a file (%s), says so in place of the build, with Paste a blueprint', async problem => {
        refusing(problem);
        const { container } = render(<ConfigImportExport {...props} />);
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
        fireEvent.change(input, { target: { files: [new File([JSON.stringify(old)], 'build.json')] } });
        const dialog = await screen.findByRole('dialog', { name: problem === 'old' ? 'This configuration is no longer supported' : 'This configuration was made by a newer version of the site' });
        expect(within(dialog).getByRole('button', { name: 'Paste a blueprint' })).toBeDefined();
        expect(props.onImport).not.toHaveBeenCalled();
        expect(props.onBuildReplaced).not.toHaveBeenCalled();
    });

    it('opened as a file, an export of the Sidecar mod gets its message and opens nothing', async () => {
        const { container } = render(<ConfigImportExport {...props} />);
        const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
        fireEvent.change(input, { target: { files: [new File([JSON.stringify({ sidecar_version: '0.16.0', machines: [] })], 'export.json')] } });
        const dialog = await screen.findByRole('dialog', { name: 'Sidecar exports are no longer supported' });
        expect(within(dialog).getByRole('button', { name: 'Paste a blueprint' })).toBeDefined();
        expect(validate).not.toHaveBeenCalled();
        expect(props.onImport).not.toHaveBeenCalled();
    });

    it('pasted, is refused for its format without asking the engine', async () => {
        Render();
        await navigator.clipboard.writeText(JSON.stringify(old));
        act(() => entry.current!.pasteFromFactorio());
        expect(await screen.findByRole('dialog', { name: 'This configuration is no longer supported' })).toBeDefined();
        expect(validate).not.toHaveBeenCalled();
    });

    it('is what Save configuration file writes: the format first, and the file opens again', async () => {
        const blobs: Blob[] = [];
        vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: (blob: Blob) => { blobs.push(blob); return 'blob:saved'; }, revokeObjectURL: vi.fn() }));
        try {
            const build = { setpoint: { item: 'iron-plate', items_per_second: 1, copies: 1 }, machines: [], inserters: [], belts: [], chests: [] };
            props = { ...props, config: build as never };
            const { user } = Render();
            await user.click(screen.getByRole('button', { name: 'More options' }));
            await user.click(screen.getByRole('menuitem', { name: 'Save configuration file' }));
            expect(blobs).toHaveLength(1);
            const saved = JSON.parse(await blobs[0].text()) as Record<string, unknown>;
            expect(Object.keys(saved)[0]).toBe('format');
            expect(saved.format).toBe(1);
            expect(configFormatProblem(saved)).toBeNull();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('pasted with this format, is a build file to open, as before', async () => {
        Render();
        await navigator.clipboard.writeText(JSON.stringify({ format: 1, ...old }));
        act(() => entry.current!.pasteFromFactorio());
        expect(await screen.findByText(PASTE_PROMPTS['build-file'].text)).toBeDefined();
        expect(screen.queryByRole('dialog', { name: 'This configuration is no longer supported' })).toBeNull();
    });
});
