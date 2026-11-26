// @vitest-environment happy-dom
import { within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { FactorioDataService, regionOrbitsOfConfig, type Config, type FoundOrbit } from 'clock-generator/browser';
import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';
import { show } from '../test/fixtures';
import { installOf, UTILITY_320_WIRING } from '../test/utilityWiring';
import { COMBINATOR_COLOURS } from '../utils/combinatorColours';
import { configToFormData } from '../utils/configForm/configMapping';
import type { ConfigFormData } from '../utils/configForm/formData';
import { regionColour } from '../utils/layoutColours';
import { layoutOf, type Layout } from '../utils/layoutOf';
import { regionTintsOf } from '../utils/layoutRegions';
import { tileSizeOf } from '../utils/layoutSizes';
import type { ClockInstallFacts } from '../worker/installFacts';
import { WiringList, type WiringPictures } from './InstallSteps';

let utilityConfig: Config;
let utility: ConfigFormData;
let orbits: FoundOrbit[] | null;
beforeAll(async () => {
    FactorioDataService.initialize(JSON.parse(factorioData));
    utilityConfig = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
    utility = configToFormData(utilityConfig);
    orbits = regionOrbitsOfConfig(utilityConfig);
});

const noMoves = () => ({ items: [], route: '' });
const omitPosition = <T extends object>(row: T) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'position')) as T;
const layoutOfForm = (form: ConfigFormData): Layout => layoutOf({ machines: form.machines, drills: form.drills?.configs ?? [], inserters: form.inserters, belts: form.belts, chests: form.chests }, tileSizeOf);
const list = (install: ClockInstallFacts, pictures?: WiringPictures) => show(<WiringList install={install} movesOf={noMoves} pictures={pictures} />);
const rowOf = (container: HTMLElement, combinator: string) => container.querySelector(`[data-wiring-row="${combinator}"]`) as HTMLElement;

describe('the rows of the wiring list of a clock with letters (utility 320)', () => {
    const install = installOf(UTILITY_320_WIRING);

    it('starts each row with its swatch and letter, in its colour, and keeps the first line under it', () => {
        const { container } = list(install);
        const rows = [...container.querySelectorAll('[data-wiring-row]')];
        expect(rows).toHaveLength(11);
        rows.forEach((row, index) => {
            const swatch = row.querySelector('[data-combinator-swatch]')!;
            expect(swatch.getAttribute('data-combinator-swatch')).toBe(String.fromCharCode(65 + index));
            expect(swatch.textContent).toBe(String.fromCharCode(65 + index));
            expect(getComputedStyle(swatch).backgroundColor).not.toBe('');
            expect(row.querySelector('[data-wiring-line]')!.textContent).toContain(`(${String.fromCharCode(65 + index)})`);
        });
        expect(rowOf(container, 'Inserters 5, 14').querySelector('[data-combinator-swatch]')!.getAttribute('data-combinator-swatch')).toBe('E');
        expect(rowOf(container, 'Inserters 6, 16').querySelector('[data-combinator-swatch]')!.getAttribute('data-combinator-swatch')).toBe('F');
    });

    it('puts the swatch in place of the bare heading where the clock has no line, and keeps the earlier rows where it has no letter', () => {
        const noLines = list({ ...install, lines: {} });
        const row = rowOf(noLines.container, 'Inserters 5, 14');
        expect(row.textContent).toContain('E');
        expect(row.textContent).toContain('Inserters 5, 14');
        expect(row.textContent).not.toContain('one combinator for all of these');
        noLines.unmount();
        const noLetters = list({ ...install, lines: {}, letters: undefined });
        expect(rowOf(noLetters.container, 'Inserters 5, 14').textContent).toBe('Inserters 5, 14 (one combinator for all of these)Inserter 5Inserter 14');
        expect(noLetters.container.querySelector('[data-combinator-swatch]')).toBeNull();
    });
});

describe('the pictures beside the rows of the wiring list (utility 320)', () => {
    const install = installOf(UTILITY_320_WIRING);

    it('draws a small picture for each row, with the inserters of its combinator ringed in its colour and the rest dimmed, no icons', () => {
        const pictures = { layout: layoutOfForm(utility), regions: null };
        const { container } = list(install, pictures);
        const drawn = [...container.querySelectorAll('[data-row-picture]')];
        expect(drawn).toHaveLength(11);
        const ringsOf = (combinator: string) => [...rowOf(container, combinator).querySelectorAll('[data-ring]')].map(ring => ring.getAttribute('data-ring')).sort();
        expect(ringsOf('Inserters 5, 14')).toEqual(['inserter:14', 'inserter:5']);
        expect(ringsOf('Inserters 6, 16')).toEqual(['inserter:16', 'inserter:6']);
        expect(ringsOf('Inserter 7')).toEqual(['inserter:7']);
        // the ring of row E in the colour of E, over a dark casing
        const ring = rowOf(container, 'Inserters 5, 14').querySelector('[data-ring="inserter:5"]')!;
        const circles = ring.querySelectorAll('circle');
        expect(circles[0].getAttribute('stroke')).toBe('#1a1a1a');
        expect(circles[1].getAttribute('stroke')).toBe(COMBINATOR_COLOURS[4]);
        // about 200 pixels on the longer side, and no icons in it
        for (const picture of drawn) {
            expect(Math.max(Number(picture.getAttribute('width')), Number(picture.getAttribute('height')))).toBeLessThanOrEqual(200.5);
            expect(Math.max(Number(picture.getAttribute('width')), Number(picture.getAttribute('height')))).toBeGreaterThan(150);
            expect(picture.querySelector('img, image, foreignObject')).toBeNull();
        }
        expect(within(rowOf(container, 'Inserters 5, 14')).getByRole('img', { name: 'Where inserters 5, 14 are in the build' })).toBeTruthy();
        expect(within(rowOf(container, 'Inserter 7')).getByRole('img', { name: 'Where inserter 7 is in the build' })).toBeTruthy();
    });

    it('gives a build with no positions no picture, and the row stays as it was', () => {
        const bare = { ...utility, machines: utility.machines.map(omitPosition), inserters: utility.inserters.map(omitPosition), chests: [], drills: undefined } as ConfigFormData;
        const layout = layoutOfForm(bare);
        const { container } = list(install, { layout, regions: null });
        expect(container.querySelectorAll('[data-row-picture]')).toHaveLength(0);
        const plain = list(install);
        expect(rowOf(container, 'Inserters 5, 14').innerHTML).toBe(rowOf(plain.container, 'Inserters 5, 14').innerHTML);
    });

    it('names an inserter with no position under the picture of its row, and draws no ring for it', () => {
        const without = { ...utility, inserters: utility.inserters.map(row => row.id === 14 ? omitPosition(row) : row) } as ConfigFormData;
        const { container } = list(install, { layout: layoutOfForm(without), regions: null });
        const row = rowOf(container, 'Inserters 5, 14');
        expect(row.querySelector('[data-wiring-not-drawn]')!.textContent).toBe('Not drawn, no position: Inserter 14.');
        expect([...row.querySelectorAll('[data-ring]')].map(ring => ring.getAttribute('data-ring'))).toEqual(['inserter:5']);
        expect(rowOf(container, 'Inserters 6, 16').querySelector('[data-wiring-not-drawn]')).toBeNull();
    });

    it('is no box of its own once rows carry pictures: it scrolls with the dialog, not past eight lines', () => {
        const withPictures = list(install, { layout: layoutOfForm(utility), regions: null });
        const box = withPictures.container.querySelector('[data-wiring-list]') as HTMLElement;
        expect(box.getAttribute('tabindex')).toBeNull();
        withPictures.unmount();
        const alone = list(install);
        expect((alone.container.querySelector('[data-wiring-list]') as HTMLElement).getAttribute('tabindex')).toBe('0');
    });

    it('puts a tint square with its region number after each inserter the engine\'s answer holds, and none where the answer is null', () => {
        const regions = regionTintsOf(orbits);
        const { container } = list(install, { layout: layoutOfForm(utility), regions });
        const squareOf = (label: string) => [...container.querySelectorAll('li[data-wiring-entry]')].find(item => item.firstChild?.textContent === label)?.querySelector('[data-region-square]');
        // utility 320: machines 1, 2, 3, 5 are region 1 and 6, 7, 8, 9 region 2; the inserters of each follow their region
        const found = [...container.querySelectorAll('[data-region-square]')].map(square => Number(square.getAttribute('data-region-square')));
        expect(found.length).toBeGreaterThan(0);
        for (const [key, region] of regions!.of) {
            if (!key.startsWith('inserter:') || region < 1) continue;
            const square = squareOf(`Inserter ${key.slice('inserter:'.length)}`);
            expect(square, key).toBeTruthy();
            expect(square!.getAttribute('data-region-square')).toBe(String(region));
        }
        const colours = new Set([...container.querySelectorAll('[data-region-square]')].map(square => square.getAttribute('data-region-square')));
        expect([...colours].every(region => regionColour(Number(region)) !== '')).toBe(true);
        const none = list(install, { layout: layoutOfForm(utility), regions: null });
        expect(none.container.querySelectorAll('[data-region-square]')).toHaveLength(0);
    });
});

describe('what the wiring list writes of a place', () => {
    it('holds no x or y value with a fraction, as the config writes it, in a text, an aria-label or a title', () => {
        const regions = regionTintsOf(orbits);
        const { container } = list(installOf(UTILITY_320_WIRING), { layout: layoutOfForm(utility), regions });
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
