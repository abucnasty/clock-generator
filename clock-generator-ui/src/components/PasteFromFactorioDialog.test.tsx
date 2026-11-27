// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { BLUEPRINT_COPY_STEPS } from '../utils/blueprintPaste';
import { SIDECAR_COPY_STEPS } from '../utils/sidecarGuide';
import { PasteFromFactorioDialog } from './PasteFromFactorioDialog';

describe('the Paste from Factorio guide', () => {
    it('says first how to copy a blueprint, then how to copy a build with the mod', () => {
        show(<PasteFromFactorioDialog prompt={null} promptId={0} onSubmit={vi.fn()} onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog');
        const text = dialog.textContent ?? '';
        for (const step of [...BLUEPRINT_COPY_STEPS, ...SIDECAR_COPY_STEPS]) expect(text).toContain(step);
        expect(text.indexOf(BLUEPRINT_COPY_STEPS[0])).toBeLessThan(text.indexOf(SIDECAR_COPY_STEPS[0]));
        expect(screen.getByRole('link', { name: /Clock Generator Sidecar mod/ })).toBeDefined();
    });

    it('sends a blueprint pasted into its box at once', async () => {
        const onSubmit = vi.fn();
        const { user } = show(<PasteFromFactorioDialog prompt={null} promptId={0} onSubmit={onSubmit} onClose={vi.fn()} />);
        await user.click(screen.getByRole('textbox'));
        await user.paste('0eNqblueprint');
        expect(onSubmit).toHaveBeenCalledWith('0eNqblueprint');
    });
});
