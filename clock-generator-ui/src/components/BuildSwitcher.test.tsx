// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { REFUSED_BUILD_LABELS } from '../utils/buildLibrary';
import { BuildSwitcher } from './BuildSwitcher';

const builds = [
    { id: 'a', title: 'Utility science 320', secondary: null },
    { id: 'b', title: 'Plastic 90', secondary: null, refused: { problem: 'old' as const, text: '{"setpoint":{}}' } },
];

function open(props: Partial<Parameters<typeof BuildSwitcher>[0]> = {}) {
    const handlers = { onOpen: vi.fn(), onNew: vi.fn(), onDuplicate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(),
        onDownloadRefused: vi.fn(), onRemoveRefused: vi.fn() };
    const shown = show(<BuildSwitcher builds={builds} currentId="a" currentTitle="Utility science 320" {...handlers} {...props} />);
    return { ...shown, ...handlers };
}

describe('Your configurations with a build that is no longer supported', () => {
    it('lists it as no longer supported, with Download and Remove and no way to open it', async () => {
        const { user } = open();
        await user.click(screen.getByRole('button', { name: 'Build: Utility science 320' }));
        const menu = screen.getByRole('menu');
        expect(menu.textContent).toContain('Plastic 90');
        expect(menu.textContent).toContain(REFUSED_BUILD_LABELS.old);
        expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['Utility science 320']);
        expect(screen.getByRole('menuitem', { name: 'Download Plastic 90' })).toBeDefined();
        expect(screen.getByRole('menuitem', { name: 'Remove Plastic 90' })).toBeDefined();
    });

    it('downloads and removes it by its id', async () => {
        const { user, onDownloadRefused, onRemoveRefused, onOpen } = open();
        await user.click(screen.getByRole('button', { name: 'Build: Utility science 320' }));
        await user.click(screen.getByRole('menuitem', { name: 'Download Plastic 90' }));
        expect(onDownloadRefused).toHaveBeenCalledWith('b');
        await user.click(screen.getByRole('button', { name: 'Build: Utility science 320' }));
        await user.click(screen.getByRole('menuitem', { name: 'Remove Plastic 90' }));
        expect(onRemoveRefused).toHaveBeenCalledWith('b');
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('keeps Download but not Remove when the list is read only', async () => {
        const { user } = open({ readOnly: true });
        await user.click(screen.getByRole('button', { name: 'Build: Utility science 320' }));
        expect(screen.getByRole('menuitem', { name: 'Download Plastic 90' }).getAttribute('aria-disabled')).not.toBe('true');
        expect(screen.getByRole('menuitem', { name: 'Remove Plastic 90' }).getAttribute('aria-disabled')).toBe('true');
    });
});
