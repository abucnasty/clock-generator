// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { infinityChest, inserter, machine, names, show } from '../test/fixtures';
import { InserterEditor } from './InserterEditor';

const value = inserter(2, { filters: ['iron-plate'] });
const showEditor = (layout: 'workbench' | 'stacked') => show(<InserterEditor value={value} label="Inserter 2" layout={layout}
    machines={[machine()]} inserters={[value]} belts={[]} chests={[infinityChest()]} itemNames={['iron-plate']} getRecipeInfo={() => null}
    onChange={vi.fn()} identity={<span>Inserter identity</span>} routeActions={<button>Route actions</button>}
    rowSettings={fields => <section aria-label="General settings">{fields}</section>} />, { names: names() });
// the route: where it picks up, where it drops, and what it moves
const ROUTE = [['combobox', 'Source, Inserter 2'], ['combobox', 'Destination, Inserter 2'], ['group', 'Inserter filter slots']] as const;

it('uses workbench route controls and sends only advanced fields to General', () => {
    showEditor('workbench');
    expect(screen.getByText('Inserter identity')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Route actions' })).toBeDefined();
    for (const [role, name] of ROUTE) expect(screen.getByRole(role, { name })).toBeDefined();
    const general = within(screen.getByRole('region', { name: 'General settings' }));
    expect(general.getByRole('textbox', { name: 'Stack size' })).toBeDefined();
    for (const [role, name] of ROUTE) expect(general.queryByRole(role, { name })).toBeNull();
});

it('preserves the stacked diagram editor with inline endpoints and filter controls', () => {
    showEditor('stacked');
    expect(screen.queryByRole('region', { name: 'General settings' })).toBeNull();
    for (const [role, name] of ROUTE) expect(screen.getByRole(role, { name })).toBeDefined();
    expect(screen.getByText('Explicit · Set by hand')).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Stack size' })).toBeDefined();
});
