import { describe, expect, it } from 'vitest';
import type { CheckedLanes } from 'clock-generator/browser';
import { AUTOMATION_240, checkedOf, MILITARY_240, STATES, viewOf, viewsOf } from '../test/checkedLanesFixtures';
import { endText, givesLanes, laneOf, lanesCountText, laneText, roleText, stateTone, supplyText, togetherText, withOtherClocksOf } from './checkedLanes';

const lanes = AUTOMATION_240.lanes;

describe('the cells of a row, made from its data', () => {
    const [output, gears, copper] = checkedOf(AUTOMATION_240, 'takt_batches_observed').rows;

    it('name the lane by its numbers, its role and its end, marked where its role gave it', () => {
        expect([gears, copper, output].map(laneText)).toEqual(['Belt 1, lane 1', 'Belt 1, lane 2', 'Belt 2, lane 1']);
        expect([gears, output].map(row => roleText(laneOf(lanes, row)))).toEqual(['Input', 'Output']);
        // the config states the input lane's end; the output lane's comes from its role
        expect(endText(laneOf(lanes, gears))).toEqual({ value: 'Dead end' });
        expect(endText(laneOf(lanes, output))).toEqual({ value: 'Infinite', sub: 'from its role' });
    });

    it('say what the copies take or drop together, and the supply rate, or what an output lane carries', () => {
        expect(togetherText(gears)).toEqual({ value: 'take 120 /s' });
        expect(togetherText(output)).toEqual({ value: 'drop 240 /s', sub: 'on lanes 1 and 2' });
        expect(supplyText(gears, laneOf(lanes, gears))).toEqual({ value: '120 /s', sub: 'lane capacity' });
        expect(supplyText(output, laneOf(lanes, output))).toEqual({ value: '—', sub: 'carries 240 /s' });
    });

    it('give every state a tone beside its label', () => {
        expect(Object.fromEntries(Object.entries(STATES).map(([key, { row }]) => [key, stateTone(row.state)]))).toEqual({
            'holds': 'holds', 'holds/join_waits': 'holds', 'holds/steady_run_only': 'holds', 'holds/steady_run_only/join_waits': 'holds',
            'holds/not_the_cause/join_waits': 'quiet', 'short': 'loss', 'join_full': 'loss', 'takes_less': 'caution', 'rate_fits': 'caution',
            'not_checked': 'quiet', 'not_run': 'quiet',
        });
    });
});

describe('the count beside the heading', () => {
    it('counts the lanes and their states, and says "all hold" only where every row holds', () => {
        expect(lanesCountText(checkedOf(AUTOMATION_240, 'time_study_windows').rows)).toBe('3 lanes · all hold');
        expect(lanesCountText(checkedOf(AUTOMATION_240, 'takt_batches_observed').rows)).toBe('3 lanes · 1 join full · 2 take less');
        expect(lanesCountText(checkedOf(AUTOMATION_240, 'euclidean_swings').rows)).toBe('3 lanes · 2 short · 1 not the cause');
        expect(lanesCountText(checkedOf(MILITARY_240, 'coordinated_sources').rows)).toBe('6 lanes · 2 by rate only · 4 hold');
        expect(lanesCountText(checkedOf(AUTOMATION_240, 'takt_batches_observed_swings_4').rows)).toBe('3 lanes · not run with the copies');
    });
});

describe('the other clock a cause names', () => {
    /** The views as the worker gives them: the cause's "what changes it" without the other clock, which the page adds */
    const asWorkerGives = () => viewsOf(AUTOMATION_240).map(view => view.checkedLanes?.cause
        ? { ...view, checkedLanes: { ...view.checkedLanes, cause: { ...view.checkedLanes.cause, changes: null } } as CheckedLanes } : view);

    it('is the sentence the engine ends "what changes it" with, for a lane and for a join', () => {
        const views = asWorkerGives();
        const named = withOtherClocksOf(views, AUTOMATION_240.selected_index);
        for (const id of ['euclidean_swings', 'takt_batches_observed']) {
            const engine = checkedOf(AUTOMATION_240, id).cause!.changes!;
            const page = named.find(view => view.id === id)!.checkedLanes!.cause!.changes!;
            expect(engine.text.endsWith(page.text)).toBe(true);
            expect(page.data.other_clock).toEqual(engine.data.other_clock);
        }
        // a clock with no cause is the clock it was
        const stable = views.findIndex(view => view.id === 'time_study_windows');
        expect(named[stable]).toBe(views[stable]);
    });

    it('leaves the clocks as they are where none has a cause', () => {
        const views = viewsOf(MILITARY_240);
        expect(withOtherClocksOf(views, MILITARY_240.selected_index)).toBe(views);
    });
});

it('tells a clock of an engine that gives the lanes from one kept before', () => {
    const view = viewOf(AUTOMATION_240, 'time_study_windows');
    expect(givesLanes(view)).toBe(true);
    expect(givesLanes({ ...view, assumptions: { ...view.assumptions, lanes: undefined } })).toBe(false);
});
