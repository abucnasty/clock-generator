import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameNamesContext } from '../hooks/useGameNames';
import type { InserterFormData } from '../utils/configForm/formData';
import type { EntityOption } from '../utils/inserterOptions';
import { InserterRoutePreview } from './InserterRoutePreview';

const names = { item: { iron: 'Fer', copper: 'Cuivre', steel: 'Acier', 'no-item': 'Aucun objet' }, recipe: {} };
const options: EntityOption[] = [
    { type: 'belt', id: 2, label: 'Tapis 2', icon: 'transport-belt', sublabel: 'Fer, Cuivre', ingredientIcons: ['iron', 'copper'] },
    { type: 'chest', id: 4, label: 'Coffre 4', icon: 'steel-chest', sublabel: 'Acier', ingredientIcons: ['steel'] },
];
const value = (overrides: Partial<InserterFormData> = {}) => ({
    id: 3, _uuid: 'inserter-uuid', source: { type: 'belt', id: 2 }, sink: { type: 'chest', id: 4 }, filters: ['iron'],
    ...overrides,
} as unknown as InserterFormData);
const render = (props: { value?: InserterFormData; options?: EntityOption[]; filterItems?: readonly string[] } = {}) => renderToStaticMarkup(<GameNamesContext.Provider value={names}>
    <InserterRoutePreview value={props.value ?? value()} options={props.options ?? options} filterItems={props.filterItems ?? ['iron']} identity={<span>Inserter badge</span>} />
</GameNamesContext.Provider>);

it('shows localized source to inserter/items to destination with explicit filters and no editable controls', () => {
    const html = render({ filterItems: ['iron', 'copper', 'steel', 'iron', 'copper', 'steel'] });
    expect(html).toContain('Source: Tapis 2 - Fer, Cuivre');
    expect(html).toContain('Destination: Coffre 4 - Acier');
    expect(html).toContain('Fer');
    expect(html).toContain('Explicit filters');
    expect(html).toContain('+1');
    expect(html).toContain('Inserter badge');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
});

it('labels automatic filters and renders no inferred items without creating empty slots', () => {
    const html = render({ value: value({ filters: undefined }), filterItems: [] });
    expect(html).toContain('Auto');
    expect(html).toContain('No items inferred');
    expect(html).not.toContain('Aucun objet');
    expect(html).not.toContain('aria-label="Items: "');
});

it('labels blacklist icons as excluded and unsupported', () => {
    const html = render({ value: value({ filter_mode: 'blacklist' }), filterItems: ['iron'] });
    expect(html).toContain('Blacklist · Excluded');
    expect(html).toContain('Excluded items: Fer');
    expect(html).toContain('Blacklist · Not supported');
    expect(html).toContain('/icons/iron.png');
});

it('keeps an explicit no-item filter visible as no items rather than automatic inference', () => {
    const html = render({ value: value({ filters: ['no-item'] }), filterItems: ['no-item'] });
    expect(html).toContain('No items');
    expect(html).toContain('Explicit filters');
    expect(html).not.toContain('No items inferred');
});

it('keeps missing endpoints visible with the configured identifier and unavailable state', () => {
    const html = render({ value: value({ source: { type: 'belt', id: 99 } }), options: [] });
    expect(html).toContain('Belt 99 · unavailable');
    expect(html).toContain('Source: Belt 99 · endpoint unavailable');
});
