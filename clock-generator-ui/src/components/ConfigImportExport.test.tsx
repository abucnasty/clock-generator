// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Option } from 'clock-generator/light';
import { ConfigImportExport, type BuildEntryHandle } from './ConfigImportExport';
import { createDefaultConfig } from '../utils/configForm/formData';
import { inserterDetailLines } from '../utils/pasteText';
import type { PastedEntities } from '../worker/types';

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
        drills: [], inserters: [], belts: [], chests: [], guidance: Option.none(), suggested_target: Option.none() };
    validate.mockResolvedValue(incoming);
    props = { ref: entry, config: null, currentForm, target: currentForm.target_output, onImport: vi.fn(), onApplyPaste: vi.fn(), onReset: vi.fn(), onBuildReplaced: vi.fn(), onUndoable: vi.fn(), onShowIntro: vi.fn(),
        pasteIsNextStep: false, buildName: null, buildTitle: 'Test build' };
});

it('shows capture diagnostics alongside prospective pickup coverage, only while importing those inserters', async () => {
    incoming.inserters = [{ source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 } }];
    incoming.belts = [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'iron-plate', stack_size: 4 }] }];
    const { user } = Render();
    await paste({ machines: incoming.machines, inserters: incoming.inserters, belts: incoming.belts, pickup_warnings: [{ inserter_id: 1, reason: 'bend' }] });
    expect(screen.getByText(/^Moving input belts/)).toBeDefined();
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
