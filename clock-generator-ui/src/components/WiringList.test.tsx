import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameNamesContext } from '../hooks/useGameNames';
import type { ClockInstallFacts } from '../worker/installFacts';
import { WiringList } from './InstallSteps';

const movesOf = () => ({ items: [], route: '' });
const render = (install: ClockInstallFacts) => renderToStaticMarkup(
    <GameNamesContext.Provider value={{ item: { car: 'Car', 'iron-ore': 'Iron ore', 'big-mining-drill': 'Big mining drill', 'iron-plate': 'Iron plate' }, recipe: { 'iron-plate': 'Iron plate' } }}>
        <WiringList install={install} movesOf={movesOf} />
    </GameNamesContext.Provider>,
);

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
        const html = render(install);
        expect(html.match(/data-wiring-line/g)).toHaveLength(2);
        for (const icon of ['car', 'iron-plate', 'iron-ore', 'big-mining-drill']) {
            expect(html).toContain(`src="/icons/${icon}.png"`);
        }
        expect(html).toContain('alt="Big mining drill"');
        expect(html).toContain('alt="Car"');
        expect(html).toContain('→ machine 1 ');
        expect(html).toContain('(drill 1)');
        expect(html).not.toMatch(/\[(entity|item|recipe)=/);
    });

    it('draws a quality as the game\'s pip on the icon', () => {
        const html = render({ ...install, wiring: [[1]], drills: [], lines: { 'inserter:1': '[entity=car,quality=legendary] → [item=iron-ore,quality=rare] (inserter 1)' } });
        expect(html).toContain('alt="Car (Legendary)"');
        expect(html).toContain('/images/inserter-preview/badge-legendary.png');
        expect(html).toContain('/images/inserter-preview/badge-rare.png');
        expect(html).not.toContain('quality=');
    });

    it('keeps the earlier rows for a clock whose combinators have no line', () => {
        const html = render({ ...install, lines: {} });
        expect(html).not.toContain('data-wiring-line');
        expect(html).toContain('Inserter 1');
        expect(html).toContain('Drill 1');
    });
});
