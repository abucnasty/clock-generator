import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EntitySelector } from './EntitySelector';
import type { EntitySelectorOption } from '../utils/entitySelector';

const options: EntitySelectorOption[] = [
    { type: 'machine', id: 1, label: 'Machine 1', sublabel: 'Advanced circuit', icon: 'assembling-machine-3', ingredientIcons: ['advanced-circuit'] },
    { type: 'inserter', id: 1, label: 'Inserter 1', icon: 'stack-inserter' },
];
it('shows the same selected badge and recipe identity for every caller, with an accessible type filter', () => {
    const html = renderToStaticMarkup(<EntitySelector options={options} value={options[0]} onChange={() => {}} label="Inspect entity" rowFirst />);
    expect(html).toContain('/icons/assembling-machine-3.png');
    expect(html).toContain('/icons/advanced-circuit.png');
    expect(html).toContain('value="Machine 1 - Advanced circuit"');
    expect(html).toContain('aria-label="Filter Inspect entity by entity type"');
    expect(html).toContain('data-row-first=""');
});
it('keeps fixed imported routes read-only, including the type-filter action', () => {
    const html = renderToStaticMarkup(<EntitySelector options={options} value={options[0]} onChange={() => {}} label="Source" readOnly />);
    expect(html).toContain('readOnly');
    expect(html).not.toContain('aria-label="Filter Source by entity type"');
});
