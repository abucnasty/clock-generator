import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { Button, FormControlLabel } from '@mui/material';
import { Option } from 'clock-generator/light';
import { InserterAssumptions } from './InserterAssumptions';
import { ConfigImportExport, type BuildEntryHandle } from './ConfigImportExport';
import { createDefaultConfig } from '../utils/configForm/formData';
import type { PastedEntities } from '../worker/types';

const runner = vi.hoisted(() => {
    let states: unknown[] = [], refs: { current: unknown }[] = [], si = 0, ri = 0;
    return {
        notify: vi.fn(), dismiss: vi.fn(), validate: vi.fn(),
        reset() { states = []; refs = []; }, begin() { si = ri = 0; },
        react: {
            useState(initial: unknown) {
                const i = si++;
                if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
                return [states[i], (value: unknown) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
            },
            useRef(value: unknown) { return refs[ri++] ??= { current: value }; },
            useCallback: (fn: unknown) => fn,
            useImperativeHandle(ref: { current: unknown }, create: () => unknown) { ref.current = create(); },
        },
    };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...runner.react }));
vi.mock('@mui/material', async original => ({ ...await original<typeof import('@mui/material')>(), useMediaQuery: () => false,
    useTheme: () => ({ breakpoints: { down: () => '' } }) }));
vi.mock('../hooks/useMessages', () => ({ useNotify: () => runner.notify, useDismissMessage: () => runner.dismiss }));
vi.mock('../hooks/useGameNames', () => ({ useGameNames: () => ({ recipeLabel: (id: string) => id }) }));
vi.mock('../worker/engineClient', () => ({ askEngine: (request: unknown) => runner.validate(request) }));

type Props = Parameters<typeof ConfigImportExport>[0];
type ElementProps = Record<string, unknown> & { children?: ReactNode; control?: ReactNode };
function elements(node: ReactNode): { type: unknown; props: ElementProps }[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement<ElementProps>(node)) return [];
    return [{ type: node.type, props: node.props }, ...elements(node.props.children), ...elements(node.props.control)];
}
let props: Props, incoming: PastedEntities, entry: { current: BuildEntryHandle | null };
const Render = () => { runner.begin(); return elements(ConfigImportExport(props)); };
const apply = () => Render().find(e => e.type === Button && e.props.children === 'Import Selected')!.props;
const acknowledgment = () => Render().find(e => e.type === FormControlLabel && e.props.label === 'I understand these parts will be combined using their entity numbers.')?.props;
function acknowledge() {
    const label = acknowledgment()!;
    const checkbox = elements(label.control)[0].props;
    (checkbox.onChange as (event: unknown, checked: boolean) => void)({}, true);
}
function toggleMachines() {
    const label = Render().find(e => e.type === FormControlLabel && e.props.label === 'Machines (1)')!;
    (elements(label.props.control)[0].props.onChange as () => void)();
}
const clickApply = () => (apply().onClick as () => void)();
async function paste() {
    Render(); entry.current!.pasteFromFactorio();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    Render();
}
beforeEach(() => {
    runner.reset(); vi.clearAllMocks(); entry = { current: null };
    const currentForm = createDefaultConfig();
    currentForm.inserters = [{ id: 1, _uuid: 'existing-inserter', source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 0 } }];
    incoming = { machines: [{ id: 1, recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0, type: 'machine' }],
        drills: [], inserters: [], belts: [], chests: [], guidance: Option.none(), suggested_target: Option.none() };
    runner.validate.mockResolvedValue(incoming);
    vi.stubGlobal('document', { activeElement: null });
    vi.stubGlobal('navigator', { clipboard: { readText: async () => JSON.stringify({ sidecar_version: '0.7.1', machines: incoming.machines, inserters: [], belts: [], chests: [], drills: { configs: [], mining_productivity_level: 0 } }) } });
    props = { ref: entry, config: null, currentForm, target: currentForm.target_output, onImport: vi.fn(), onReplaceTarget: vi.fn(),
        onReplaceMachines: vi.fn(), onReplaceDrills: vi.fn(), onReplaceInserters: vi.fn(), onReplaceBelts: vi.fn(), onReplaceChests: vi.fn(),
        onUpdateMiningProductivityLevel: vi.fn(), onReset: vi.fn(), onBuildReplaced: vi.fn(), onUndoable: vi.fn(), onShowIntro: vi.fn(),
        pasteIsNextStep: false, buildName: null, buildTitle: 'Test build' };
});
afterEach(() => vi.unstubAllGlobals());

describe('Paste acknowledgment bound to the actual preview', () => {
    it('guards Apply until the current mixed preview is deliberately acknowledged, then applies once with one Undo', async () => {
        await paste(); expect(apply().disabled).toBe(true); clickApply();
        expect(props.onReplaceMachines).not.toHaveBeenCalled(); expect(props.onUndoable).not.toHaveBeenCalled();
        acknowledge(); expect(apply().disabled).toBe(false); clickApply();
        expect(props.onReplaceMachines).toHaveBeenCalledExactlyOnceWith(incoming.machines);
        expect(props.onReplaceInserters).not.toHaveBeenCalled(); expect(props.onUndoable).toHaveBeenCalledOnce();
        expect(props.onBuildReplaced).toHaveBeenCalledOnce();
    });
    it('resets selection consent even when the player returns to the same selections', async () => {
        await paste(); acknowledge(); expect(apply().disabled).toBe(false);
        toggleMachines(); expect(apply().disabled).toBe(true); expect(acknowledgment()).toBeUndefined();
        toggleMachines(); expect(apply().disabled).toBe(true); clickApply();
        expect(props.onReplaceMachines).not.toHaveBeenCalled();
    });
    it('invalidates consent immediately on a raw current-form object change, even if that object is later restored', async () => {
        await paste(); acknowledge(); const original = props.currentForm;
        props = { ...props, currentForm: { ...original, machines: [...original.machines, { ...original.machines[0], id: 2, _uuid: 'second-machine' }] } };
        expect(apply().disabled).toBe(true); clickApply(); expect(props.onUndoable).not.toHaveBeenCalled();
        props = { ...props, currentForm: original }; expect(apply().disabled).toBe(true);
    });
    it('a fresh incoming paste cannot use the old incoming consent', async () => {
        await paste(); acknowledge(); expect(apply().disabled).toBe(false);
        await paste(); expect(apply().disabled).toBe(true); clickApply(); expect(props.onUndoable).not.toHaveBeenCalled();
    });
    it('Cancel and no selected work keep the destination and its callbacks untouched', async () => {
        await paste(); const before = structuredClone(props.currentForm); toggleMachines(); expect(apply().disabled).toBe(true); clickApply();
        const cancel = Render().find(e => e.type === Button && e.props.children === 'Cancel')!.props;
        (cancel.onClick as () => void)(); Render(); expect(props.currentForm).toEqual(before);
        expect(props.onReplaceMachines).not.toHaveBeenCalled(); expect(props.onUndoable).not.toHaveBeenCalled(); expect(props.onBuildReplaced).not.toHaveBeenCalled();
    });
});


describe('prospective import assumptions', () => {
    it('summarizes the actual retained/incoming inserters as selections and current drafts change', async () => {
        incoming.inserters = [{ id: 1, prototype: 'fast-inserter', quality: 'normal', stack_size: 4,
            source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 0 } }];
        await paste();
        const assumptions = () => Render().find(element => element.type === InserterAssumptions)!.props.inserters;
        expect(assumptions()).toBe(incoming.inserters);
        const label = Render().find(element => element.type === FormControlLabel && element.props.label === 'Inserters (1)')!;
        (elements(label.props.control)[0].props.onChange as () => void)();
        expect(assumptions()).toBe(props.currentForm.inserters);
        const changed = [{ ...props.currentForm.inserters[0], stack_size: 16 }];
        props = { ...props, currentForm: { ...props.currentForm, inserters: changed } };
        expect(assumptions()).toBe(changed);
        expect(props.onReplaceInserters).not.toHaveBeenCalled();
        expect(props.onUndoable).not.toHaveBeenCalled();
    });
});
