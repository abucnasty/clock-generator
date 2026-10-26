import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameNamesContext } from '../hooks/useGameNames';
import type { InserterFormData } from '../hooks/useConfigForm';
import { InserterEditor } from './InserterEditor';

const value: InserterFormData = { id: 2, _uuid: 'inserter-2', source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, filters: ['iron-plate'] };
const common = { value, label: 'Inserter 2', machines: [{ id: 1, _uuid: 'machine-1', recipe: 'iron-gear-wheel', crafting_speed: 1, productivity: 0 }], inserters: [value], belts: [],
    chests: [{ id: 1, _uuid: 'chest-1', type: 'infinity-chest' as const, item_filter: [], remove_unfiltered_items: true }], itemNames: ['iron-plate'], getRecipeInfo: () => null, onChange: () => {} };
const names = { item: {}, recipe: {} };

const render = (layout: 'workbench' | 'stacked') => renderToStaticMarkup(<GameNamesContext.Provider value={names}>
    <InserterEditor {...common} layout={layout} identity={<span>Inserter identity</span>} routeActions={<button>Route actions</button>}
        rowSettings={fields => <section aria-label="General settings">{fields}</section>} />
</GameNamesContext.Provider>);

it('uses workbench route controls and sends only advanced fields to General', () => {
    const html = render('workbench');
    expect(html).toContain('Inserter identity');
    expect(html).toContain('Route actions');
    expect(html).toContain('Source, Inserter 2');
    expect(html).toContain('Destination, Inserter 2');
    expect(html).toContain('aria-label="Inserter filter slots"');
    expect(html).toContain('Stack size');
    const general = html.match(/<section aria-label="General settings">([\s\S]*?)<\/section>/)?.[1] ?? '';
    expect(general).toContain('Stack size');
    expect(general).not.toContain('Source, Inserter 2');
    expect(general).not.toContain('Destination, Inserter 2');
    expect(general).not.toContain('Inserter filter slots');
});

it('preserves the stacked diagram editor with inline endpoints and filter controls', () => {
    const html = render('stacked');
    expect(html).toContain('Source, Inserter 2');
    expect(html).toContain('Destination, Inserter 2');
    expect(html).toContain('aria-label="Inserter filter slots"');
    expect(html).toContain('Explicit · Set by hand');
    expect(html).toContain('Stack size');
});
