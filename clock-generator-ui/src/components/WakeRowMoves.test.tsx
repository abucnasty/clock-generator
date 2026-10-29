// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { TargetType } from 'clock-generator/light';
import { expect, it } from 'vitest';
import { names, show } from '../test/fixtures';
import { WakeRowMoves } from './WakeRowMoves';

const pictures = (scope: HTMLElement) => within(scope).getAllByRole('presentation', { hidden: true }).map(img => img.getAttribute('src'));

it('identifies both endpoints and their different recipes, even when their machine icons match', () => {
    show(<WakeRowMoves row={{ items: ['nutrients'], route: 'Machine 2 to Machine 4',
        source: { type: TargetType.MACHINE, id: 2, label: 'Machine 2', icon: 'biochamber', sublabel: 'Nutrients from bioflux', ingredientIcons: ['nutrients-from-bioflux'] },
        sink: { type: TargetType.MACHINE, id: 4, label: 'Machine 4', icon: 'biochamber', sublabel: 'Pentapod egg', ingredientIcons: ['pentapod-egg'] },
    }} />);
    const route = screen.getByRole('img', { name: 'Machine 2 · Nutrients from bioflux → Machine 4 · Pentapod egg' });
    // the badges and the recipes' icons are drawn for the eye; the route's name says them
    expect(pictures(route)).toEqual(['/icons/biochamber.png', '/icons/nutrients-from-bioflux.png', '/icons/biochamber.png', '/icons/pentapod-egg.png']);
    expect(within(route).getByText('Machine 2 → Machine 4')).toBeDefined();
});

it('retains the recorded text and moved-item fallback when endpoint metadata is unavailable', () => {
    const { container } = show(<WakeRowMoves row={{ items: ['iron-plate'], route: 'Belt 1 to Machine 2' }} />, { names: names({ 'iron-plate': 'Iron plate' }) });
    expect(screen.getByRole('img', { name: 'Iron plate' }).getAttribute('src')).toBe('/icons/iron-plate.png');
    expect(container.textContent).toBe(': Belt 1 to Machine 2');
});
