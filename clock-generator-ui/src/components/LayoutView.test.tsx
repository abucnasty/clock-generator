// @vitest-environment happy-dom
import { within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FactorioDataService, regionOrbitsOfConfig, type Config, type FoundOrbit } from 'clock-generator/browser';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { build, inserter, machine, show } from '../test/fixtures';
import { configToFormData } from '../utils/configForm/configMapping';
import { duplicateEntity } from '../utils/configForm/edits';
import type { ConfigFormData } from '../utils/configForm/formData';
import { selectBuildEntity } from '../utils/buildViewContext';
import { beltColour, regionColour } from '../utils/layoutColours';
import { LayoutView } from './LayoutView';

let utilityConfig: Config;
let utility: ConfigFormData;
let orbits: FoundOrbit[] | null;
beforeAll(async () => {
    FactorioDataService.initialize(JSON.parse(factorioData));
    utilityConfig = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
    utility = configToFormData(utilityConfig);
    // the finder's own answer for utility 320, as the worker gives it
    orbits = regionOrbitsOfConfig(utilityConfig);
});

const draw = (form: ConfigFormData, props: Partial<Parameters<typeof LayoutView>[0]> = {}) => show(
    <LayoutView machines={form.machines} inserters={form.inserters} belts={form.belts} chests={form.chests} drills={form.drills?.configs ?? []}
        orbits={null} selection={null} onSelectionChange={() => {}} {...props} />,
);
const buttons = (container: HTMLElement, label: RegExp) => within(container).getAllByRole('button', { name: label });
const rotation = (element: Element) => Number(/rotate\((-?[\d.]+)\)/.exec(element.getAttribute('transform') ?? '')?.[1]);

describe('the Layout view of utility 320', () => {
    it('shows 9 machines, 21 inserters by their numbers and 13 belt tiles, each coloured by its belt', () => {
        const { container } = draw(utility);
        expect(buttons(container, /^Machine \d+$/)).toHaveLength(9);
        expect(buttons(container, /^Inserter \d+$/)).toHaveLength(21);
        // the number of each inserter is drawn: its id, 1 to 21
        const numbers = [...container.querySelectorAll('svg text')].map(text => text.textContent ?? '').filter(text => /^\d+$/.test(text));
        expect(numbers.map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
        const tiles = buttons(container, /^Belt \d+$/);
        expect(tiles).toHaveLength(13);
        const perBelt = new Map<number, number>();
        for (const tile of tiles) {
            const belt = Number(/\d+/.exec(tile.getAttribute('aria-label')!)![0]);
            perBelt.set(belt, (perBelt.get(belt) ?? 0) + 1);
            expect(tile.querySelector('rect')!.getAttribute('fill')).toBe(beltColour(belt));
        }
        expect([...perBelt.entries()].sort((a, b) => a[0] - b[0])).toEqual([[1, 1], [2, 3], [3, 3], [4, 3], [5, 3]]);
    });

    it('draws the belt direction on the drop tiles of inserters 1, 4, 11, 13, 18 and 19 and on no pickup tile', () => {
        const { container } = draw(utility);
        const arrows = buttons(container, /^Belt \d+$/).flatMap(tile => {
            const arrow = tile.querySelector('polygon');
            return arrow ? [{ belt: tile.getAttribute('aria-label'), turn: rotation(arrow) }] : [];
        });
        // the belt direction of each of those drops (0 north, 8 south, 12 west) times 22.5 degrees; belt 4 takes arms 1, 4 and 13, belt 3 arms 11, 18 and 19
        const direction = (id: number) => utilityConfig.inserters.find(it => it.id === id)!.sink as { belt_direction?: number };
        const expected = [1, 4, 13].map(id => ['Belt 4', direction(id).belt_direction! * 22.5]).concat([11, 18, 19].map(id => ['Belt 3', direction(id).belt_direction! * 22.5]));
        expect(arrows.map(it => [it.belt, it.turn]).sort()).toEqual(expected.sort());
        expect(arrows).toHaveLength(6);
        // the seven tiles inserters pick from carry no arrow
        expect(buttons(container, /^Belt \d+$/).filter(tile => tile.querySelector('polygon') === null)).toHaveLength(7);
    });

    it('draws no region while the answer is null, and tints machines 1, 2, 3, 5 and 6, 7, 8, 9 with the engine\'s answer', () => {
        const none = draw(utility);
        const halo = (container: HTMLElement, id: number) => within(container).getByRole('button', { name: `Machine ${id}` }).querySelectorAll('rect');
        for (const id of [1, 4, 6]) expect(halo(none.container, id)).toHaveLength(1);
        none.unmount();

        const { container } = draw(utility, { orbits });
        const tintOf = (id: number) => halo(container, id)[0].getAttribute('fill');
        for (const id of [1, 2, 3, 5]) expect(tintOf(id), `machine ${id}`).toBe(regionColour(1));
        for (const id of [6, 7, 8, 9]) expect(tintOf(id), `machine ${id}`).toBe(regionColour(2));
        // the cryogenic plant they share stands between them
        expect(tintOf(4)).toBe(regionColour(0));
        expect(container.textContent).toContain('Region 1: machines 1, 2, 3, 5');
        expect(container.textContent).toContain('Number: the inserter\'s number, as in the List.');
        expect(container.textContent).toContain('Region 2: machines 6, 7, 8, 9');
    });

    it('draws no region where the finder refused one', () => {
        const refused: FoundOrbit[] = [{ kind: 'refused', reason: 'no_map', group: 'g', anchor: ['machine:4'], regions: [{ key: 'machine:4/region:1', nodes: ['machine:1'], arms: [] }] }];
        const { container } = draw(utility, { orbits: refused });
        expect(within(container).getByRole('button', { name: 'Machine 1' }).querySelectorAll('rect')).toHaveLength(1);
        expect(container.textContent).not.toContain('Region');
    });
});

describe('a build with missing positions', () => {
    it('says why and draws no picture when no entity has a position', () => {
        const { container } = draw(build({ machines: [machine(1)], inserters: [inserter(1)] }));
        expect(container.textContent).toBe('This build has no positions; paste a Sidecar export');
        expect(container.querySelector('svg')).toBeNull();
    });

    it('draws what has a position and lists the rest by id', () => {
        const form: ConfigFormData = { ...utility,
            machines: utility.machines.map(it => it.id === 3 ? { ...it, position: undefined } : it),
            inserters: utility.inserters.map(it => it.id === 5 || it.id === 6 ? { ...it, position: undefined } : it) };
        const { container } = draw(form);
        expect(buttons(container, /^Machine \d+$/)).toHaveLength(8);
        expect(buttons(container, /^Inserter \d+$/)).toHaveLength(19);
        expect(container.querySelector('[data-layout-left-out]')!.textContent).toBe('Not drawn, no position: Machine 3, Inserter 5, Inserter 6.');
    });
});

describe('two entities at one place', () => {
    it('draws both and marks each with the other', () => {
        const index = utility.inserters.findIndex(it => it.id === 4);
        const doubled = duplicateEntity(utility, 'inserters', index);
        const copy = doubled.inserters.at(-1)!;
        expect(copy.position).toEqual(utility.inserters[index].position);
        const { container } = draw(doubled);
        expect(buttons(container, /^Inserter \d+$/)).toHaveLength(22);
        expect(container.querySelectorAll('[data-same-place]')).toHaveLength(2);
        const notes = [...container.querySelectorAll('[data-layout-same-place] li')].map(it => it.textContent);
        expect([...notes].sort()).toEqual([`Inserter 4: same place as inserter ${copy.id}`, `Inserter ${copy.id}: same place as inserter 4`].sort());
    });
});

describe('selecting in the view', () => {
    it('gives the selection handler what the diagram gives for an inserter, which the page stores as the diagram does', async () => {
        const onSelectionChange = vi.fn();
        const { container, user } = draw(utility, { onSelectionChange });
        await user.click(within(container).getByRole('button', { name: 'Inserter 5' }));
        expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ kind: 'inserter', id: 5 });
        expect(selectBuildEntity(utility, onSelectionChange.mock.calls[0][0])).toMatchObject({ kind: 'inserter', id: 5 });
    });

    it('marks the selected entity and names it', () => {
        const { container } = draw(utility, { selection: { kind: 'inserter', id: 5 } });
        expect(container.textContent).toContain('Selected: Inserter 5.');
        expect(within(container).getByRole('button', { name: 'Inserter 5' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('shows a ring on the entity a keyboard user has reached, and selects it with Enter', async () => {
        const onSelectionChange = vi.fn();
        const { container, user } = draw(utility, { onSelectionChange });
        const first = buttons(container, /./)[0];
        await user.tab();
        // tab goes to the first entity of the picture or to a control before it: go on until the picture's first button
        for (let step = 0; step < 6 && document.activeElement !== first; step++) await user.tab();
        expect(document.activeElement).toBe(first);
        expect(first.hasAttribute('data-focused')).toBe(true);
        await user.keyboard('{Enter}');
        expect(onSelectionChange).toHaveBeenCalledOnce();
        await user.tab();
        expect(first.hasAttribute('data-focused')).toBe(false);
    });
});
