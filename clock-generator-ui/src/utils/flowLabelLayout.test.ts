import { expect, it } from 'vitest';
import { outputLabelLayout, machineDetailLayout } from './flowLabelLayout';

const names = ['Advanced circuit', 'Battery', 'Concrete', 'Copper cable', 'Holmium ore', 'Ice', 'Iron gear wheel',
    'Low density structure', 'Processing unit', 'Solid fuel', 'Steel plate', 'Stone'];

it('keeps every localized direct-output row visible and sizes the card without an inner scroller', () => {
    const card = outputLabelLayout(names.map(name => ({ name, label: name })));
    expect(card).toMatchObject({ width: 360, columns: 2 });
    expect(card.rowHeights).toHaveLength(6);
    expect(card.height).toBeGreaterThan(160);
    expect(card.rowHeights.every(height => height >= 24)).toBe(true);
    expect(outputLabelLayout([{ name: 'x', label: 'Localized result name that wraps across multiple lines' }]).rowHeights[0]).toBeGreaterThan(24);
});

it('gives multi-output details room while keeping an ordinary machine compact', () => {
    expect(machineDetailLayout(['Scrap'], 5)).toEqual({ width: 200, height: 196 });
    const multi = machineDetailLayout(names, 5);
    expect(multi.width).toBe(340);
    expect(multi.height).toBeGreaterThan(196);
    expect(machineDetailLayout(['Scrap'], 5).height).toBe(196);
});
