// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Option } from 'clock-generator/light';
import { ConfigImportExport, type BuildEntryHandle } from './ConfigImportExport';
import { createDefaultConfig } from '../utils/configForm/formData';
import { inserterDetailLines } from '../utils/pasteText';
import type { EngineQuery, PastedEntities } from '../worker/types';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import ironScaffold from '../../../clock-generator/resources/config-samples/smelting/iron-plate/iron-plate-80-car-chest.scaffold?raw';
import { encodeBlueprintFileBrowser, FactorioDataService, importBlueprint, type FactorioData } from 'clock-generator/browser';
import { BLUEPRINT_FAILED_PROMPT, BLUEPRINT_PROMPTS } from '../utils/blueprintPaste';
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
const ACKNOWLEDGMENT = 'I understand these parts will be combined using their entity numbers.';
const apply = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Import Selected' });
// a disabled Apply takes no pointer events; a click dispatched on it still must not import
const tryApply = () => fireEvent.click(apply());
const category = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name} \\(`) });
/** Copies an export in the game and pastes it from the intro card, which waits for the preview of this paste */
async function paste(exported: object = { sidecar_version: '0.7.1', machines: incoming.machines, inserters: [], belts: [], chests: [], drills: { configs: [], mining_productivity_level: 0 } }) {
    await navigator.clipboard.writeText(JSON.stringify(exported));
    act(() => entry.current!.pasteFromFactorio());
    await screen.findByRole('checkbox', { name: /^Machines \(/ });
}
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

it('shows capture diagnostics alongside prospective pickup coverage, only while importing those inserters', async () => {
    incoming.inserters = [{ source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 } }];
    incoming.belts = [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'iron-plate', stack_size: 4 }] }];
    const { user } = Render();
    await paste({ machines: incoming.machines, inserters: incoming.inserters, belts: incoming.belts, pickup_warnings: [{ inserter_id: 1, reason: 'bend' }] });
    expect(screen.getByText(/^Straight belt is the default/)).toBeDefined();
    expect(screen.getByText(/pickup is on a belt bend/)).toBeDefined();
    await user.click(category('Inserters'));
    expect(screen.queryByText(/pickup is on a belt bend/)).toBeNull();
});

it('says in the paste preview that a side-loaded pickup is out of scope', async () => {
    incoming.inserters = [{ source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 } }];
    incoming.belts = [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'iron-plate', stack_size: 4 }] }];
    Render();
    await paste({ machines: incoming.machines, inserters: incoming.inserters, belts: incoming.belts, pickup_warnings: [{ inserter_id: 1, reason: 'side-loaded' }] });
    expect(screen.getByText(/another belt side-loads onto the pickup tile.*out of scope/)).toBeDefined();
    expect(screen.queryByText(/has not been calibrated/)).toBeNull();
});

it('says in the paste preview which drop side-loads onto another belt, in the approved wording, only while importing those inserters', async () => {
    incoming.inserters = [{ source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1, drop_capture: { status: 'side-loaded', tiles: 3, sidecar_version: '0.13.0' } } }];
    incoming.belts = [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'iron-plate', stack_size: 4 }] }];
    const { user } = Render();
    await paste({ machines: incoming.machines, inserters: incoming.inserters, belts: incoming.belts });
    expect(screen.getByText('Captured Inserter 1: drops onto a 3 tile belt buffer that side-loads onto another belt. Imported as an ordinary drop: '
        + 'where the other belt is busy, the game has less room than the clock generator assumes.')).toBeDefined();
    await user.click(category('Inserters'));
    expect(screen.queryByText(/3 tile belt buffer/)).toBeNull();
});

it.each([false, true])('shows the current fraction and applies the numeric suggestion only when checked (%s)', async checked => {
    props.currentForm.inserters = [];
    props.currentForm.setpoint = { item: 'iron-gear-wheel', items_per_second: { numerator: 16, denominator: 7 }, copies: 1 };
    props.target = props.currentForm.setpoint;
    incoming.suggested_target = Option.some({ source: 'mod', target: { item: 'iron-gear-wheel', items_per_second: 3.75, copies: 1 } });
    const { user } = Render();
    await paste();
    expect(screen.getByText(/16\/7\/s/)).toBeDefined();
    const field = screen.getByRole<HTMLInputElement>('checkbox', { name: /^Setpoint:/ });
    expect(field.checked).toBe(false);
    if (checked) await user.click(field);
    await user.click(apply());
    expect(vi.mocked(props.onApplyPaste).mock.calls[0][0].setpoint.items_per_second).toEqual(checked ? 3.75 : { numerator: 16, denominator: 7 });
});

describe('Paste acknowledgment bound to the actual preview', () => {
    it('guards Apply until the current mixed preview is deliberately acknowledged, then applies once with one Undo', async () => {
        const { user } = Render();
        await paste(); expect(apply().disabled).toBe(true); tryApply();
        expect(props.onApplyPaste).not.toHaveBeenCalled(); expect(props.onUndoable).not.toHaveBeenCalled();
        await user.click(screen.getByRole('checkbox', { name: ACKNOWLEDGMENT })); expect(apply().disabled).toBe(false); await user.click(apply());
        expect(props.onApplyPaste).toHaveBeenCalledOnce();
        const next = vi.mocked(props.onApplyPaste).mock.calls[0][0];
        expect(next.machines).toEqual(incoming.machines.map(row => ({ ...row, _prototype_source: 'sidecar', _uuid: expect.any(String) })));
        expect(next.inserters).toBe(props.currentForm.inserters);
        expect(props.onUndoable).toHaveBeenCalledExactlyOnceWith('Imported 1 machine from Factorio.');
        expect(props.onBuildReplaced).toHaveBeenCalledOnce();
        expect(vi.mocked(props.onUndoable).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(props.onApplyPaste).mock.invocationCallOrder[0]);
        expect(vi.mocked(props.onApplyPaste).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(props.onBuildReplaced).mock.invocationCallOrder[0]);
    });
    it('commits several selected categories together with one Undo and one result invalidation', async () => {
        incoming.inserters = [{ source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 7 } }];
        incoming.chests = [{ id: 7, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }];
        const { user } = Render();
        await paste();
        expect(apply().disabled).toBe(false);
        await user.click(apply());
        expect(props.onApplyPaste).toHaveBeenCalledOnce();
        const next = vi.mocked(props.onApplyPaste).mock.calls[0][0];
        expect(next.machines[0]).toMatchObject(incoming.machines[0]);
        expect(next.inserters[0]).toMatchObject({ ...incoming.inserters[0], id: 1 });
        expect(next.chests[0]).toMatchObject(incoming.chests[0]);
        expect(next.belts).toBe(props.currentForm.belts);
        expect(props.onUndoable).toHaveBeenCalledExactlyOnceWith('Imported 1 machine, 1 inserter, 1 chest from Factorio.');
        expect(props.onBuildReplaced).toHaveBeenCalledOnce();
    });
    it('resets selection consent even when the player returns to the same selections', async () => {
        const { user } = Render();
        await paste(); await user.click(screen.getByRole('checkbox', { name: ACKNOWLEDGMENT })); expect(apply().disabled).toBe(false);
        await user.click(category('Machines')); expect(apply().disabled).toBe(true);
        expect(screen.queryByRole('checkbox', { name: ACKNOWLEDGMENT })).toBeNull();
        await user.click(category('Machines')); expect(apply().disabled).toBe(true); tryApply();
        expect(props.onApplyPaste).not.toHaveBeenCalled();
    });
    it('invalidates consent immediately on a raw current-form object change, even if that object is later restored', async () => {
        const { user, rerender } = Render();
        await paste(); await user.click(screen.getByRole('checkbox', { name: ACKNOWLEDGMENT })); const original = props.currentForm;
        rerender({ currentForm: { ...original, machines: [...original.machines, { ...original.machines[0], id: 2, _uuid: 'second-machine' }] } });
        expect(apply().disabled).toBe(true); tryApply(); expect(props.onUndoable).not.toHaveBeenCalled();
        rerender({ currentForm: original }); expect(apply().disabled).toBe(true);
    });
    it('a fresh incoming paste cannot use the old incoming consent', async () => {
        const { user } = Render();
        await paste(); await user.click(screen.getByRole('checkbox', { name: ACKNOWLEDGMENT })); expect(apply().disabled).toBe(false);
        await paste(); expect(apply().disabled).toBe(true); tryApply(); expect(props.onUndoable).not.toHaveBeenCalled();
    });
    it('Cancel and no selected work keep the destination and its callbacks untouched', async () => {
        const { user } = Render();
        await paste(); const before = structuredClone(props.currentForm);
        await user.click(category('Machines')); expect(apply().disabled).toBe(true); tryApply();
        await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(props.currentForm).toEqual(before);
        expect(props.onApplyPaste).not.toHaveBeenCalled(); expect(props.onUndoable).not.toHaveBeenCalled(); expect(props.onBuildReplaced).not.toHaveBeenCalled();
    });
});


describe('prospective import assumptions', () => {
    it('summarizes the actual retained/incoming inserters as selections and current drafts change', async () => {
        incoming.inserters = [{ id: 1, prototype: 'fast-inserter', quality: 'normal', stack_size: 4,
            source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 0 } }];
        const { user, rerender } = Render();
        await paste();
        const assumptions = () => within(screen.getByText('Import details').closest('details')!).getAllByText(/^Inserters? /).map(line => line.textContent);
        const retained = props.currentForm.inserters, changed = [{ ...retained[0], stack_size: 16 }];
        const [incomingLines, retainedLines, changedLines] = [incoming.inserters, retained, changed].map(inserters => inserterDetailLines(inserters, id => id));
        expect(new Set([incomingLines, retainedLines, changedLines].map(String)).size).toBe(3);
        expect(assumptions()).toEqual(incomingLines);
        await user.click(category('Inserters'));
        expect(assumptions()).toEqual(retainedLines);
        rerender({ currentForm: { ...props.currentForm, inserters: changed } });
        expect(assumptions()).toEqual(changedLines);
        expect(props.onApplyPaste).not.toHaveBeenCalled();
        expect(props.onUndoable).not.toHaveBeenCalled();
    });
});

describe('the chest row', () => {
    it('names the chests by type, in the order the export lists them, beside the counts', async () => {
        incoming.chests = [{ id: 1, type: 'car' }, { id: 2, type: 'infinity-chest' }, { id: 3, type: 'infinity-chest' }] as PastedEntities['chests'];
        const { user } = Render();
        await paste();
        expect(screen.getByRole('checkbox', { name: 'Chests (3)', description: /1 car and 2 infinity chests\. 0 in your build → 3 after import\./ })).toBeDefined();
        await user.click(category('Chests'));
        expect(screen.getByRole('checkbox', { name: 'Chests (3)', description: /1 car and 2 infinity chests\. Not selected\./ })).toBeDefined();
    });
    it('has no line of types when the export has no chests', async () => {
        Render();
        await paste();
        expect(screen.getByRole('checkbox', { name: 'Chests (0)', description: /None in this export\./ })).toBeDefined();
    });
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

    it.each(['{', '['])('sends a text that opens with %s the Sidecar way', async opening => {
        Render();
        await pasteText(` ${opening === '{' ? JSON.stringify({ machines: incoming.machines }) : '[]'}`);
        await (opening === '{' ? screen.findByRole('checkbox', { name: /^Machines \(/ }) : pastePrompt());
        expect(asked('pasted-entities').length).toBe(opening === '{' ? 1 : 0);
        expect(asked('pasted-blueprint')).toEqual([]);
    });

    it('sends any other text to the import, with the research of No research and no answer', async () => {
        Render();
        await pasteText(`  ${iron}\n`);
        await dialogOpen();
        const query = asked('pasted-blueprint')[0] as Extract<EngineQuery, { kind: 'pasted-blueprint' }>;
        expect(query.text).toBe(iron);
        expect(query.inputs.answers).toEqual({});
        expect(query.inputs.research).toMatchObject({ profile: 'No research', template: 'no-research', bonuses: { mining_drill_productivity_bonus: 0 } });
        expect(asked('pasted-entities')).toEqual([]);
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
        await user.click(await screen.findByRole('option', { name: /All finite research/ }));
        await screen.findByText(/Numbers used: mining \+20 %/);
        expect(asked('pasted-blueprint').length).toBe(before + 1);
        expect(lastBlueprintQuery().inputs.research).toMatchObject({ profile: 'All finite research', template: 'all-finite-research', bonuses: { mining_drill_productivity_bonus: 20 } });
        expect(JSON.parse(window.localStorage.getItem('clock-generator-research-profiles')!).lastUsed).toBe('all-finite-research');
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
        fireEvent.change(input, { target: { files: [new File([JSON.stringify({ setpoint: { item: 'iron-plate', items_per_second: 1, copies: 1 }, machines: [] })], 'build.json')] } });
        await vi.waitFor(() => expect(asked('config-file').length).toBe(1));
        expect(asked('pasted-blueprint')).toEqual([]);
    });
});
