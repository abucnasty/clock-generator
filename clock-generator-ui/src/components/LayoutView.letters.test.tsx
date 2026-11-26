// @vitest-environment happy-dom
import { fireEvent, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FactorioDataService, regionOrbitsOfConfig, type Config, type FoundOrbit } from 'clock-generator/browser';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { drill, inserter, machine, show } from '../test/fixtures';
import { installOf, UTILITY_320_WIRING } from '../test/utilityWiring';
import { configToFormData } from '../utils/configForm/configMapping';
import type { ConfigFormData } from '../utils/configForm/formData';
import { COMBINATOR_COLOURS } from '../utils/combinatorColours';
import { layoutOf } from '../utils/layoutOf';
import { layoutMarks, overlap } from '../utils/layoutMarks';
import { tileSizeOf } from '../utils/layoutSizes';
import { regionTintsOf } from '../utils/layoutRegions';
import type { ClockInstallFacts } from '../worker/installFacts';
import { LayoutView } from './LayoutView';

let utilityConfig: Config;
let utility: ConfigFormData;
let orbits: FoundOrbit[] | null;
beforeAll(async () => {
    FactorioDataService.initialize(JSON.parse(factorioData));
    utilityConfig = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
    utility = configToFormData(utilityConfig);
    orbits = regionOrbitsOfConfig(utilityConfig);
});

const draw = (form: ConfigFormData, props: Partial<Parameters<typeof LayoutView>[0]> = {}) => show(
    <LayoutView machines={form.machines} inserters={form.inserters} belts={form.belts} chests={form.chests} drills={form.drills?.configs ?? []}
        orbits={null} selection={null} onSelectionChange={() => {}} {...props} />,
);
const tags = (container: HTMLElement) => [...container.querySelectorAll('[data-combinator-tag]')];
const tagsOf = (container: HTMLElement, letter: string) => tags(container).filter(tag => tag.getAttribute('data-combinator-tag') === letter).map(tag => tag.getAttribute('data-tag-for')).sort();

describe('the Layout view of a clock that is current for the build (utility 320)', () => {
    const install = installOf(UTILITY_320_WIRING);

    it('gives each inserter the tag of its combinator, in the colour of its letter: 5 and 14 carry E, 6 and 16 carry F', () => {
        const { container } = draw(utility, { install });
        expect(tags(container)).toHaveLength(21);
        expect(tagsOf(container, 'E')).toEqual(['inserter:14', 'inserter:5']);
        expect(tagsOf(container, 'F')).toEqual(['inserter:16', 'inserter:6']);
        expect(tagsOf(container, 'G')).toEqual(['inserter:7']);
        // eleven combinators, eleven colours, every tag square
        for (const [index, ids] of UTILITY_320_WIRING.entries()) {
            for (const id of ids) {
                const tag = container.querySelector(`[data-tag-for="inserter:${id}"]`)!;
                expect(tag.querySelector('rect')!.getAttribute('fill'), `inserter ${id}`).toBe(COMBINATOR_COLOURS[index]);
                expect(tag.getAttribute('data-tag-shape')).toBe('square');
                expect(tag.textContent).toBe(`Combinator ${String.fromCharCode(65 + index)}${String.fromCharCode(65 + index)}`);
            }
        }
    });

    it('stands each tag after its inserter\'s number and hides the matching number of another region and its legend line', () => {
        const { container } = draw(utility, { install, orbits });
        expect(container.querySelectorAll('[data-twin-label]')).toHaveLength(0);
        expect(container.textContent).not.toContain('=N');
        // the regions are still tinted and told
        expect(container.textContent).toContain('Region 1: machines 1, 2, 3, 5');
        const badge = container.querySelector('[data-inserter-badge]')!;
        const tag = tags(container).find(it => it.getAttribute('data-tag-for') === 'inserter:1')!.querySelector('rect')!;
        expect(Math.abs(Number(tag.getAttribute('y')) - Number(badge.getAttribute('y')))).toBeLessThan(40);
    });

    it('lists each combinator in the legend: its swatch and letter, the decider and its item as pictures, and its inserters\' numbers', () => {
        const { container } = draw(utility, { install });
        const lines = [...container.querySelectorAll('[data-layout-combinator]')];
        expect(lines).toHaveLength(11);
        const e = lines.find(line => line.getAttribute('data-layout-combinator') === 'E')!;
        expect(e.textContent).toContain('inserters 5, 14');
        expect(within(e as HTMLElement).getByRole('img', { name: 'Combinator E' })).toBeTruthy();
        expect([...e.querySelectorAll('img')].map(icon => icon.getAttribute('src'))).toEqual(['/icons/decider-combinator.png', '/icons/iron-plate.png']);
        expect(lines.find(line => line.getAttribute('data-layout-combinator') === 'G')!.textContent).toContain('inserter 7');
    });

    it('is exactly the view of the build alone while there is no clock, a stale one, or one with no letters', () => {
        const alone = draw(utility, { orbits });
        const withNull = draw(utility, { orbits, install: null });
        const noLetters = draw(utility, { orbits, install: { ...install, letters: undefined } });
        // the ground's pattern has an id of its own in each render
        const html = (container: HTMLElement) => container.innerHTML.replace(/(:r[0-9a-z]+:|_r_[0-9a-z]+_)/g, ':id:');
        expect(html(withNull.container)).toBe(html(alone.container));
        expect(html(noLetters.container)).toBe(html(alone.container));
        expect(tags(alone.container)).toHaveLength(0);
        expect(alone.container.querySelectorAll('[data-twin-label]').length).toBeGreaterThan(0);
        expect(alone.container.textContent).toContain('=N: the matching inserter of another region');
    });

    it('puts no tag over an inserter number, a belt label or another tag', () => {
        // what the picture drew
        const { container } = draw(utility, { install });
        const box = (element: Element, width: number, height: number, up = 0) => ({ x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')) - up, width, height });
        const drawnTags = tags(container).map(tag => { const rect = tag.querySelector('rect')!; return box(rect, Number(rect.getAttribute('width')), Number(rect.getAttribute('height'))); });
        const others = [
            ...[...container.querySelectorAll('[data-inserter-badge]')].map(it => box(it, Number(it.getAttribute('width')), 15)),
            ...[...container.querySelectorAll('[data-belt-label]')].map(it => box(it, 5.4 * (it.textContent ?? '').length + 2, 9, 8)),
        ];
        expect(drawnTags).toHaveLength(21);
        expect(others).toHaveLength(21 + 13);
        drawnTags.forEach((mine, index) => {
            for (const other of others) expect(overlap(mine, other), `tag ${index} at ${mine.x}, ${mine.y}`).toBe(0);
            for (const other of drawnTags.slice(index + 1)) expect(overlap(mine, other), `tag ${index} and another`).toBe(0);
        });
        // and what the placement rule gives, with the regions' numbers beside as before
        const layout = layoutOf({ machines: utility.machines, drills: [], inserters: utility.inserters, belts: utility.belts, chests: utility.chests }, tileSizeOf);
        const lettered = new Map(Object.entries(install.letters!).flatMap(([key, letter]) => key.slice('inserter:'.length).split(',').map(id => [`inserter:${id}`, letter.letter] as const)));
        const marks = layoutMarks(layout, regionTintsOf(orbits)?.twins, lettered);
        expect(marks.tags.size).toBe(21);
        for (const [key, mine] of marks.tags) {
            for (const other of [...marks.badges, ...marks.beltLabels]) expect(overlap(mine, other), key).toBe(0);
            for (const [otherKey, other] of marks.tags) if (otherKey !== key) expect(overlap(mine, other), `${key} and ${otherKey}`).toBe(0);
        }
    });
});

describe('the Layout view of a clock of twelve combinators', () => {
    it('gives the twelfth a round tag that reads L, in the first colour again', () => {
        const wiring = utility.inserters.slice(0, 12).map(row => [row.id]);
        const { container } = draw(utility, { install: installOf(wiring) });
        expect(tags(container)).toHaveLength(12);
        const twelfth = container.querySelector('[data-tag-for="inserter:12"]')!;
        expect(twelfth.getAttribute('data-combinator-tag')).toBe('L');
        expect(twelfth.getAttribute('data-tag-shape')).toBe('round');
        expect(twelfth.querySelector('rect')!.getAttribute('fill')).toBe(COMBINATOR_COLOURS[0]);
        expect(Number(twelfth.querySelector('rect')!.getAttribute('rx'))).toBeGreaterThanOrEqual(Number(twelfth.querySelector('rect')!.getAttribute('height')) / 2);
        expect(container.querySelector('[data-tag-for="inserter:1"]')!.getAttribute('data-tag-shape')).toBe('square');
        expect(container.querySelector('[data-tag-for="inserter:11"]')!.getAttribute('data-combinator-tag')).toBe('K');
        const legend = container.querySelector('[data-layout-combinator="L"]')!;
        expect(within(legend as HTMLElement).getByRole('img', { name: 'Combinator L' }).getAttribute('data-tag-shape')).toBe('round');
    });
});

describe('the combinator of a selection', () => {
    const install = installOf(UTILITY_320_WIRING);

    it('says the combinator and its inserters on the selected line, and joins them by a line in its colour for that combinator only', () => {
        const { container } = draw(utility, { install, selection: { kind: 'inserter', id: 5 } });
        expect(container.textContent).toContain('Selected: Inserter 5. Combinator E: inserters 5, 14.');
        const joins = [...container.querySelectorAll('[data-combinator-join]')];
        expect(joins.map(join => join.getAttribute('data-combinator-join'))).toEqual(['E']);
        const lines = joins[0].querySelectorAll('polyline');
        // a dark casing under the dashed line in the colour of E
        expect(lines[0].getAttribute('stroke')).toBe('#1a1a1a');
        expect(lines[1].getAttribute('stroke')).toBe(COMBINATOR_COLOURS[4]);
        expect(lines[1].getAttribute('stroke-dasharray')).toBeTruthy();
        expect(lines[1].getAttribute('points')!.split(' ')).toHaveLength(2);
    });

    it('draws no line for a combinator of one inserter, and none with no selection or a machine selected', () => {
        expect(draw(utility, { install, selection: { kind: 'inserter', id: 7 } }).container.querySelectorAll('[data-combinator-join]')).toHaveLength(0);
        const none = draw(utility, { install, selection: null });
        expect(none.container.querySelectorAll('[data-combinator-join]')).toHaveLength(0);
        expect(none.container.textContent).not.toContain('Selected:');
        const machineSelected = draw(utility, { install, selection: { kind: 'machine', id: 3 } });
        expect(machineSelected.container.textContent).toContain('Selected: Machine 3.');
        expect(machineSelected.container.textContent).not.toMatch(/Selected: Machine 3\. Combinator/);
        expect(machineSelected.container.querySelectorAll('[data-combinator-join]')).toHaveLength(0);
    });

    it('selects the combinator\'s first inserter from its legend line, and a tag\'s own inserter from a click on it', () => {
        const onSelectionChange = vi.fn();
        const { container } = draw(utility, { install, onSelectionChange });
        fireEvent.click(container.querySelector('[data-layout-combinator="F"]')!);
        expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: 'inserter', id: 6 });
        fireEvent.click(within(container).getByRole('button', { name: 'Inserter 14' }));
        expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: 'inserter', id: 14 });
    });

    it('does the same for a drill: its tag follows the inserters\' letters, and selecting it selects its combinator', () => {
        const form: ConfigFormData = {
            setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 }, machines: [{ ...machine(1), prototype: 'assembling-machine-3', position: { x: 10.5, y: 10.5 } }],
            inserters: [inserter(1, { position: { x: 7.5, y: 9.5 }, direction: 12 })], belts: [], chests: [],
            drills: { configs: [drill(1, { position: { x: 3, y: 3 } }), drill(2, { position: { x: 3, y: 8 } })] },
        } as unknown as ConfigFormData;
        const { container } = draw(form, { install: installOf([[1]], [[1, 2]]), selection: { kind: 'drill', id: 2 } });
        expect(tags(container).map(tag => [tag.getAttribute('data-tag-for'), tag.getAttribute('data-combinator-tag')])).toEqual([['inserter:1', 'A'], ['drill:1', 'B'], ['drill:2', 'B']]);
        expect(container.textContent).toContain('Selected: Drill 2. Combinator B: drills 1, 2.');
        expect(container.querySelectorAll('[data-combinator-join="B"]')).toHaveLength(1);
    });
});

describe('what the Layout view writes of a place', () => {
    // no text, label or title names a position: an inserter or a machine is its number, a combinator its letter
    it('holds no x or y value with a fraction, as the config writes it, in a text, an aria-label or a title', () => {
        const install: ClockInstallFacts = installOf(UTILITY_320_WIRING);
        const { container } = draw(utility, { install, orbits, selection: { kind: 'inserter', id: 5 } });
        const fractions = new Set(utilityConfig.inserters.flatMap(it => it.position ? [it.position.x, it.position.y] : [])
            .concat(utilityConfig.machines.flatMap(it => it.position ? [it.position.x, it.position.y] : []))
            .filter(value => !Number.isInteger(value)).map(String));
        expect(fractions.size).toBeGreaterThan(0);
        const words = [
            container.textContent ?? '',
            ...[...container.querySelectorAll('[aria-label]')].map(it => it.getAttribute('aria-label') ?? ''),
            ...[...container.querySelectorAll('title')].map(it => it.textContent ?? ''),
        ].join('\n');
        for (const value of fractions) expect(words, `the value ${value}`).not.toMatch(new RegExp(`(^|[^\\d.])${value.replace('.', '\\.')}($|[^\\d])`));
    });
});

describe('the overlap rule of the marks', () => {
    it('counts boxes that only touch as clear of each other', () => {
        expect(overlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(0);
        expect(overlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 0, width: 10, height: 10 })).toBe(10);
    });
});
