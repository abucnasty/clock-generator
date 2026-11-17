// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { names, show } from '../test/fixtures';
import { INSTALL_COPY, type WiringMoves } from '../utils/installSteps';
import type { ClockInstallFacts } from '../worker/installFacts';
import { WiringList } from './InstallSteps';

const noMoves = () => ({ items: [], route: '' });
const gameNames = names({ car: 'Car', 'iron-ore': 'Iron ore', 'big-mining-drill': 'Big mining drill', 'iron-plate': 'Iron plate', 'iron-gear-wheel': 'Iron gear wheel' }, { 'iron-plate': 'Iron plate', 'iron-gear-wheel': 'Iron gear wheel' });
const showList = (install: ClockInstallFacts, movesOf: (id: string) => WiringMoves = noMoves) => show(<WiringList install={install} movesOf={movesOf} />, { names: gameNames });
const list = () => screen.getByRole('list', { name: INSTALL_COPY.wiringCaption });
// each tag's icon, by the name a screen reader hears and the picture it shows
const icons = () => screen.queryAllByRole('img').map(icon => [icon.getAttribute('alt'), icon.getAttribute('src')]);
// the quality pips are drawn for the eye; the icon's name says the quality
const pips = () => screen.queryAllByRole('presentation').map(pip => pip.getAttribute('src'));

describe('the wiring list\'s rows', () => {
    const drillLine = '1 drill [item=iron-ore] (1)';
    const inserterLine = '1 inserter [item=iron-ore] (1)';
    const install: ClockInstallFacts = {
        book: false,
        wiring: [[1]],
        drills: [[1]],
        lines: { 'inserter:1': inserterLine, 'drill:1': drillLine },
    };

    it('shows each combinator\'s first line with its tags as the icons the game draws, drills included', () => {
        showList(install);
        expect(icons()).toEqual([['Iron ore', '/icons/iron-ore.png'], ['Iron ore', '/icons/iron-ore.png']]);
        // the line's words, then what to wire to it
        for (const words of ['1 inserter', '(1)', 'Inserter 1', '1 drill', 'Drill 1']) expect(screen.getAllByText(words, { exact: false }).length).toBeGreaterThan(0);
        expect(list().textContent).not.toMatch(/\[(entity|item|recipe)=/);
    });

    it('shows each inserter as source, then item, then sink with the recipe of a machine, and a drill from itself', () => {
        const moves: Record<string, WiringMoves> = {
            'inserter:1': { items: ['iron-ore'], route: 'Belt 1 to Machine 2', from: { label: 'Belt 1' }, to: { label: 'Machine 2', recipe: 'iron-gear-wheel' } },
            'drill:1': { items: ['iron-ore'], route: 'into Car 1', to: { label: 'Car 1' } },
        };
        showList(install, id => moves[id] ?? noMoves());
        const lines = Array.from(document.querySelectorAll('[data-wiring-moves]'));
        // the commas are for a screen reader; the pictures are the items and the recipe
        expect(lines.map(line => line.textContent)).toEqual([
            'Inserter 1\u2014, Belt\u00a01\u2192, \u2192, Machine\u00a02()',
            'Drill 1\u2192, \u2192, Car\u00a01',
        ]);
        expect(lines.map(line => Array.from(line.querySelectorAll('img')).map(icon => icon.getAttribute('alt')))).toEqual([['Iron ore', 'Iron gear wheel'], ['Iron ore']]);
        expect(lines.map(line => Array.from(line.querySelectorAll('img')).map(icon => icon.getAttribute('src')))).toEqual([['/icons/iron-ore.png', '/icons/iron-gear-wheel.png'], ['/icons/iron-ore.png']]);
    });

    it('draws a quality as the game\'s pip on the icon', () => {
        showList({ ...install, wiring: [[1]], drills: [], lines: { 'inserter:1': '[entity=car,quality=legendary] → [item=iron-ore,quality=rare] (inserter 1)' } });
        expect(icons()).toEqual([['Car (Legendary)', '/icons/car.png'], ['Iron ore (Rare)', '/icons/iron-ore.png']]);
        expect(pips()).toEqual(['/images/inserter-preview/badge-legendary.png', '/images/inserter-preview/badge-rare.png']);
        expect(list().textContent).not.toContain('quality=');
    });

    it('keeps the earlier rows for a clock whose combinators have no line', () => {
        showList({ ...install, lines: {} });
        expect(screen.getAllByRole('listitem').map(row => row.textContent)).toEqual(['Inserter 1', 'Drill 1']);
        expect(icons()).toEqual([]);
    });
});
