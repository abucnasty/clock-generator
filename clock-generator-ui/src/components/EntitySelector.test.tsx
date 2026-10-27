import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EntitySelector } from './EntitySelector';
import type { EntitySelectorOption } from '../utils/entitySelector';

const options: EntitySelectorOption[] = [
    { type: 'machine', id: 1, label: 'Machine 1', sublabel: 'Advanced circuit', icon: 'assembling-machine-3', ingredientIcons: ['advanced-circuit'] },
    { type: 'inserter', id: 1, label: 'Inserter 1', icon: 'stack-inserter' },
];
it('shows the same selected badge and recipe identity for every caller, without a type-filter control', () => {
    const html = renderToStaticMarkup(<EntitySelector options={options} value={options[0]} onChange={() => {}} label="Inspect entity" rowFirst />);
    expect(html).toContain('/icons/assembling-machine-3.png');
    expect(html).toContain('/icons/advanced-circuit.png');
    expect(html).toContain('value="Machine 1 - Advanced circuit"');
    expect(html).not.toContain('by entity type');
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).toContain('data-row-first=""');
});
it('keeps fixed imported routes read-only, with no extra actions', () => {
    const html = renderToStaticMarkup(<EntitySelector options={options} value={options[0]} onChange={() => {}} label="Source" readOnly />);
    expect(html).toContain('readOnly');
    expect(html).not.toContain('aria-label="Filter Source by entity type"');
});

it('uses a short selected chest name and item icons while retaining its complete accessible description', () => {
    const chest: EntitySelectorOption = { type: 'chest', id: 3, label: 'Chest 3', icon: 'infinity-chest',
        sublabel: 'Processing unit, Holmium plate, Superconductor, Battery',
        ingredientIcons: ['processing-unit', 'holmium-plate', 'superconductor', 'battery'] };
    const html = renderToStaticMarkup(<EntitySelector options={[chest]} value={chest} onChange={() => {}} label="Source" compactValue />);
    expect(html).toContain('value="Chest 3"');
    expect(html).toContain('aria-description="Chest 3 - Processing unit, Holmium plate, Superconductor, Battery"');
    for (const item of chest.ingredientIcons!) expect(html).toContain(`/icons/${item}.png`);
});
