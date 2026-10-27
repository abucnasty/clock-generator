import { describe, expect, it } from 'vitest';
import type { AlwaysOnReason } from 'clock-generator/browser';
import * as copy from './wakeWindowCopy';
import {
    MOSTLY_ON_SHARE,
    SHORT_WINDOW_TICKS,
    WAKE_UP_DEFINITION,
    WAKE_UPS_COLUMN_HELP,
    WAKE_WINDOW_DEFINITION,
    alwaysOnText,
    lengthText,
    onForText,
    periodText,
    rowSummary,
    summaryText,
    watchNotes,
    windowDetails,
} from './wakeWindowCopy';
import { normalizeWindows, type WakeWindow, type WakeWindowRow } from './wakeWindows';

function windowsOf(spans: { start: number; end: number }[], period: number, slackTicks = 0): WakeWindow[] {
    return normalizeWindows(spans, period).map(window => ({ ...window, slackTicks: Math.min(slackTicks, window.length) }));
}

function row(extra: Partial<WakeWindowRow> = {}): WakeWindowRow {
    const windows = extra.windows ?? windowsOf([{ start: 212, end: 240 }], 600);
    const onTicks = windows.reduce((sum, window) => sum + window.length, 0);
    return {
        id: 'inserter:3',
        kind: 'inserter',
        number: 3,
        label: 'Inserter 3',
        items: ['iron-plate'],
        route: 'Belt 1 to Machine 2',
        windows,
        mode: 'windows',
        onTicks,
        onShare: onTicks / 600,
        wakeUpsPerMinute: 12.345,
        ...extra,
    };
}

const BAD_OUTPUT = /NaN|undefined|\d\.\d{4,}/;
const ctx: { periodTicks: number; mostWakeUpsId: string | null } = { periodTicks: 600, mostWakeUpsId: null };

describe('periodText and lengthText', () => {
    it('reads ticks with seconds', () => {
        expect(periodText(600)).toBe('600 ticks (10 s)');
        expect(periodText(550.957)).toBe('550.96 ticks (9.18 s)');
        expect(lengthText(29)).toBe('29 ticks, 0.48 s');
        expect(lengthText(1)).toBe('1 tick, 0.02 s');
    });
});

describe('onForText', () => {
    it('says it is a share of the clock period', () => {
        expect(onForText(0.17)).toBe('On for 17% of the clock period');
    });
});

describe('summaryText', () => {
    it('gives the period, the rows and the wake-ups', () => {
        expect(summaryText({ periodTicks: 600, inserters: 14, drills: 2, wakeUps: 372.4 }))
            .toBe('Clock period 600 ticks (10 s) · 14 inserters and 2 drills · 372 wake-ups a minute for one copy');
        expect(summaryText({ periodTicks: 600, inserters: 1, drills: 0, wakeUps: null }))
            .toBe('Clock period 600 ticks (10 s) · 1 inserter · Wake-ups not counted');
    });
});

describe('rowSummary', () => {
    it('names the items by their game names when given a label function', () => {
        const text = rowSummary(row(), 600, { mostWakeUpsId: null, itemLabel: id => (id === 'iron-plate' ? 'Iron plate' : id) });
        expect(text).toContain('Inserter 3, Iron plate: Belt 1 to Machine 2.');
    });

    it('reads one window', () => {
        const text = rowSummary(row(), 600);
        expect(text).toBe('Inserter 3, iron-plate: Belt 1 to Machine 2. 1 wake window: ticks 212–240. '
            + 'On for 5% of the clock period of 600 ticks (10 s). Wake-ups/min: 12.3.');
    });

    it('reads several windows, with their belt slack', () => {
        const text = rowSummary(row({ windows: windowsOf([{ start: 0, end: 28 }, { start: 100, end: 120 }, { start: 300, end: 310 }], 600, 4) }), 600);
        expect(text).toContain('3 wake windows: ticks 0–28, 100–120 and 300–310, the last 4 ticks of each are belt slack.');
    });

    it('reads a wrapped window', () => {
        expect(rowSummary(row({ windows: windowsOf([{ start: 0, end: 4 }, { start: 590, end: 599 }], 600) }), 600))
            .toContain('1 wake window: ticks 590–4 (next clock period).');
    });

    it('caps the windows it lists', () => {
        const spans = Array.from({ length: 7 }, (_, index) => ({ start: index * 50, end: index * 50 + 9 }));
        const text = rowSummary(row({ windows: windowsOf(spans, 600) }), 600);
        expect(text).toContain('7 wake windows: ticks 0–9, 50–59, 100–109, 150–159 and 3 more.');
    });

    it('names why a row is always on, in the engine\'s words where it gives a reason, and the old words where it gives none', () => {
        const on = (alwaysOnReason?: AlwaysOnReason) => rowSummary(row({ mode: 'always-on', windows: [], onShare: 1, alwaysOnReason }), 600);
        expect(on()).toContain('Always on: not on the clock. On for 100%');
        expect(on({ kind: 'busy', period_ticks: 24 }))
            .toContain('Always on: its swings fill the whole clock period (24 ticks), so a wake window would never switch it off. On for 100%');
        expect(on({ kind: 'busy', period_ticks: 1 })).toContain('(1 tick)');
    });

    it('has a sentence for every reason the engine gives', () => {
        const whys: Extract<AlwaysOnReason, { kind: 'chest-drill' }>['why'][] = [
            { kind: 'other-drill', drill_number: 2, item: 'iron-ore' },
            { kind: 'filler', inserter_number: 5, item: 'iron-ore' },
            { kind: 'no-taker', item: 'iron-ore' },
            { kind: 'taker-without-window', inserter_number: 1, item: 'iron-ore' },
            { kind: 'no-take', item: 'iron-ore' },
            { kind: 'no-room', item: 'iron-ore' },
            { kind: 'needs-whole-period' },
            { kind: 'would-cover-period' },
            { kind: 'fallback' },
            { kind: 'windows-did-not-hold' },
            { kind: 'no-window' },
        ];
        const reasons: AlwaysOnReason[] = [
            { kind: 'enable-rule' }, { kind: 'loop' }, { kind: 'from-loop' }, { kind: 'busy', period_ticks: 24 }, { kind: 'no-swing' },
            ...whys.map(why => ({ kind: 'chest-drill' as const, why })),
        ];
        const texts = reasons.map(alwaysOnText);
        for (const text of texts) {
            expect(text).toMatch(/^Always on: [a-z]/);
            expect(text).not.toMatch(BAD_OUTPUT);
            // the game's words, not the engine's: no item ids, no internal kinds
            expect(text).not.toMatch(/iron-ore|chest-drill|enable-rule|from-loop|no-swing|undefined/);
        }
        expect(new Set(texts).size).toBe(reasons.length);
        expect(texts[0]).toBe('Always on: its enable rule is Always on');
        expect(texts[5]).toBe('Always on: drill 2 fills the same chest with the same item, so the clock cannot time this drill on its own');
    });

    it('reads the rows without bars', () => {
        expect(rowSummary(row({ mode: 'always-on', windows: [], onShare: 1 }), 600))
            .toContain('Always on: not on the clock. On for 100%');
        expect(rowSummary(row({ mode: 'never', windows: [], onShare: 0 }), 600)).toContain('Never switched on. On for 0%');
        expect(rowSummary(row({
            mode: 'own-clock',
            windows: [],
            ownClock: { windowTicks: 6, everyTicks: 400, perMinute: 9, item: 'coal' },
            onShare: 6 / 400,
        }), 600)).toContain('Own clock: on 6 ticks every 400 (fuel).');
    });

    it('ends with the row\'s notes, so a screen reader hears them with the row', () => {
        const text = rowSummary(row({ windows: windowsOf([{ start: 212, end: 240 }], 600, 4) }), 600, { mostWakeUpsId: 'inserter:3' });
        expect(text).toMatch(/Wake-ups\/min: 12\.3\. Note: \+4 ticks: the last 4 ticks of each wake window are belt slack, .* Note: Woken most of all the inserters of this clock\.$/);
        expect(rowSummary(row(), 600)).not.toContain('Note:');
    });

    it('says when wake-ups were not counted', () => {
        expect(rowSummary(row({ wakeUpsPerMinute: null }), 600)).toContain('Wake-ups/min: Not counted.');
        expect(rowSummary(row({ kind: 'drill', label: 'Drill 1', wakeUpsPerMinute: null }), 600)).toContain('Wake-ups/min: Not counted for drills.');
    });

    it('never prints NaN, undefined or long decimals', () => {
        const rows = [
            row(),
            row({ windows: windowsOf([{ start: 0, end: 4 }, { start: 540, end: 550.957 }], 550.957, 3), onShare: 16 / 550.957, wakeUpsPerMinute: 1 / 3 }),
            row({ mode: 'always-on', windows: [], onShare: 1, wakeUpsPerMinute: null, items: [], route: '' }),
            row({ mode: 'own-clock', windows: [], ownClock: { windowTicks: 6, everyTicks: 400, perMinute: 9, item: 'coal' }, onShare: 0.015 }),
        ];
        for (const each of rows) {
            expect(rowSummary(each, 550.957)).not.toMatch(BAD_OUTPUT);
        }
    });
});

describe('windowDetails', () => {
    it('gives the ticks, the length and the reaction', () => {
        const details = windowDetails(row({ windows: windowsOf([{ start: 0, end: 9 }, { start: 212, end: 240 }, { start: 400, end: 401 }], 600) }), 1, 600);
        expect(details).toBe('Wake window 2 of 3: ticks 212–240 (29 ticks, 0.48 s). The inserter reacts 2 ticks after the wake window opens.');
    });

    it('gives the belt slack only when there is some', () => {
        const details = windowDetails(row({ windows: windowsOf([{ start: 212, end: 240 }], 600, 4) }), 0, 600);
        expect(details).toBe('Wake window 1 of 1: ticks 212–240 (29 ticks, 0.48 s), of which the last 4 ticks are belt slack. '
            + 'The inserter reacts 2 ticks after the wake window opens.');
    });

    it('says a wrapped window runs on from tick 0', () => {
        const details = windowDetails(row({ windows: windowsOf([{ start: 0, end: 4 }, { start: 590, end: 599 }], 600) }), 0, 600);
        expect(details).toContain('ticks 590–4, past the end of the clock period of 600 ticks (10 s) and on from tick 0 (15 ticks, 0.25 s)');
        expect(details).not.toMatch(BAD_OUTPUT);
    });
});

describe('watchNotes', () => {
    const ids = (r: WakeWindowRow, context = ctx) => watchNotes(r, context).map(note => note.id);

    it('has none for a plain row', () => {
        expect(watchNotes(row(), ctx)).toEqual([]);
    });

    it('notes a row on for 80% of the clock period and not 79%', () => {
        expect(MOSTLY_ON_SHARE).toBe(0.8);
        const on80 = row({ windows: windowsOf([{ start: 0, end: 79 }], 100), onShare: 0.8 });
        const on79 = row({ windows: windowsOf([{ start: 0, end: 78 }], 100), onShare: 0.79 });
        expect(ids(on80)).toContain('mostly-on');
        expect(watchNotes(on80, ctx)[0].text).toBe('On for 80% of the clock period, so the clock switches this one on almost all the time. '
            + 'The wake-ups it saves are few.');
        expect(ids(on79)).not.toContain('mostly-on');
    });

    it('notes belt slack with its ticks', () => {
        const notes = watchNotes(row({ windows: windowsOf([{ start: 212, end: 240 }], 600, 4) }), ctx);
        expect(notes).toEqual([{
            id: 'slack',
            text: '+4 ticks: the last 4 ticks of each wake window are belt slack, so a late pickup from a moving belt can still finish.',
        }]);
    });

    it('notes a window of 4 ticks and not one of 5', () => {
        expect(SHORT_WINDOW_TICKS).toBe(4);
        const four = watchNotes(row({ windows: windowsOf([{ start: 0, end: 9 }, { start: 100, end: 103 }], 600) }), ctx);
        expect(four).toEqual([{ id: 'short', text: 'Wake window 2 is only 4 ticks long. Very short wake windows are sensitive to timing.' }]);
        expect(ids(row({ windows: windowsOf([{ start: 100, end: 104 }], 600) }))).toEqual([]);
        const several = watchNotes(row({ windows: windowsOf([{ start: 0, end: 0 }, { start: 100, end: 102 }], 600) }), ctx);
        expect(several[0].text).toBe('Wake windows 1 and 2 are 4 ticks long or shorter. Very short wake windows are sensitive to timing.');
    });

    it('notes a wrapped window', () => {
        expect(watchNotes(row({ windows: windowsOf([{ start: 0, end: 9 }, { start: 590, end: 599 }], 600) }), ctx))
            .toEqual([{ id: 'wraps', text: 'Wake window 1 runs past the end of the clock period and carries on from tick 0.' }]);
    });

    it('notes the inserter woken most, and only that one', () => {
        expect(ids(row(), { periodTicks: 600, mostWakeUpsId: 'inserter:3' })).toEqual(['most-woken']);
        expect(ids(row({ id: 'inserter:4' }), { periodTicks: 600, mostWakeUpsId: 'inserter:3' })).toEqual([]);
    });

    it('says an inserter that is on for part of the period and woken 0 times a minute is not an error', () => {
        const on19 = row({ onShare: 0.19, wakeUpsPerMinute: 0 });
        expect(watchNotes(on19, ctx)).toEqual([{
            id: 'never-woken',
            text: 'On for 19% of the period but woken 0 times a minute: the simulator counts no wake-up for it while it is on.',
        }]);
        expect(ids(row({ onShare: 0.19, wakeUpsPerMinute: 12 }))).toEqual([]);
        expect(ids(row({ onShare: 0.19, wakeUpsPerMinute: null }))).toEqual([]);
        expect(ids(row({ kind: 'drill', onShare: 0.01, wakeUpsPerMinute: 0 }))).toEqual([]);
    });

    it('gives no window notes to a row without bars', () => {
        expect(ids(row({ mode: 'always-on', windows: [], onShare: 1 }))).toEqual([]);
    });
});

describe('the definitions', () => {
    it('are not empty', () => {
        for (const text of [WAKE_WINDOW_DEFINITION, WAKE_UP_DEFINITION, WAKE_UPS_COLUMN_HELP]) {
            expect(text.trim().length).toBeGreaterThan(20);
        }
    });

    it('say how a wake-up happens in one place only', () => {
        // the words of the definition: what wakes an inserter, and why
        const how = /wakes? (an|the) inserter|finish(es|ed)? a craft|asleep|sleeps? on/i;
        const strings = Object.entries(copy).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
        expect(strings.filter(([, text]) => how.test(text)).map(([name]) => name)).toEqual(['WAKE_UP_DEFINITION']);
    });
});
