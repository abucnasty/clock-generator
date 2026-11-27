// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { RefusedConfigDialog } from './RefusedConfigDialog';

describe('the message for a configuration the site does not read', () => {
    it('says an old one is no longer supported and how to make it again', () => {
        show(<RefusedConfigDialog kind="old" onPaste={vi.fn()} onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'This configuration is no longer supported' });
        expect(dialog.textContent).toContain('made by a version of the clock generator before 0.33.0');
        expect(dialog.textContent).toContain('copy your build as a blueprint in Factorio and paste it here');
        expect(screen.getByRole('button', { name: 'Paste a blueprint' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
    });

    it('says a newer one was made by a newer version of the site', () => {
        show(<RefusedConfigDialog kind="newer" onPaste={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByRole('dialog', { name: 'This configuration was made by a newer version of the site' }).textContent).toContain('Reload the page');
    });

    it('closes and starts the paste on Paste a blueprint, and only closes on Close', async () => {
        const onPaste = vi.fn(), onClose = vi.fn();
        const { user } = show(<RefusedConfigDialog kind="old" onPaste={onPaste} onClose={onClose} />);
        await user.click(screen.getByRole('button', { name: 'Paste a blueprint' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onPaste).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(2);
        expect(onPaste).toHaveBeenCalledTimes(1);
    });

    it('shows nothing when no configuration was refused', () => {
        show(<RefusedConfigDialog kind={null} onPaste={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
