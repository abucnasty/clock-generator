import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TargetType } from 'clock-generator/light';
import { WakeRowMoves } from './WakeRowMoves';

it('identifies both endpoints and their different recipes, even when their machine icons match', () => {
    const html = renderToStaticMarkup(<WakeRowMoves row={{ items: ['nutrients'], route: 'Machine 2 to Machine 4',
        source: { type: TargetType.MACHINE, id: 2, label: 'Machine 2', icon: 'biochamber', sublabel: 'Nutrients from bioflux', ingredientIcons: ['nutrients-from-bioflux'] },
        sink: { type: TargetType.MACHINE, id: 4, label: 'Machine 4', icon: 'biochamber', sublabel: 'Pentapod egg', ingredientIcons: ['pentapod-egg'] },
    }} />);
    expect(html).toContain('aria-label="Machine 2 · Nutrients from bioflux → Machine 4 · Pentapod egg"');
    expect(html).toContain('/icons/nutrients-from-bioflux.png');
    expect(html).toContain('/icons/pentapod-egg.png');
    expect(html).toContain('Machine 2 → Machine 4');
});

it('retains the recorded text and moved-item fallback when endpoint metadata is unavailable', () => {
    const html = renderToStaticMarkup(<WakeRowMoves row={{ items: ['iron-plate'], route: 'Belt 1 to Machine 2' }} />);
    expect(html).toContain('Belt 1 to Machine 2');
    expect(html).toContain('/icons/iron-plate.png');
});
