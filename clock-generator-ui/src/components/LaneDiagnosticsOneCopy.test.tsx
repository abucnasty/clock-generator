// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CheckedLanes, SharedLaneCause } from 'clock-generator/browser';
import { names, show } from '../test/fixtures';
import { NINE_APART_HOLDS, NINE_APART_MISSES, ROW_LANES, rowView, SIX_APART_MISSES } from '../test/oneCopyBuild';
import { AUTOMATION_240, viewOf } from '../test/checkedLanesFixtures';
import { ONE_COPY_WORDS } from '../utils/missedSwings';
import { CauseHeadline, LaneDiagnostics, SharedLaneCauseParts, SharedLanesTable } from './CheckedLanesView';

const gameNames = names({ 'iron-gear-wheel': 'Iron gear wheel', 'copper-plate': 'Copper plate', 'automation-science-pack': 'Automation science pack' });

/** The text a sighted reader sees: the container's text without what a closed disclosure folds away (its summary stays) */
function visibleText(container: HTMLElement): string {
    const copy = container.cloneNode(true) as HTMLElement;
    for (const details of copy.querySelectorAll('details:not([open])')) {
        for (const child of [...details.children]) if (child.tagName !== 'SUMMARY') child.remove();
    }
    return copy.textContent ?? '';
}

/** Every word of the page that a reader, a screen reader or a pointer can reach: the text, the labels and the tooltips */
function everyWord(container: HTMLElement): string {
    const details = container.querySelector('details') as HTMLDetailsElement | null;
    if (details) details.open = true;
    const labels = [...container.querySelectorAll('[aria-label]')].map(it => it.getAttribute('aria-label'));
    const tips = [...container.querySelectorAll('title')].map(it => it.textContent);
    return [container.textContent, ...labels, ...tips].join('\n');
}

const COPY_WORD = /cop(y|ies)/i;
const missing = rowView(NINE_APART_MISSES, 9, 'takt_batches_observed_swings_2');
const cause = NINE_APART_MISSES.cause!;
/** The chips of picture one: their heads and the swings each misses */
const chipsOf = (container: HTMLElement) => ({
    chips: [...container.querySelectorAll('[data-picture="inserters"] [data-chip]')].map(it => it.getAttribute('data-chip')),
    heads: [...container.querySelectorAll('[data-picture="inserters"] text')].map(it => it.textContent),
});

describe('Diagnostics of a build of one copy that misses swings on a lane its inserters share', () => {
    it('names the inserter and its machine, and has no word about a copy anywhere on the lane parts', () => {
        const { container } = show(<LaneDiagnostics clock={missing} />, { names: gameNames });
        const text = everyWord(container);
        expect(text).toContain('Inserter 3 into machine 2 misses 16 of 130 swings');
        expect(text).not.toMatch(COPY_WORD);
    });

    it('draws a bar for each inserter on the lane, in order along the belt, with the tiles between them', () => {
        const { container } = show(<LaneDiagnostics clock={missing} />, { names: gameNames });
        expect(visibleText(container)).toContain(ONE_COPY_WORDS.pictureOne);
        const { chips, heads } = chipsOf(container);
        expect(chips).toEqual(['0', '16', '0', '0', '0', '0', '0', '0', '0']);
        expect(heads).toContain('Inserter');
        expect(heads.filter(it => /^\d+$/.test(it ?? '')).slice(0, 9)).toEqual(['1', '3', '5', '7', '9', '11', '13', '15', '17']);
        const picture = container.querySelector('[data-picture="inserters"]')!;
        expect(picture.textContent).toContain('9 tiles between inserters');
        expect(picture.textContent).toContain('swings missed, of 130 each');
        expect(container.querySelector('[data-picture="copies"]')).toBeNull();
        // the clock alone makes every swing: nothing more to say under picture one
        expect([...container.querySelectorAll('figcaption')].map(it => it.textContent)).toEqual(['Each cell is one window cycle. A grey cell is a window cycle with every swing made.']);
    });

    it('names two inserters that miss swings: two bars, the others 0, and a headline with each count', () => {
        const two = rowView(SIX_APART_MISSES, 6);
        const { container } = show(<LaneDiagnostics clock={two} />, { names: gameNames });
        expect(chipsOf(container).chips).toEqual(['0', '0', '64', '38', '0', '0', '0', '0', '0']);
        expect(container.querySelector('[data-cause-headline]')!.textContent).toBe('Inserter 5 into machine 3 misses 64 of 378 swings, and inserter 7 into machine 4 misses 38 of 378');
        expect(container.querySelector('[data-picture="inserters"]')!.textContent).toContain('6 tiles between inserters');
        expect(screen.getByText('The 63 window cycles of each inserter')).toBeTruthy();
        expect(everyWord(container)).not.toMatch(COPY_WORD);
    });

    it('gives each gap where the inserters are not evenly apart', () => {
        const uneven = { ...missing, assumptions: { ...missing.assumptions, laneTakers: [1, 2].map(lane => ({ beltId: 1, lane: lane as 1 | 2,
            takers: [[1, 10], [3, 16], [5, 19], [7, 31], [9, 32], [11, 40], [13, 41], [15, 50], [17, 54]].map(([inserterId, along]) => ({ inserterId, along })) })) } };
        const { container } = show(<LaneDiagnostics clock={uneven} />, { names: gameNames });
        const picture = container.querySelector('[data-picture="inserters"]')!;
        expect(picture.textContent).toContain(`${ONE_COPY_WORDS.tilesApart(false)}631218194`);
    });

    it('draws only the inserters the engine names where the build\'s takers are not known, and no tiles', () => {
        const { container } = show(<LaneDiagnostics clock={{ ...missing, assumptions: { ...missing.assumptions, laneTakers: undefined } }} />, { names: gameNames });
        expect(chipsOf(container).chips).toEqual(['16']);
        expect(container.querySelector('[data-picture="inserters"]')!.textContent).not.toContain('tiles');
    });

    it('names the inserter in the rows and the title of the window cycles, and says what the gap is of in its tooltip', () => {
        const rows = (cause.swings as Extract<SharedLaneCause['swings'], { kind: 'lane' }>).rows;
        const gap: SharedLaneCause = { ...cause, swings: { kind: 'lane', rows: [{ ...rows[0], missed: [{ window_cycle: 5, missed: 1, cause: 'gap', lane_empty: true }] }] } };
        const checked = { ...NINE_APART_MISSES, cause: gap } as CheckedLanes & { cause: SharedLaneCause };
        const { container } = show(<SharedLaneCauseParts checked={checked} lanes={ROW_LANES} assumptions={missing.assumptions} />, { names: gameNames });
        expect(screen.getByText('The 65 window cycles of inserter 3 into machine 2')).toBeTruthy();
        expect(screen.getByText('Inserter 3 into machine 2')).toBeTruthy();
        expect(container.querySelector('[data-mark]')!.querySelector('title')!.textContent)
            .toBe('Window cycle 5: 1 of its 2 swings missed. The lane was empty in its reach: the gap that the inserters upstream left.');
        expect(container.querySelector('[data-legend]')!.textContent).toBe('gap only: the lane was empty, the gap the inserters upstream left (1)');
    });

    it('names the other clock that holds without "with all 1"', () => {
        const { container } = show(<LaneDiagnostics clock={missing} />, { names: gameNames });
        expect(container.querySelector('[data-other-clock]')!.textContent).toBe('Another clock of this build holds: Time-Study Windows, window cycle 216 ticks.');
    });

    it('"Read this as text" says each inserter that misses, with the share of each item, in the page\'s words', () => {
        const { container } = show(<LaneDiagnostics clock={missing} />, { names: gameNames });
        fireEvent.click(screen.getByText('Read this as text'));
        const details = container.querySelector('[data-read-as-text]') as HTMLDetailsElement;
        details.open = true;
        expect(details.textContent).toBe('Read this as textInserter 3 into machine 2 misses 16 of its 130 swings in 65 window cycles: 9 with copper plate and 7 with iron gear wheel.');
    });

    it('words each lane\'s row for the inserters, not for copies', () => {
        const { container } = show(<LaneDiagnostics clock={missing} />, { names: gameNames });
        const rows = [...container.querySelectorAll('tbody tr')].map(row => row.textContent);
        expect(rows[0]).toContain('Swings missed');
        expect(rows[0]).toContain('Inserter 3 into machine 2 misses 7 of 65 swings.');
        expect(rows[1]).toContain('Inserter 3 into machine 2 misses 9 of 65 swings.');
        expect(rows[2]).toContain('Rate fits');
        expect(rows[2]).toContain('The inserters together drop no more than this lane carries. Not simulated: items that already lie on the belt where they drop.');
        expect(container.querySelector('thead')!.textContent).toContain('Planned for all inserters');
        expect(container.querySelector('[data-lanes-count]')!.textContent).toBe('3 lanes · 2 with missed swings · 1 by rate only');
    });

    it('says the inserter without its machine where the machines of the inserters are not known', () => {
        const { container } = show(<LaneDiagnostics clock={{ ...missing, assumptions: { ...missing.assumptions, machineOfInserter: undefined } }} />, { names: gameNames });
        expect(visibleText(container)).toContain('Inserter 3 misses 16 of 130 swings');
        expect(visibleText(container)).not.toContain('into machine');
    });
});

describe('the headline of a cause of a build of one copy', () => {
    const take = (inserter_id: number, missed: number, swings: number) => ({ copy: 1, inserter_id, missed, swings, items: [{ item: 'copper-plate', missed, swings }] });
    const causeOf = (...takers: ReturnType<typeof take>[]): SharedLaneCause => ({ ...cause, where: { ...cause.where, data: { takers } } });
    const headline = (of: SharedLaneCause) => show(<CauseHeadline cause={of} clock={missing} />).container.textContent;

    it('names one inserter', () => {
        expect(headline(causeOf(take(3, 16, 130)))).toBe('Inserter 3 into machine 2 misses 16 of 130 swings');
    });

    it('names several that miss the same count, and several that miss different counts', () => {
        expect(headline(causeOf(take(3, 9, 65), take(5, 9, 65)))).toBe('Inserter 3 into machine 2 and inserter 5 into machine 3 miss 9 of 65 swings each');
        expect(headline(causeOf(take(3, 9, 65), take(5, 4, 65), take(7, 1, 65)))).toBe(
            'Inserter 3 into machine 2 misses 9 of 65 swings, and inserter 5 into machine 3 misses 4 of 65 and inserter 7 into machine 4 misses 1 of 65');
    });

    it('is the engine\'s headline for a build of more copies, or with no clock given', () => {
        const nine = viewOf(AUTOMATION_240, 'euclidean_swings');
        const of = nine.checkedLanes!.cause!;
        expect(show(<CauseHeadline cause={of} clock={nine} />).container.textContent).toBe(of.headline.text);
        expect(show(<CauseHeadline cause={cause} />).container.textContent).toBe(cause.headline.text);
    });

    it('names the output inserter at a full join where the engine gives it no number', () => {
        const join = { ...causeOf(take(0, 4, 54)), kind: 'join' as const };
        expect(headline(join)).toBe('Output inserter misses 4 of 54 swings');
    });
});

describe('a build of one copy that holds', () => {
    it('has no word about a copy in its lane table', () => {
        const { container } = show(<LaneDiagnostics clock={rowView(NINE_APART_HOLDS, 9, 'time_study_windows')} />, { names: gameNames });
        expect(everyWord(container)).not.toMatch(COPY_WORD);
        expect(container.querySelector('[data-lanes-count]')!.textContent).toBe('3 lanes · 2 hold · 1 by rate only');
    });
});

describe('the lane table of a build of more copies reads as before', () => {
    it('keeps the engine\'s label and sentence, and the copies in the column', () => {
        const nine = viewOf(AUTOMATION_240, 'euclidean_swings');
        const checked = nine.checkedLanes!;
        const { container } = show(<SharedLanesTable checked={checked} lanes={AUTOMATION_240.lanes} assumptions={nine.assumptions} level={4} />, { names: gameNames });
        expect(container.querySelector('thead')!.textContent).toContain('Planned for the 9 copies');
        for (const row of checked.rows) expect(container.textContent).toContain(row.label);
        expect(container.textContent).not.toContain('Planned for all inserters');
    });
});

describe('the chests the output goes into, for a build of one copy', () => {
    it('are named by their labels, not "of each copy"', () => {
        const checked = { ...NINE_APART_HOLDS, line: { ...NINE_APART_HOLDS.line, output_chests: [{ chest_id: 4, kind: 'chest', items: ['automation-science-pack'] }],
            output_chests_text: 'The output goes into a chest of each copy: the chest 4.' } } as CheckedLanes;
        const { container } = show(<LaneDiagnostics clock={{ ...rowView(NINE_APART_HOLDS, 9, 'time_study_windows'), checkedLanes: checked }} />, { names: gameNames });
        expect(container.querySelector('[data-checked-line]')!.textContent).toBe('The output goes into chest 4.');
    });
});
