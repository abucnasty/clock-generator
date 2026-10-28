// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { names, show } from '../test/fixtures';
import { INSTALL_COPY } from '../utils/installSteps';
import type { ClockInstallFacts } from '../worker/installFacts';
import { WiringList } from './InstallSteps';

const movesOf = () => ({ items: [], route: '' });
const gameNames = names({ car: 'Car', 'iron-ore': 'Iron ore', 'big-mining-drill': 'Big mining drill', 'iron-plate': 'Iron plate' }, { 'iron-plate': 'Iron plate' });
const showList = (install: ClockInstallFacts) => show(<WiringList install={install} movesOf={movesOf} />, { names: gameNames });
const list = () => screen.getByRole('list', { name: INSTALL_COPY.wiringCaption });
// each tag's icon, by the name a screen reader hears and the picture it shows
const icons = () => screen.queryAllByRole('img').map(icon => [icon.getAttribute('alt'), icon.getAttribute('src')]);
// the quality pips are drawn for the eye; the icon's name says the quality
const pips = () => screen.queryAllByRole('presentation').map(pip => pip.getAttribute('src'));

describe('the wiring list\'s rows', () => {
    const drillLine = '[entity=big-mining-drill] [item=iron-ore] → [entity=car] (drill 1)';
    const inserterLine = '[entity=car] → machine 1 [recipe=iron-plate] [item=iron-ore] (inserter 1)';
    const install: ClockInstallFacts = {
        book: false,
        wiring: [[1]],
        drills: [[1]],
        lines: { 'inserter:1': inserterLine, 'drill:1': drillLine },
    };

    it('shows each combinator\'s first line with its tags as the icons the game draws, drills included', () => {
        showList(install);
        expect(icons()).toEqual([
            ['Car', '/icons/car.png'], ['Iron plate', '/icons/iron-plate.png'], ['Iron ore', '/icons/iron-ore.png'],
            ['Big mining drill', '/icons/big-mining-drill.png'], ['Iron ore', '/icons/iron-ore.png'], ['Car', '/icons/car.png'],
        ]);
        // the line's words, then what to wire to it
        for (const words of ['→ machine 1', '(inserter 1)', 'Inserter 1', '(drill 1)', 'Drill 1']) expect(screen.getByText(words)).toBeDefined();
        expect(list().textContent).not.toMatch(/\[(entity|item|recipe)=/);
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
