import { describe, expect, it } from 'vitest';
import type { CheckedLanes } from 'clock-generator/browser';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330, ELECTROMAGNETIC_330_TWO_SWINGS, MILITARY_240, STATES, viewOf, viewsOf } from '../test/checkedLanesFixtures';
import { CHECKED_LANES_COPY, descriptionShown, endText, givesLanes, insightsShown, laneOf, madeForLead, lanesCountText, laneText, roleText, rowSentenceShown, stateSentence, stateTone, supplyText, togetherText, whyNotStableShowsCause, withOtherClocksOf } from './checkedLanes';

const lanes = AUTOMATION_240.lanes;

describe('the cells of a row, made from its data', () => {
    const [output, gears, copper] = checkedOf(AUTOMATION_240, 'takt_batches_observed').rows;

    it('name the lane by its numbers, its role and its end, marked where its role gave it', () => {
        expect([gears, copper, output].map(laneText)).toEqual(['Belt 1, lane 1', 'Belt 1, lane 2', 'Belt 2, lane 1']);
        expect([gears, output].map(row => roleText(laneOf(lanes, row)))).toEqual(['Input', 'Output']);
        // the config states the input lane's end; the output lane's comes from its role
        expect(endText(laneOf(lanes, gears))).toEqual({ value: 'Dead end' });
        expect(endText(laneOf(lanes, output))).toEqual({ value: 'Infinite', sub: 'assumed from its role' });
    });

    it('are under a header that says they are the plan, with the build\'s copies as the header writes them, a part copy too', () => {
        expect(CHECKED_LANES_COPY.columns.together(9)).toBe('Planned for the 9 copies');
        expect(CHECKED_LANES_COPY.columns.together(5.5)).toBe('Planned for the 5.5 copies');
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
        expect(lanesCountText(checkedOf(AUTOMATION_240, 'euclidean_swings').rows)).toBe('3 lanes · 2 with missed swings · 1 not the cause');
        expect(lanesCountText(checkedOf(MILITARY_240, 'coordinated_sources').rows)).toBe('6 lanes · 2 by rate only · 4 hold');
        expect(lanesCountText(checkedOf(AUTOMATION_240, 'takt_batches_observed_swings_4').rows)).toBe('3 lanes · not run with the copies');
        // where every lane has a copy that misses swings, the count is the only state
        expect(lanesCountText([STATES.short.row, STATES.short.row])).toBe('2 lanes · with missed swings');
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

describe('what is said once', () => {
    it('leaves the engine\'s loss note out of the description of a clock whose cause the page shows, word for word, and nothing else', () => {
        const short = viewOf(AUTOMATION_240, 'euclidean_swings');
        const note = short.sharedLaneLossNote!;
        expect(short.description).toContain(note);
        expect(descriptionShown(short)).toBe(short.description.replace(` ${note}`, ''));
        expect(descriptionShown(short)).not.toContain('It is not stable on a lane its copies share.');
        // a clock with no cause, or kept before the note was carried, keeps its description
        const stable = viewOf(AUTOMATION_240, 'time_study_windows');
        expect(descriptionShown(stable)).toBe(stable.description);
        expect(descriptionShown({ ...short, sharedLaneLossNote: undefined })).toBe(short.description);
    });

    it('leaves out the insight on a lane the build drops onto where a row of that lane is not checked', () => {
        const { row, insights } = STATES.not_checked;
        const clock = { insights: insights!, checkedLanes: { rows: [row] } as CheckedLanes };
        expect(insightsShown(clock).map(insight => insight.id)).toEqual(['shared-lane-not-checked-1-2']);
        expect(insightsShown({ ...clock, checkedLanes: undefined })).toBe(insights);
    });

    it('shows the parts in the note on why no clock is stable where it is of the recommended clock\'s shared-lane loss', () => {
        const result = ELECTROMAGNETIC_330_TWO_SWINGS;
        const recommended = viewOf(result, result.clocks[result.selected_index].id);
        expect(result.why_not_stable?.cause).toBe('shared lane short');
        expect(whyNotStableShowsCause(result.why_not_stable, recommended)).toBe(true);
        expect(whyNotStableShowsCause({ cause: 'moving lane phases' }, recommended)).toBe(false);
        expect(whyNotStableShowsCause(result.why_not_stable, { ...recommended, checkedLanes: undefined })).toBe(false);
    });
});

it('says what a clock kept before the engine gave the lanes was made for, without the belts; the card says it for one that gives them', () => {
    const view = viewOf(AUTOMATION_240, 'time_study_windows');
    const kept = { ...view, assumptions: { ...view.assumptions, lanes: undefined } };
    const saved = { setpoint: { recipe: 'automation-science-pack', items_per_second: 240, copies: 9 } };
    expect(madeForLead(saved, kept)).toBe('Made for 9 copies of your build.');
    expect(madeForLead(saved, view)).toBe('');
    expect(madeForLead(null, kept)).toBe('These results are for a saved build whose metadata is unavailable.');
});

describe('the words of a lane not checked or not run with the copies', () => {
    const kept = [AUTOMATION_240, ELECTROMAGNETIC_330, MILITARY_240, ELECTROMAGNETIC_330_TWO_SWINGS];
    const rows = [...kept.flatMap(result => result.clocks.flatMap(clock => clock.checked_lanes?.rows ?? [])), ...Object.values(STATES).map(it => it.row)]
        .filter(row => row.state.kind === 'not_checked' || row.state.kind === 'not_run');

    it('are the engine\'s sentence, word for word, for every such row of the fixtures, from its code', () => {
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect('reason' in row.state && typeof row.state.reason).toBe('object');
            expect(stateSentence(row)).toBe(row.sentence);
        }
    });

    it('show the sentence of a result whose reason is a sentence (an older engine)', () => {
        const row = { state: { kind: 'not_checked', reason: 'The check of the shared lanes does not run this lane.' }, sentence: 'The check of the shared lanes does not run this lane.' };
        expect(stateSentence(row as unknown as Parameters<typeof stateSentence>[0])).toBe(row.sentence);
    });
});

describe('the sentence under a row\'s state, by the state\'s kind', () => {
    // shown: the sentence adds a fact; hidden: the label or the tab's headline says it
    it.each([
        ['holds', false],
        ['holds/steady_run_only', false],
        ['holds/join_waits', true],
        ['holds/not_the_cause/join_waits', true],
        ['holds/steady_run_only/join_waits', true],
        ['join_full', false],
        ['short', true],
        ['takes_less', true],
        ['rate_fits', true],
        ['not_checked', true],
        ['not_run', false],
    ] as const)('%s: shown %s', (key, shown) => {
        const { row } = STATES[key];
        expect(rowSentenceShown(row)).toBe(shown ? stateSentence(row) : null);
    });

    it('keeps a full join\'s sentence where its copies miss different counts, as the tab\'s headline does not say one count', () => {
        const { row } = STATES.join_full;
        if (row.state.kind !== 'join_full') throw new Error('the fixture is not a full join');
        const differ = { ...row, state: { ...row.state, copies: [row.state.copies[0], { ...row.state.copies[1], missed: 40 }] } };
        expect(rowSentenceShown(differ)).toBe(differ.sentence);
        const one = { ...row, state: { ...row.state, copies: [row.state.copies[0]] } };
        expect(rowSentenceShown(one)).toBeNull();
    });
});
