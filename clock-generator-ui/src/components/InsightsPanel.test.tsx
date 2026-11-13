// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockInsight } from 'clock-generator/browser';
import type { ShiftOptionsView } from '../worker/types';
import { show } from '../test/fixtures';
import { DetailsPanel } from './DetailsPanel';
import { InsightCard, InsightsPanel } from './InsightsPanel';

describe('an insight with no reason', () => {
    // the insight of a clock above the expected output, as the engine gives it; Diagnostics shows it as a card
    const overproduces = {
        id: 'unstable', scope: 'clock' as const, title: 'This clock overproduces',
        what: 'Driven only by its enable windows, the build moved 352 of 336 items in a window cycle.', why: '', explanation: 'Use a clock marked Stable.',
    };

    it('shows what was measured and, under it, what to do: no "Why?" button and no Why part', () => {
        const { container } = show(<InsightCard insight={overproduces} />);
        expect(screen.queryByRole('button', { name: 'Why?' })).toBeNull();
        expect(screen.getByText(overproduces.what)).toBeTruthy();
        expect(screen.getByText('Use a clock marked Stable.')).toBeTruthy();
        expect(screen.getByText('Explanation')).toBeTruthy();
        expect(screen.queryByText('Why')).toBeNull();
        const text = container.querySelector('[data-insight="unstable"]')!.textContent!;
        expect(text.indexOf(overproduces.what)).toBeLessThan(text.indexOf('ExplanationUse a clock marked Stable.'));
    });
});

describe('an insight with a reason', () => {
    const underproduces = {
        id: 'unstable', scope: 'clock' as const, title: 'This clock underproduces',
        what: 'Driven only by its enable windows, the build moved 320 of 336 items in a window cycle.',
        why: 'A clock has to work from wherever the machines happen to be when it starts.', explanation: 'Use a clock marked Stable.',
    };

    it('keeps its Why and Explanation behind "Why?", as before', async () => {
        const { user } = show(<InsightCard insight={underproduces} />);
        const why = screen.getByRole('button', { name: 'Why?' });
        expect(why.getAttribute('aria-expanded')).toBe('false');
        await user.click(why);
        expect(why.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText(underproduces.why)).toBeTruthy();
        expect(screen.getByText('Why')).toBeTruthy();
        expect(screen.getByText('Explanation')).toBeTruthy();
    });
});

describe('a note with no explanation', () => {
    // the note of a build whose lanes are exactly full, as the engine gives it: no why and no explanation
    const exactlyFull = {
        id: 'lanes-exactly-full', scope: 'build' as const, title: 'Both lanes of the belt are exactly full',
        what: 'Both lanes of the automation science pack belt are exactly full at the setpoint.', why: '', explanation: '',
    };

    it('shows what it says and no Explanation label', () => {
        const { container } = show(<InsightsPanel insights={[exactlyFull]} />);
        expect(screen.getByText(exactlyFull.what)).toBeTruthy();
        expect(screen.queryByText('Explanation')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Why?' })).toBeNull();
        expect(container.querySelector('[data-insight="lanes-exactly-full"]')!.textContent).toContain(exactlyFull.what);
    });
});

/** Each kind of note the engine makes for a clock and Overview shows, with its words as the engine writes them (insights.ts, drop-spacing.ts) */
const NOTES = {
    wakeUps: {
        id: 'wake-ups', scope: 'clock', title: 'Machines wake the inserters 192.1 times a minute',
        what: 'In a long run of this clock the machines of one copy of the build woke its inserters 192.1 times a minute.',
        why: 'An enabled inserter with nothing to move sleeps on the wakeup list of the machine it waits on.',
        explanation: 'Each wakeup is a check that moves little or nothing.',
        table: { columns: ['Inserter', 'Between', 'Wakeups a minute', 'Most it could be woken a minute', 'On', 'On and waiting'],
            rows: [['Inserter 1', 'iron gear wheel belt to assembling machine 3', '158.7', '878', '39.4%', '15.3%']] },
    },
    wakeUpsFromStarts: {
        id: 'wake-ups', scope: 'clock', title: 'Machines wake the inserters 40.2 times a minute on average',
        what: 'With a loop in the build, how often depends on where the clock is when the build starts: 30 to 50 times a minute from 4 start points, 40.2 on average.',
        why: 'An enabled inserter with nothing to move sleeps on the wakeup list of the machine it waits on.',
        explanation: 'A build with a loop can settle into more than one steady state.',
        table: { columns: ['Inserter', 'Between', 'Wakeups a minute', 'Most it could be woken a minute', 'On', 'On and waiting'], rows: [['Inserter 2', '', '40.2', '80', '50%', '10%']] },
    },
    backpressureLoss: {
        id: 'backpressure-loss', scope: 'clock', title: 'This clock does not go back to its rate by itself after a supply stop or an output blockage',
        what: 'This clock moves its 12 items every window cycle for as long as nothing runs out and nothing backs up.',
        why: 'When an item stops arriving, or the output is not taken away, the machines run dry or fill up.',
        explanation: 'Such a build has to be restarted by hand after an input ran out or the output backed up. Use a clock marked Stable.',
    },
    startDependence: {
        id: 'start-dependence', scope: 'clock', title: 'This clock depends on how it is started',
        what: 'start-dependent: reaches 4/s from cold; settles at 30 a window cycle (3.5/s) from phase-90.',
        why: 'The simulator tried empty machines with initial clock phases and competing-taker orders: cold; phase-90.',
        explanation: 'The sampled outcomes above show which starts reached the target.',
    },
    dropsLand: {
        id: 'drop-spacing', scope: 'clock', title: 'Drops onto the automation science pack belt (belt 2) land on each other',
        what: 'In every window cycle of 72 ticks, the inserters (10 and 14) that drop automation science pack drop 4 hands onto the automation science pack belt (belt 2).',
        why: 'A hand dropped where items already lie waits until they have moved on.',
        explanation: 'The simulator does not count this wait.',
        table: { columns: ['Inserters', 'Hands each window cycle', 'Tiles between copies', 'Belt tiles in a window cycle', 'Pairs landing on each other', 'Longest wait (ticks)'],
            rows: [['10 and 14', '4', '-', '9', '2', '16'], ['18', '2', '-', '9', '0', '0']] },
    },
    dropsFit: {
        id: 'drop-spacing', scope: 'clock', title: 'Drops onto the automation science pack belt (belt 2) fit between each other',
        what: 'In every window cycle of 72 ticks, the inserters (1, 2 and 3) that drop automation science pack drop 3 hands onto the automation science pack belt (belt 2), and each hand lands on a stretch of belt of its own, so none waits.',
        why: 'A hand dropped where items already lie waits until they have moved on.',
        explanation: 'This holds for this spacing and these start ticks.',
        table: { columns: ['Inserters', 'Hands each window cycle', 'Tiles between copies', 'Belt tiles in a window cycle', 'Pairs landing on each other', 'Longest wait (ticks)'],
            rows: [['1, 2 and 3', '3', '12', '14', '0', '0']] },
    },
    drillsJustInTime: {
        id: 'chest-drill-windows', scope: 'clock', title: 'The drills into containers are enabled just in time',
        what: 'Drill 1 drops iron ore into iron chest 2 and is enabled 30 ticks of the 120-tick window cycle, in 2 enable windows.',
        why: 'A drill mines into a hold of its own.', explanation: 'Each enable window ends the tick before an inserter takes from the chest.',
    },
    drillsAlwaysEnabled: {
        id: 'chest-drill-windows', scope: 'clock', title: 'The drills into containers are always enabled',
        what: 'Drill 1 drops iron ore into iron chest 2 and is always enabled: nothing times it.',
        why: 'A drill mines into a hold of its own.', explanation: 'A drill stays always enabled where nothing times it.',
    },
    someDrillsAlwaysEnabled: {
        id: 'chest-drill-windows', scope: 'clock', title: 'Some drills into containers are always enabled',
        what: 'Drill 1 drops iron ore into iron chest 2 and is always enabled: nothing times it. Drill 3 drops coal into iron chest 4 and is enabled 10 ticks of the 120-tick window cycle, in 1 enable window.',
        why: 'A drill mines into a hold of its own.', explanation: 'A drill stays always enabled where nothing times it.',
    },
} satisfies Record<string, ClockInsight>;

/** Each kind's mark and chips: caution where the note names something to do, information where it names nothing */
const LINES: [keyof typeof NOTES, 'Caution' | 'Information', string[]][] = [
    ['wakeUps', 'Information', []],
    ['wakeUpsFromStarts', 'Information', []],
    ['backpressureLoss', 'Caution', []],
    ['startDependence', 'Caution', []],
    ['dropsLand', 'Caution', ['10', '14']],
    ['dropsFit', 'Information', ['1', '2', '3']],
    ['drillsJustInTime', 'Information', []],
    ['drillsAlwaysEnabled', 'Information', []],
    ['someDrillsAlwaysEnabled', 'Information', []],
];

describe('the notes on this clock, one line each', () => {
    it.each(LINES)('shows %s as one line: its mark, its title, its inserters as chips and Details; nothing more', (kind, mark, chips) => {
        const note = NOTES[kind];
        const { container } = show(<InsightsPanel insights={[note]} />);
        const line = screen.getByRole('group', { name: note.title });
        expect(line.getAttribute('data-insight')).toBe(note.id);
        expect(within(line).getByTitle(mark)).toBeDefined();
        expect(within(line).getByText(note.title)).toBeDefined();
        const list = within(line).queryByRole('list', { name: 'Inserters' });
        expect(list === null ? [] : within(list).getAllByRole('listitem').map(chip => chip.textContent)).toEqual(chips);
        // a chip here is no button: the results have no step to the inserter's row
        expect(within(line).getAllByRole('button').map(button => button.textContent)).toEqual(['Details']);
        // the rest is in the window: no card, no "Why?", none of the engine's sentences on the page
        expect(screen.queryByRole('button', { name: 'Why?' })).toBeNull();
        expect(container.textContent).not.toContain(note.what);
        expect(container.querySelector('table')).toBeNull();
    });

    it('opens the window from Details: the table first, then what, why and the explanation, as the engine words them', async () => {
        const note = NOTES.dropsLand;
        const { user } = show(<InsightsPanel insights={[note]} />);
        await user.click(within(screen.getByRole('group', { name: note.title })).getByRole('button', { name: 'Details' }));
        const window = screen.getByRole('dialog', { name: note.title });
        const table = within(window).getByRole('table');
        expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(note.table.columns);
        expect(within(table).getAllByRole('row')).toHaveLength(3);
        const terms = within(window).getAllByRole('term');
        expect(terms.map(term => term.textContent)).toEqual(['What', 'Why', 'Explanation']);
        // the table stands before the words
        expect(table.compareDocumentPosition(terms[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(window).getByText(note.what)).toBeDefined();
        expect(within(window).getByText(note.why)).toBeDefined();
        expect(within(window).getByText(note.explanation)).toBeDefined();
        // the title is the window's name, and not said again in it
        expect(window.querySelector('.MuiDialogContent-root')!.textContent).not.toContain(note.title);
    });

    it('gives a note without a table its words alone, and leaves out a part the engine leaves empty', async () => {
        const note = { ...NOTES.backpressureLoss, why: '' };
        const { user } = show(<InsightsPanel insights={[note]} />);
        await user.click(screen.getByRole('button', { name: 'Details' }));
        const window = screen.getByRole('dialog', { name: note.title });
        expect(within(window).queryByRole('table')).toBeNull();
        expect(within(window).getAllByRole('term').map(term => term.textContent)).toEqual(['What', 'Explanation']);
        expect(within(window).getByText(note.explanation)).toBeDefined();
    });

    it('closes the window on Escape and gives the focus back to Details', async () => {
        const { user } = show(<InsightsPanel insights={[NOTES.wakeUps]} />);
        const details = screen.getByRole('button', { name: 'Details' });
        await user.click(details);
        expect(screen.getByRole('dialog', { name: NOTES.wakeUps.title })).toBeDefined();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(() => expect(document.activeElement).toBe(details));
    });

    it('lists the lines in the order the engine gives the notes', () => {
        show(<InsightsPanel insights={[NOTES.wakeUps, NOTES.backpressureLoss, NOTES.dropsLand]} />);
        expect(screen.getAllByRole('group').map(line => line.getAttribute('aria-label')))
            .toEqual([NOTES.wakeUps.title, NOTES.backpressureLoss.title, NOTES.dropsLand.title]);
    });

    it('says that nothing stands out, and no more, when the clock has no note', () => {
        const { container } = show(<InsightsPanel insights={[]} />);
        expect(container.textContent).toContain('Nothing stands out on this clock.');
        expect(container.textContent).not.toContain('swings as planned');
    });
});

describe('where the swings a clock moved can go', () => {
    const options: ShiftOptionsView = {
        moved: 'output-swing', chosenIndex: 1, chosenShiftTicks: -4, movedDescription: 'the output swing', plannedTicks: null,
        rows: [{ index: 1, shifts: [-8, -4, 0, 4].map(shift_ticks => ({ shift_ticks, holds: shift_ticks !== 4 })) }],
        earliest: { shift_ticks: -8, is_search_limit: true, notes: [] }, latest: { shift_ticks: 0, is_search_limit: false, notes: ['Machine 2 is at its insertion limit'] },
    };

    const details = (shiftOptions: ShiftOptionsView) => show(<DetailsPanel insights={[]} shiftOptions={shiftOptions} swingBackoffReport={null} fuelView={null} />);

    it('is one line with an information mark; its window holds the picture first, then the words', async () => {
        const { user, container } = details(options);
        const line = screen.getByRole('group', { name: 'Where the output swing can go' });
        expect(within(line).getByTitle('Information')).toBeDefined();
        expect(container.textContent).not.toContain('Earliest that works');
        expect(container.textContent).not.toContain('Nothing stands out');
        await user.click(within(line).getByRole('button', { name: 'Details' }));
        const window = screen.getByRole('dialog', { name: 'Where the output swing can go' });
        const picture = window.querySelector('[data-shift-chart]')!;
        const words = within(window).getByText(/^This clock moves the output swing/);
        expect(picture.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(window).getByText(/Earliest that works/)).toBeDefined();
        expect(within(window).getByText('• Machine 2 is at its insertion limit')).toBeDefined();
    });

    it('is no line, and the clock has nothing that stands out, where no place was tried', () => {
        const { container } = details({ ...options, rows: [] });
        expect(screen.queryByRole('group')).toBeNull();
        expect(container.textContent).toContain('Nothing stands out on this clock.');
    });
});
