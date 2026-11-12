// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CheckedLanes, SharedLaneCause } from 'clock-generator/browser';
import { names, show } from '../test/fixtures';
import { AUTOMATION_240, CAUSES, checkedOf, viewOf } from '../test/checkedLanesFixtures';
import { CAUSE_WORDS, MISSED_SWINGS_COPY } from '../utils/missedSwings';
import { CheckedLanesSummary, SharedLaneCauseParts } from './CheckedLanesView';

const gameNames = names({ 'iron-gear-wheel': 'Iron gear wheel', 'copper-plate': 'Copper plate', 'automation-science-pack': 'Automation science pack' });

/** The text a sighted reader sees: the container's text without what a closed disclosure folds away (its summary stays) */
function visibleText(container: HTMLElement): string {
    const copy = container.cloneNode(true) as HTMLElement;
    for (const details of copy.querySelectorAll('details:not([open])')) {
        for (const child of [...details.children]) if (child.tagName !== 'SUMMARY') child.remove();
    }
    return copy.textContent ?? '';
}

/** The sentences the pictures stand for: the cause, the spacing, "Where and how much" and "One copy alone" */
const textParts = (cause: SharedLaneCause) => [cause.cause?.text, cause.spacing?.text, cause.where.text, cause.alone.text].filter((it): it is string => Boolean(it));

describe('the pictures in place of the sentences of a cause', () => {
    it.each(['euclidean_swings', 'takt_batches_observed'])('%s: the sentences are not seen beside the pictures, and "Read this as text" holds them all', id => {
        const cause = checkedOf(AUTOMATION_240, id).cause!;
        const { container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, id)} />, { names: gameNames });
        const closed = visibleText(container);
        for (const part of textParts(cause)) expect(closed).not.toContain(part);
        expect(closed).toContain(cause.headline.text);
        expect(closed).toContain(MISSED_SWINGS_COPY.pictureOne);
        expect(closed).toContain(MISSED_SWINGS_COPY.readAsText);
        fireEvent.click(screen.getByText(MISSED_SWINGS_COPY.readAsText));
        const details = container.querySelector('[data-read-as-text]') as HTMLDetailsElement;
        details.open = true;
        const open = visibleText(container);
        for (const part of [...textParts(cause), cause.changes!.text]) expect(open).toContain(part);
    });

    it.each(['euclidean_swings', 'takt_batches_observed'])('%s: in order the headline, the two pictures, the other clock, "Read this as text", then the table', id => {
        const { container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, id)} />, { names: gameNames });
        const text = visibleText(container);
        const cause = checkedOf(AUTOMATION_240, id).cause!;
        const places = [cause.headline.text, MISSED_SWINGS_COPY.pictureOne, 'window cycles of', 'Another clock of this build', MISSED_SWINGS_COPY.readAsText, 'Shared lanes']
            .map(part => text.indexOf(part));
        expect(places.every(place => place >= 0)).toBe(true);
        expect(places).toEqual([...places].sort((a, b) => a - b));
    });

    it.each(['euclidean_swings', 'takt_batches_observed'])('%s: each picture is an image for a screen reader with the sentences it stands for', id => {
        const cause = checkedOf(AUTOMATION_240, id).cause!;
        show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, id)} />, { names: gameNames });
        const images = screen.getAllByRole('img').filter(it => it.hasAttribute('data-picture'));
        expect(images.map(it => it.getAttribute('data-picture'))).toEqual(['copies', 'window-cycles']);
        const labels = images.map(it => it.getAttribute('aria-label')!).join(' ');
        for (const part of [cause.headline.text, ...textParts(cause)]) expect(labels).toContain(part);
    });

    it('on the 72-tick clock: the chips of the copies, the 8 copies that hold, and six marked window cycles with their words', () => {
        const { container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, 'euclidean_swings')} />, { names: gameNames });
        const chips = [...container.querySelectorAll('[data-picture="copies"] [data-chip]')].map(it => it.getAttribute('data-chip'));
        expect(chips.slice(0, 9)).toEqual(['0', '6', '0', '0', '0', '0', '0', '0', '0']);
        expect(chips.slice(9, 18)).toEqual([...Array(8).fill('0'), 'absent']);
        expect(chips.slice(18)).toEqual(['0', ...Array(8).fill('absent')]);
        expect(screen.getByText('8 copies')).toBeTruthy();
        expect(screen.getByText('Travel between copies: 72 ticks (9 tiles), one window cycle')).toBeTruthy();
        const marks = [...container.querySelectorAll('[data-mark]')];
        expect(marks.map(it => `${it.getAttribute('data-mark')} ${it.querySelector('title')!.textContent}`)).toEqual([
            "full Window cycle 14: 1 of its 2 swings missed. Its machine's output was full and took no more items.",
            "both Window cycle 18: 1 of its 2 swings missed. The lane was empty in its reach, and its machine's output was full.",
            "full Window cycle 34: 1 of its 2 swings missed. Its machine's output was full and took no more items.",
            'gap Window cycle 42: 1 of its 2 swings missed. The lane was empty in its reach: the gap that copy 1 left.',
            "full Window cycle 58: 1 of its 2 swings missed. Its machine's output was full and took no more items.",
            "both Window cycle 62: 1 of its 2 swings missed. The lane was empty in its reach, and its machine's output was full.",
        ]);
        expect(screen.getByText('Copy 2 · inserter 1')).toBeTruthy();
        expect(container.querySelector('[data-legend]')!.textContent).toBe(
            `${CAUSE_WORDS.gap.legend} (1)${CAUSE_WORDS.full.legend} (3)${CAUSE_WORDS.both.legend} (2)`);
    });

    it('on the 216-tick clock: the join\'s caption with its hint, 42 marked window cycles a copy, and the 3 copies that hold', () => {
        const { container } = show(<CheckedLanesSummary clock={viewOf(AUTOMATION_240, 'takt_batches_observed')} />, { names: gameNames });
        expect(container.textContent).toContain('The side-loaded belts of copies 4 and 8 are full where they join the output belt. '
            + 'Usually the side-loaded belt is too short, or items from an upstream copy are passing on the output belt.');
        expect(container.textContent).toContain(MISSED_SWINGS_COPY.entryOfInputLanes);
        expect(container.textContent).not.toContain(MISSED_SWINGS_COPY.beltFlows);
        expect(screen.getByText('3 copies')).toBeTruthy();
        const marks = [...container.querySelectorAll('[data-mark]')];
        expect(marks).toHaveLength(84);
        expect(marks[0].querySelector('title')!.textContent).toBe('Window cycle 1: 5 of its 6 swings made.');
    });
});

describe('the pictures show what the engine counted, on every clock with a cause', () => {
    it.each(CAUSES.map(it => [`${it.sample} ${it.id}`, it] as const))('%s', (_, kept) => {
        const cause = kept.cause;
        const checked = { line: { copies: kept.copies }, rows: [], cause } as unknown as CheckedLanes & { cause: SharedLaneCause };
        const { container } = show(<SharedLaneCauseParts checked={checked} lanes={[]} />);
        // picture one: each copy's chip in the first row is its swings missed in the headline
        const slots = Math.ceil(kept.copies);
        const first = [...container.querySelectorAll('[data-picture="copies"] [data-chip]')].slice(0, slots).map(it => Number(it.getAttribute('data-chip')));
        expect(first).toEqual(Array.from({ length: slots }, (_, i) => cause.headline.data.copies.find(it => it.copy === i + 1)?.missed ?? 0));
        // picture two: the swings its marks count, by kind, are the cause's counts
        const marks = [...container.querySelectorAll('[data-picture="window-cycles"] [data-mark]')];
        const sum = (kinds: string[]) => marks.filter(it => kinds.includes(it.getAttribute('data-mark')!)).reduce((total, it) => total + Number(it.getAttribute('data-missed')), 0);
        if (cause.swings === undefined) {
            expect(cause.cause).toBeNull();
            expect(container.querySelector('[data-picture="window-cycles"]')).toBeNull();
            return;
        }
        if (cause.kind === 'join') {
            expect(sum(['fewer'])).toBe(cause.headline.data.copies.reduce((total, it) => total + it.missed, 0));
            return;
        }
        const parts = cause.cause!.data.copies;
        const of = (key: 'missed' | 'gap_from_copy_before' | 'machine_full') => parts.reduce((total, it) => total + (it[key] ?? 0), 0);
        expect(sum(['gap', 'full', 'both', 'neither'])).toBe(of('missed'));
        expect(sum(['gap', 'both'])).toBe(of('gap_from_copy_before'));
        expect(sum(['full', 'both'])).toBe(of('machine_full'));
    });

    it('gives a part copy (chemical science 240, 5.5 copies) a chip of its own, the last, its head saying so', () => {
        const kept = CAUSES.find(it => it.sample === 'CHEMICAL_SCIENCE_240_SHARED_FOUNDRY' && it.id === 'takt_batches_observed')!;
        const checked = { line: { copies: kept.copies }, rows: [], cause: kept.cause } as unknown as CheckedLanes & { cause: SharedLaneCause };
        const { container } = show(<SharedLaneCauseParts checked={checked} lanes={[]} />);
        const chips = [...container.querySelectorAll('[data-picture="copies"] [data-chip]')].map(it => it.getAttribute('data-chip'));
        expect(chips.slice(0, 6)).toEqual(['0', '456', '0', '0', '0', '0']);
        expect(container.querySelector('[data-picture="copies"]')!.textContent).toContain(MISSED_SWINGS_COPY.partCopy(6, false));
    });

    it('has the 14 clocks with a cause of the five samples', () => {
        expect(CAUSES).toHaveLength(14);
    });
});
