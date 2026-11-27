// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { ResearchProfileSelect } from './ResearchProfileSelect';

const entries = [
    { id: 'no-research', name: 'No research', isTemplate: true },
    { id: 'all-finite-research', name: 'All finite research', isTemplate: true },
    { id: 'mine', name: 'My megabase', isTemplate: false },
];

it('lists the templates and the profiles, marks the templates, and says which it chose', async () => {
    const onChange = vi.fn();
    const { user } = show(<ResearchProfileSelect entries={entries} value="mine" onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'Profile' });
    expect(box.textContent).toContain('My megabase');
    await user.click(box);
    const options = screen.getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual([
        expect.stringContaining('No research'), expect.stringContaining('All finite research'), 'My megabase',
    ]);
    expect(options[0].textContent).toContain('Template');
    expect(options[2].textContent).not.toContain('Template');
    await user.click(options[1]);
    expect(onChange).toHaveBeenCalledWith('all-finite-research');
});

it('takes the label it is given', () => {
    show(<ResearchProfileSelect entries={entries} value="mine" onChange={vi.fn()} label="Research" />);
    expect(screen.getByRole('combobox', { name: 'Research' })).toBeDefined();
});
