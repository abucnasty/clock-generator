// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REFUSED_CONFIG_ERRORS } from '../worker/types';
import { encodeShareLink } from '../utils/shareLink';
import { useSharedBuildLink } from './useSharedBuildLink';

const { ask, notify } = vi.hoisted(() => ({ ask: vi.fn(), notify: vi.fn() }));
vi.mock('../worker/engineClient', () => ({ askEngine: ask }));
vi.mock('./useMessages', () => ({ useNotify: () => notify }));

const build = { setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 }, machines: [], inserters: [], belts: [] };

async function openWith(link: string) {
    window.history.replaceState(null, '', `/${link.slice(link.indexOf('#'))}`);
    return renderHook(() => useSharedBuildLink(true));
}

beforeEach(() => {
    ask.mockReset(); notify.mockReset();
    window.history.replaceState(null, '', '/');
});

describe('a share link', () => {
    it('of this format is offered to open', async () => {
        ask.mockImplementation(async (query: { config: unknown }) => query.config);
        const { result } = await openWith(await encodeShareLink({ name: 'Gears', config: build as never }, 'https://example.test/'));
        await waitFor(() => expect(result.current.pending).not.toBeNull());
        expect(result.current.refused).toBeNull();
        expect(ask.mock.calls[0][0].config.format).toBe(1);
    });

    it.each(['old', 'newer'] as const)('whose build the door refuses (%s) is handed to the page in place of the build, with no toast', async problem => {
        ask.mockRejectedValue(new Error(REFUSED_CONFIG_ERRORS[problem]));
        const { result } = await openWith(await encodeShareLink({ name: 'Gears', config: build as never }, 'https://example.test/'));
        await waitFor(() => expect(result.current.refused).toBe(problem));
        expect(result.current.pending).toBeNull();
        expect(notify).not.toHaveBeenCalled();
        act(() => result.current.closeRefused());
        await waitFor(() => expect(result.current.refused).toBeNull());
    });

    it('that fails for another reason still says so in a message', async () => {
        ask.mockRejectedValue(new Error('Invalid machine at index 0'));
        await openWith(await encodeShareLink({ name: 'Gears', config: build as never }, 'https://example.test/'));
        await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    });
});
