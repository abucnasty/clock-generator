// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { SerializableMachineFacts } from 'clock-generator/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../utils/configForm/formData';
import { EntityEditDialog } from './EntityEditDialog';

// the facts of the machine as it was saved, while those of the draft are on their way
const facts = vi.hoisted(() => ({ error: null, updating: true, facts: {
    recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0, type: 'assembling-machine', output_item: 'stale-fact',
    output_per_craft: 1, output_rate_per_second: 1, output_block_size: 1, overload_multiplier: 1,
    ticks_per_craft: 60, ticks_per_bonus_craft: 60, insertion_duration_ticks: 1, inputs: [],
    outputs: [{ item_name: 'stale-fact', amount_per_craft: 1, rate_per_second: 1, rate_ratio: { numerator: 1, denominator: 1 }, output_block_size: 1, stochastic: false }],
} as SerializableMachineFacts }));
vi.mock('../hooks/useMachineFacts', () => ({ useMachineFacts: () => facts }));

type Props = Parameters<typeof EntityEditDialog>[0];
let props: Props;
function Render(overrides: Partial<Props> = {}) {
    props = { ...props, ...overrides };
    const view = render(<EntityEditDialog {...props} />);
    const rerender = (next: Partial<Props>) => { props = { ...props, ...next }; view.rerender(<EntityEditDialog {...props} />); };
    // the parent closes the editor, and its fade-out ends with the exit callback
    const close = async () => {
        rerender({ open: false });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Machine 1', hidden: true })).toBeNull());
    };
    return { user: userEvent.setup(), rerender, close, unmount: view.unmount };
}
const discardPrompt = () => screen.queryByRole('dialog', { name: /^Discard changes/, hidden: true });
async function dirtyMachineDraft(user: UserEvent) {
    const speed = screen.getByRole('textbox', { name: 'Crafting Speed' });
    await user.clear(speed);
    await user.type(speed, '2');
}
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
};
const actions = [
    ['Edit Inserter 7', 'onEditInserter', [7]],
    ['Fix output route', 'onFixOutput', [1, 'missing-product']],
] as const;

beforeEach(() => {
    frames.clear();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => { frames.delete(frame); }));
    const config = createDefaultConfig();
    const machine = { ...config.machines[0], recipe: 'iron-gear-wheel', prototype: 'assembling-machine-1' };
    props = {
        open: true, onClose: vi.fn(), entityType: 'machine', entityId: 1, machines: [machine], inserters: [], belts: [], chests: [],
        recipeNames: ['iron-gear-wheel'], itemNames: [], getRecipeInfo: () => ({ ingredients: [], results: ['current-fallback'] }),
        onPatchMachine: vi.fn(), onUpdateInserter: vi.fn(), onUpdateBelt: vi.fn(), onUpdateChest: vi.fn(), onSwitchChestType: vi.fn(),
        outputTransfers: [{ source: { type: 'machine', id: 1 }, physical_target: { type: 'chest', id: 1 }, mechanism: 'result-placement', status: 'known', results: [
            { item_name: 'iron-gear-wheel', direct: 'accepted', inserters: [{ inserter_id: 7, target: { type: 'chest', id: 1 } }], coverage: 'covered' },
            { item_name: 'missing-product', direct: 'rejected', inserters: [], coverage: 'missing' },
        ] }],
        onFixOutput: vi.fn(), onEditInserter: vi.fn(),
    } as Props;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('EntityEditDialog route actions', () => {
    it.each(actions)('runs a clean %s action after the exit commit completes', async (name, callback, args) => {
        const { user, close } = Render();
        await user.click(screen.getByRole('button', { name }));
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(props.onEditInserter).not.toHaveBeenCalled();
        expect(props.onFixOutput).not.toHaveBeenCalled();

        await close();
        expect(props.onEditInserter).not.toHaveBeenCalled();
        expect(props.onFixOutput).not.toHaveBeenCalled();
        flushFrames();
        expect(props[callback]).toHaveBeenCalledExactlyOnceWith(...args);
        expect(props[callback === 'onFixOutput' ? 'onEditInserter' : 'onFixOutput']).not.toHaveBeenCalled();
    });

    it.each(actions)('ignores %s after the parent has started closing the editor', async name => {
        const { user, rerender, close } = Render();
        await dirtyMachineDraft(user);
        // the field commits its draft as it loses the focus, before the parent closes the editor
        act(() => (document.activeElement as HTMLElement).blur());
        rerender({ open: false });
        // at once, inside the fade-out
        fireEvent.click(screen.getByRole('button', { name, hidden: true }));

        expect(discardPrompt()).toBeNull();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(props.onEditInserter).not.toHaveBeenCalled();
        expect(props.onFixOutput).not.toHaveBeenCalled();

        await close();
        expect(frames.size).toBe(0);
        flushFrames();
        expect(props.onEditInserter).not.toHaveBeenCalled();
        expect(props.onFixOutput).not.toHaveBeenCalled();
    });

    it('cancels a pending route action when the dialog starts opening again', async () => {
        const { user, rerender, close } = Render();
        await user.click(screen.getByRole('button', { name: 'Fix output route' }));
        // reopened before the fade-out ends
        rerender({ open: false });
        rerender({ open: true });
        await close();
        flushFrames();
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(props.onFixOutput).not.toHaveBeenCalled();
    });

    it.each(['reopen', 'unmount'])('cancels a route already scheduled by the exit callback on %s', async reason => {
        const { user, rerender, close, unmount } = Render();
        await user.click(screen.getByRole('button', { name: 'Fix output route' }));
        await close();
        expect(frames.size).toBe(1);
        if (reason === 'reopen') rerender({ open: true });
        else unmount();
        expect(frames.size).toBe(0);
        flushFrames();
        expect(props.onFixOutput).not.toHaveBeenCalled();
    });

    it('waits for Discard before routing a dirty draft, and drops the action when Keep editing is chosen', async () => {
        const { user, close } = Render();
        await dirtyMachineDraft(user);
        await user.click(screen.getByRole('button', { name: 'Edit Inserter 7' }));
        const prompt = screen.getByRole('dialog', { name: /^Discard changes/ });
        expect(props.onClose).not.toHaveBeenCalled();
        expect(props.onEditInserter).not.toHaveBeenCalled();

        await user.click(within(prompt).getByRole('button', { name: 'Keep editing' }));
        await waitFor(() => expect(discardPrompt()).toBeNull());
        await user.click(screen.getByRole('button', { name: 'Close dialog' }));
        await user.click(within(screen.getByRole('dialog', { name: /^Discard changes/ })).getByRole('button', { name: 'Discard' }));
        expect(props.onClose).toHaveBeenCalledOnce();

        await close();
        flushFrames();
        expect(props.onEditInserter).not.toHaveBeenCalled();
    });

    it('routes a dirty draft once after Discard and the parent close transition', async () => {
        const { user, close } = Render();
        await dirtyMachineDraft(user);
        await user.click(screen.getByRole('button', { name: 'Fix output route' }));
        await user.click(within(screen.getByRole('dialog', { name: /^Discard changes/ })).getByRole('button', { name: 'Discard' }));
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(props.onFixOutput).not.toHaveBeenCalled();

        await close();
        expect(props.onFixOutput).not.toHaveBeenCalled();
        flushFrames();
        expect(props.onFixOutput).toHaveBeenCalledExactlyOnceWith(1, 'missing-product');
    });

    it('withholds stale machine facts while updating and shows the recipe fallback items', () => {
        Render({ outputTransfers: null });
        expect(screen.getByRole('group', { name: 'current-fallback' })).toBeDefined();
        expect(screen.queryByRole('group', { name: 'stale-fact' })).toBeNull();
    });
});
