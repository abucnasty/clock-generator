import { describe, expect, it } from 'vitest';
import type { CheckedLaneRow, CheckedLanes, ClockInsight, LaneNotCheckedReason } from 'clock-generator/browser';
import { AUTOMATION_240, checkedOf, ELECTROMAGNETIC_330, ELECTROMAGNETIC_330_TWO_SWINGS, MILITARY_240, STATES, viewOf, viewsOf } from '../test/checkedLanesFixtures';
import { CHECKED_LANES_COPY, descriptionShown, endText, givesLanes, insightsShown, laneOf, madeForLead, lanesCountText, laneText, roleText, rowSentenceShown, stateLabelOf, stateSentence, stateTone, supplyText, togetherText, whyNotStableShowsCause, withOtherClocksOf } from './checkedLanes';

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

it('says what a clock kept before the engine gave the lanes was made for, without the belts; nothing for one that gives them (Makes says the copies)', () => {
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

describe('the words of a row of a build of one copy', () => {
    const named = (id: number) => `Inserter ${id} into machine ${(id + 1) / 2}`;
    const none = { named, takers: [], item: undefined };

    it.each(Object.keys(STATES))('%s: no word about a copy in its label, its sentence or the count it adds to', key => {
        const { row } = STATES[key];
        const words = [stateLabelOf(row, true), stateSentence(row, none), rowSentenceShown(row, none) ?? '', lanesCountText([row], true)].join(' ');
        expect(words).not.toMatch(/cop(y|ies)/i);
    });

    it('names each inserter that misses swings on the lane of the row, where the cause says which', () => {
        const row = { ...STATES.short.row, state: { kind: 'short', copies: [{ copy: 1, missed: 12, swings: 130 }] } } as CheckedLaneRow;
        const takers = [
            { inserter_id: 3, items: [{ item: 'copper-plate', missed: 9, swings: 65 }, { item: 'iron-gear-wheel', missed: 7, swings: 65 }] },
            { inserter_id: 5, items: [{ item: 'copper-plate', missed: 3, swings: 65 }] },
        ];
        expect(stateSentence(row, { named, takers, item: 'copper-plate' })).toBe('Inserter 3 into machine 2 misses 9 of 65 swings. Inserter 5 into machine 3 misses 3 of 65 swings.');
        // the figures of the cause do not add up to the row's: only the row's count
        expect(stateSentence(row, { named, takers, item: 'iron-gear-wheel' })).toBe('12 of 130 swings missed.');
        expect(stateSentence(row, none)).toBe('12 of 130 swings missed.');
    });

    it('words the labels of the states that name copies, and keeps the others', () => {
        expect(stateLabelOf(STATES.short.row, true)).toBe('Swings missed');
        expect(stateLabelOf(STATES.join_full.row, true)).toBe('Join full');
        expect(stateLabelOf(STATES.takes_less.row, true)).toBe('Inserters take less');
        expect(stateLabelOf(STATES.not_run.row, true)).toBe('Not run together');
        expect(stateLabelOf(STATES.holds.row, true)).toBe(STATES.holds.row.label);
        expect(stateLabelOf(STATES.rate_fits.row, true)).toBe(STATES.rate_fits.row.label);
        // more copies: the engine's, word for word
        for (const { row } of Object.values(STATES)) expect(stateLabelOf(row, false)).toBe(row.label);
    });

    it('words why a lane was not checked or not run, for each reason, in the words of inserters', () => {
        const reasonRow = (reason: LaneNotCheckedReason) => ({ state: { kind: 'not_checked', reason }, sentence: '' }) as unknown as CheckedLaneRow;
        const reasons: LaneNotCheckedReason[] = [{ code: 'one_copy_does_not_hold' }, { code: 'drop_rate_unknown' }, { code: 'drops_more_than_lane_carries', data: { copies: 1 } },
            { code: 'build_drops_onto_belt' }, { code: 'check_stopped', data: { message: 'the belt has no lanes' } }, { code: 'output_belt_not_run' }, { code: 'lane_not_in_model' }];
        for (const reason of reasons) expect(stateSentence(reasonRow(reason), none)).not.toMatch(/cop(y|ies)/i);
        expect(stateSentence(reasonRow({ code: 'check_stopped', data: { message: 'the belt has no lanes' } }), none)).toBe('The lanes several inserters take from could not be checked: the belt has no lanes.');
        expect(stateSentence(reasonRow({ code: 'check_stopped', data: { message: 'the belt has no lanes' } }))).toBe('The lanes its copies share could not be checked: the belt has no lanes.');
    });

    it('counts "not run together" in the heading', () => {
        expect(lanesCountText([STATES.not_run.row], true)).toBe('1 lane · not run together');
        expect(lanesCountText([STATES.not_run.row])).toBe('1 lane · not run with the copies');
    });

    it('heads the column of the plan "Planned for all inserters", and keeps the copies for more copies, a part copy too', () => {
        expect(CHECKED_LANES_COPY.columns.together(1)).toBe('Planned for all inserters');
        expect(CHECKED_LANES_COPY.columns.together(9)).toBe('Planned for the 9 copies');
        expect(CHECKED_LANES_COPY.columns.together(5.5)).toBe('Planned for the 5.5 copies');
    });
});

describe('the note on the spacing of drops, for a build of one copy', () => {
    const note = (gap: string) => ({ id: 'drop-spacing', title: 'Drops onto the automation science pack belt land on each other', what: '', why: '', explanation: '',
        table: { columns: ['Inserters', 'Hands each window cycle', 'Tiles between copies', 'Belt tiles in a window cycle'], rows: [['5 and 13', '4', gap, '9']] } }) as unknown as ClockInsight;

    it('has no column on the gap between copies where every row has a dash for it', () => {
        expect(insightsShown({ insights: [note('-')], copies: 1 })[0].table).toEqual({ columns: ['Inserters', 'Hands each window cycle', 'Belt tiles in a window cycle'], rows: [['5 and 13', '4', '9']] });
    });

    it('keeps the column where a row has a figure, and for more copies', () => {
        expect(insightsShown({ insights: [note('9')], copies: 1 })[0].table!.columns).toContain('Tiles between copies');
        expect(insightsShown({ insights: [note('-')], copies: 3 })[0].table!.columns).toContain('Tiles between copies');
        const insights = [note('-')];
        expect(insightsShown({ insights })).toBe(insights);
    });
});
