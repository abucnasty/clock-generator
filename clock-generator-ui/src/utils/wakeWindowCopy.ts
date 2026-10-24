/**
 * Every string the Wake windows view shows, in the glossary's terms (1.12). The provisional wake-up definition
 * lives in glossary.ts, to be updated there after the strict-definition experiment.
 */
import type { AlwaysOnReason } from 'clock-generator/browser';
import { PROVISIONAL_WAKE_UP_DEFINITION } from './glossary';
import { formatNumberText } from './numberText';
import type { OwnClock, WakeWindow, WakeWindowRow } from './wakeWindows';

// ---- Definitions that can change ------------------------------------------------------------------------------------

/** Glossary, "wake window" */
export const WAKE_WINDOW_DEFINITION = 'A stretch of ticks during which the clock switches an inserter or drill on. '
    + 'Between its wake windows it is off, so the game has nothing to wake.';

/** Glossary, "wake-up" (option (b), approved provisionally on 2026-10-14) */
export const WAKE_UP_DEFINITION = PROVISIONAL_WAKE_UP_DEFINITION;

/** What the per-row figure is */
export const WAKE_UPS_COLUMN_HELP =
    'Wake-ups a minute of this inserter, for one copy of the build, counted by the simulator over a long run of the clock. '
    + 'The rows add up to the clock\'s figure in the clocks table.';

// ---- Tunables the notes use -----------------------------------------------------------------------------------------

/** On for this share of the clock period or more, the clock does little (the engine's MOSTLY_ENABLED_SHARE) */
export const MOSTLY_ON_SHARE = 0.8;
/** A window this many ticks long or shorter is called very short */
export const SHORT_WINDOW_TICKS = 4;
/** Ticks between the clock reaching a window and the inserter acting on it (the engine's CIRCUIT_LATENCY_TICKS) */
const CIRCUIT_LATENCY_TICKS = 2;
/** Windows a row's accessible name lists before "and N more" */
const SUMMARY_WINDOWS = 4;
/** Short windows a note names before "and N more" */
const NOTE_WINDOWS = 4;

// ---- Fixed text -----------------------------------------------------------------------------------------------------

export const VIEW_HEADING = 'Wake windows';
export const VIEW_INTRO = 'When the selected clock switches each inserter and drill on, over one clock period. '
    + 'The rows share one axis in ticks, with seconds below.';
export const TERMS = [
    { term: 'Wake window', definition: WAKE_WINDOW_DEFINITION },
    { term: 'Wake-up', definition: WAKE_UP_DEFINITION },
    { term: 'Wake-ups/min', definition: WAKE_UPS_COLUMN_HELP },
] as const;

export const LEGEND_LABEL = 'Legend';
export const LEGEND_WINDOW = 'Wake window';
export const LEGEND_SLACK = 'Belt slack at the end of a wake window';
export const BELT_SLACK_EXPLANATION = 'Belt slack: “+N ticks” marks the hatched tail already included in each wake window, allowing a late pickup from a moving belt to finish.';
export const LEGEND_SELECTED = 'Selected wake window';
export const LEGEND_TRACK = 'One clock period';

export const KEYBOARD_HINT = 'Up and down arrow keys move between rows. Left and right arrow keys step through the wake windows '
    + 'of a row. Click or tap a bar for details. Home and End jump to the first and last wake window, and Escape clears the selection.';
export const SHOW_AS_TABLE = 'Show as table';

/** A row the clock leaves always on, where the engine does not say why */
export const ALWAYS_ON_TEXT = 'Always on: not on the clock';
export const NEVER_TEXT = 'Never switched on';
export const WAKE_UPS_ROW_LABEL = 'Wake-ups/min';
export const NOT_COUNTED = 'Not counted';
export const NOT_COUNTED_DRILL = 'Not counted for drills';
export const NOT_COUNTED_NOTE = 'No wake-up count for this clock';
export const NOT_COUNTED_REASON = 'This clock was not run long enough to count wake-ups. '
    + 'The count needs a clock that holds its rate over a long run.';

export const ROWS_TABLE_CAPTION = 'Wake windows by inserter and drill';
export const ROWS_TABLE_LABEL = 'Wake windows by inserter and drill, scrolls sideways';
/** Table 1's wake-ups: each row is one inserter's share of the clock's figure */
export const ROWS_TABLE_WAKE_UPS_HEADER = 'Wake-ups/min per inserter (1\u00a0copy)';
export const ROWS_TABLE_HEADERS = {
    name: 'Name',
    moves: 'Moves',
    onFor: 'On for (% of the clock period)',
    windows: 'Wake windows (count)',
    notes: 'Notes',
} as const;
export const WINDOWS_TABLE_CAPTION = 'Every wake window';
export const WINDOWS_TABLE_LABEL = 'Every wake window, scrolls sideways';
export const WINDOWS_TABLE_HEADERS = {
    name: 'Name',
    window: 'Wake window (n of N)',
    starts: 'Starts at tick',
    ends: 'Ends at tick',
    lengthTicks: 'Length (ticks)',
    lengthSeconds: 'Length (s)',
    slack: 'Belt slack (ticks)',
} as const;
export const NO_WINDOWS_TEXT = 'None of the inserters and drills of this clock has a wake window.';

// ---- Builders -------------------------------------------------------------------------------------------------------

const num = (value: number) => formatNumberText(value);
const plural = (count: number, one: string, many: string) => `${num(count)} ${count === 1 ? one : many}`;
const ticksText = (count: number) => plural(count, 'tick', 'ticks');
const secondsText = (ticks: number) => `${num(ticks / 60)} s`;
const percentText = (share: number) => `${formatNumberText(share * 100, { maxDecimals: 0 })}%`;

/** "1, 2 and 5", "1, 2, 3, 4 and 3 more" */
function listText(items: string[], cap: number): string {
    if (items.length > cap) {
        return `${items.slice(0, cap).join(', ')} and ${num(items.length - cap)} more`;
    }
    return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "600 ticks (10 s)", "550.96 ticks (9.18 s)" */
export function periodText(ticks: number): string {
    return `${ticksText(ticks)} (${secondsText(ticks)})`;
}

/** "29 ticks, 0.48 s" */
export function lengthText(ticks: number): string {
    return `${ticksText(ticks)}, ${secondsText(ticks)}`;
}

/** The axis end */
export function periodEndText(ticks: number): string {
    return `Clock period: ${periodText(ticks)}`;
}

/** A mark of the axis: the ticks, and below them the seconds; the first mark names its unit */
export function axisMarkText(tick: number): { ticks: string; seconds: string } {
    return { ticks: tick === 0 ? '0 ticks' : num(tick), seconds: secondsText(tick) };
}

/** Where a row moves items: "Belt 1 to Machine 2"; a drill's "into Machine 1"; empty when the run does not say */
export function rowRouteText(source: string | null, sink: string | null): string {
    // each end's word and number stay together when the row wraps
    const [from, to] = [source, sink].map(end => end?.replace(' ', '\u00a0') ?? null);
    return from && to ? `${from} to ${to}` : to ? `into ${to}` : from ? `from ${from}` : '';
}

/**
 * What a row moves and between what, in words: "Iron plate: Belt 1 to Machine 2"; a drill's "Iron ore: into Machine 1".
 * `itemLabel` gives an item's game name; the screen shows the items as icons, this is for the spoken name.
 */
export function rowDetailText(row: Pick<WakeWindowRow, 'items' | 'route'>, itemLabel: (id: string) => string = id => id): string {
    const what = row.items.map(itemLabel).join(', ');
    return what && row.route ? `${what}: ${row.route}` : what || row.route;
}

/**
 * Why the clock leaves an inserter or drill always on, in the words of the glossary: "Always on: its swings fill the
 * whole clock period (24 ticks), so a wake window would never switch it off". The old words when the engine gives none.
 */
export function alwaysOnText(reason: AlwaysOnReason | undefined): string {
    if (reason === undefined) {
        return ALWAYS_ON_TEXT;
    }
    switch (reason.kind) {
        case 'enable-rule':
            return 'Always on: its enable rule is Always on';
        case 'loop':
            return 'Always on: it moves items between machines that feed each other in a loop, which the clock leaves running';
        case 'from-loop':
            return 'Always on: it takes from a machine in a loop, which the clock leaves running';
        case 'busy':
            return `Always on: its swings fill the whole clock period (${ticksText(reason.period_ticks)}), so a wake window would never switch it off`;
        case 'no-swing':
            return 'Always on: it made no swing in the run the wake windows are read from, so the clock has no window for it';
        case 'chest-drill':
            return `Always on: ${chestDrillWhyText(reason.why)}`;
    }
}

/** Why nothing can time a drill into a chest */
function chestDrillWhyText(why: Extract<AlwaysOnReason, { kind: 'chest-drill' }>['why']): string {
    switch (why.kind) {
        case 'other-drill':
            return `drill ${num(why.drill_number)} fills the same chest with the same item, so the clock cannot time this drill on its own`;
        case 'filler':
            return `inserter ${num(why.inserter_number)} fills the same chest with the same item, so the clock cannot time this drill on its own`;
        case 'no-taker':
            return 'no inserter takes its item out of its chest, so there is nothing to time it by';
        case 'taker-without-window':
            return `inserter ${num(why.inserter_number)} takes its item out of its chest and has no wake window, so there is nothing to time it by`;
        case 'no-take':
            return 'no wake window takes its item out of its chest, so there is nothing to time it by';
        case 'no-room':
            return 'its chest has no room for its item';
        case 'needs-whole-period':
            return 'no wake windows shorter than the clock period keep the inserters that take from its chest supplied';
        case 'would-cover-period':
            return 'its wake windows would cover the whole clock period';
        case 'fallback':
            return 'the clock does not hold its rate with the fewest wake windows for it, nor with them a tick longer';
        case 'windows-did-not-hold':
            return 'its wake windows did not hold the clock';
        case 'no-window':
            return 'its Clocked rule leaves no wake window inside the clock period';
    }
}

/** "Own clock: on 6 ticks every 400 (fuel)" */
export function ownClockText(clock: OwnClock): string {
    return `Own clock: on ${ticksText(clock.windowTicks)} every ${num(clock.everyTicks)} (fuel)`;
}

/** The words that stand in for a row's bars, or null when it has bars */
export function modeText(row: Pick<WakeWindowRow, 'mode' | 'ownClock' | 'alwaysOnReason'>): string | null {
    switch (row.mode) {
        case 'always-on':
            return alwaysOnText(row.alwaysOnReason);
        case 'never':
            return NEVER_TEXT;
        case 'own-clock':
            return row.ownClock ? ownClockText(row.ownClock) : 'Own clock (fuel)';
        case 'windows':
            return null;
    }
}

/** "On for 14% of the clock period" */
export function onForText(share: number): string {
    return `On for ${percentText(share)} of the clock period`;
}

/** The share alone, for the table: "14%" */
export function onShareText(share: number): string {
    return percentText(share);
}

/** A row's wake-ups a minute: "12.3", "Not counted", "Not counted for drills" */
export function wakeUpsText(row: Pick<WakeWindowRow, 'kind' | 'wakeUpsPerMinute'>): string {
    if (row.kind === 'drill') {
        return NOT_COUNTED_DRILL;
    }
    return row.wakeUpsPerMinute === null ? NOT_COUNTED : formatNumberText(row.wakeUpsPerMinute, { maxDecimals: 1 });
}

/** "Wake-ups/min: 12.3", beside a row */
export function wakeUpsRowText(row: Pick<WakeWindowRow, 'kind' | 'wakeUpsPerMinute'>): string {
    return `${WAKE_UPS_ROW_LABEL}: ${wakeUpsText(row)}`;
}

/** "Windows: 3", or what stands in for them */
export function windowCountText(row: Pick<WakeWindowRow, 'mode' | 'ownClock' | 'alwaysOnReason' | 'windows'>): string {
    return modeText(row) ?? num(row.windows.length);
}

/** "212–240"; a wrapped window "590–4 (next clock period)" */
function windowTicksText(window: Pick<WakeWindow, 'start' | 'end' | 'wraps'>): string {
    return `${num(window.start)}–${num(window.end)}${window.wraps ? ' (next clock period)' : ''}`;
}

/** The end of a window in the table: "240", or "4 (next clock period)" */
export function windowEndText(window: Pick<WakeWindow, 'end' | 'wraps'>): string {
    return `${num(window.end)}${window.wraps ? ' (next clock period)' : ''}`;
}

/** "Wake window 2 of 3" */
export function windowOrdinalText(index: number, count: number): string {
    return `Wake window ${num(index + 1)} of ${num(count)}`;
}

/**
 * Clock period, rows and wake-ups of the clock: "Clock period 600 ticks (10 s) · 14 inserters and 2 drills · 372 wake-ups a minute
 * for one copy"
 */
export function summaryText(args: { periodTicks: number; inserters: number; drills: number; wakeUps: number | null }): string {
    const counts = args.drills > 0
        ? `${plural(args.inserters, 'inserter', 'inserters')} and ${plural(args.drills, 'drill', 'drills')}`
        : plural(args.inserters, 'inserter', 'inserters');
    const wakeUps = args.wakeUps === null
        ? 'Wake-ups not counted'
        : `${formatNumberText(args.wakeUps, { maxDecimals: 0 })} wake-ups a minute for one copy`;
    return `Clock period ${periodText(args.periodTicks)} · ${counts} · ${wakeUps}`;
}

/**
 * A row's accessible name, everything the row shows: "Inserter 3, Iron plate: Belt 1 to Machine 2. 2 windows: ticks
 * 0–28 and 212–240, the last 4 ticks of each are belt slack. On for 10% of the clock period. Wake-ups/min: 12.3."
 */
export function rowSummary(
    row: WakeWindowRow,
    periodTicks: number,
    ctx: { mostWakeUpsId: string | null; itemLabel?: (id: string) => string } = { mostWakeUpsId: null },
): string {
    const detail = rowDetailText(row, ctx.itemLabel);
    const parts = [detail ? `${row.label}, ${detail}.` : `${row.label}.`];
    const mode = modeText(row);
    if (mode !== null) {
        parts.push(`${mode}.`);
    } else {
        const ticks = listText(row.windows.map(windowTicksText), SUMMARY_WINDOWS);
        const slack = Math.max(0, ...row.windows.map(window => window.slackTicks));
        const slackText = slack > 0 ? `, the last ${ticksText(slack)} of each are belt slack` : '';
        parts.push(`${plural(row.windows.length, 'wake window', 'wake windows')}: ticks ${ticks}${slackText}.`);
    }
    parts.push(`On for ${percentText(row.onShare)} of the clock period of ${periodText(periodTicks)}.`);
    parts.push(`${wakeUpsRowText(row)}.`);
    // the notes too, so a screen reader in focus mode hears them with the row
    for (const note of watchNotes(row, { periodTicks, mostWakeUpsId: ctx.mostWakeUpsId })) {
        parts.push(`Note: ${note.text}`);
    }
    return parts.join(' ');
}

/**
 * The details of a selected wake window: "Wake window 2 of 3: ticks 212–240 (29 ticks, 0.48 s), of which the last 4 ticks are
 * belt slack. The inserter reacts 2 ticks after the wake window opens."
 */
export function windowDetails(row: WakeWindowRow, index: number, periodTicks: number): string {
    const window = row.windows[index];
    if (!window) {
        return '';
    }
    const where = window.wraps
        ? `ticks ${num(window.start)}–${num(window.end)}, past the end of the clock period of ${periodText(periodTicks)} and on from tick 0`
        : `ticks ${num(window.start)}–${num(window.end)}`;
    const slack = window.slackTicks > 0
        ? `, of which the last ${ticksText(window.slackTicks)} ${window.slackTicks === 1 ? 'is' : 'are'} belt slack`
        : '';
    const reacts = `The ${row.kind} reacts ${ticksText(CIRCUIT_LATENCY_TICKS)} after the wake window opens.`;
    return `${windowOrdinalText(index, row.windows.length)}: ${where} (${lengthText(window.length)})${slack}. ${reacts}`;
}

/** What the live region says when a window is selected */
export function selectionAnnouncement(row: WakeWindowRow, index: number, periodTicks: number): string {
    return `${row.label}. ${windowDetails(row, index, periodTicks)}`;
}

export type WatchNoteKind = 'mostly-on' | 'slack' | 'short' | 'wraps' | 'most-woken' | 'never-woken';

/** What to watch for in a row, in the glossary's terms; empty for a row with nothing to say */
export function watchNotes(
    row: WakeWindowRow,
    ctx: { periodTicks: number; mostWakeUpsId: string | null },
): { id: WatchNoteKind; text: string }[] {
    const notes: { id: WatchNoteKind; text: string }[] = [];
    if (row.mode === 'windows') {
        if (row.onShare >= MOSTLY_ON_SHARE) {
            notes.push({
                id: 'mostly-on',
                text: `On for ${percentText(row.onShare)} of the clock period, so the clock switches this one on almost all the time. `
                    // leans on the provisional wake-up definition: the first line to revisit when it changes
                    + 'The wake-ups it saves are few.',
            });
        }
        const slack = Math.max(0, ...row.windows.map(window => window.slackTicks));
        if (slack > 0) {
            notes.push({
                id: 'slack',
                text: `+${ticksText(slack)}: the last ${ticksText(slack)} of each wake window ${slack === 1 ? 'is' : 'are'} belt slack, `
                    + 'so a late pickup from a moving belt can still finish.',
            });
        }
        const short = row.windows
            .map((window, index) => ({ window, index }))
            .filter(({ window }) => window.length <= SHORT_WINDOW_TICKS);
        if (short.length === 1) {
            const { window, index } = short[0];
            notes.push({
                id: 'short',
                text: `Wake window ${num(index + 1)} is only ${ticksText(window.length)} long. Very short wake windows are sensitive to timing.`,
            });
        } else if (short.length > 1) {
            const names = listText(short.map(({ index }) => num(index + 1)), NOTE_WINDOWS);
            notes.push({
                id: 'short',
                text: `Wake windows ${names} are ${ticksText(SHORT_WINDOW_TICKS)} long or shorter. Very short wake windows are sensitive to timing.`,
            });
        }
        const wrapped = row.windows.findIndex(window => window.wraps);
        if (wrapped >= 0) {
            notes.push({
                id: 'wraps',
                text: `Wake window ${num(wrapped + 1)} runs past the end of the clock period and carries on from tick 0.`,
            });
        }
    }
    if (row.kind === 'inserter' && row.wakeUpsPerMinute === 0 && row.onShare > 0) {
        notes.push({
            id: 'never-woken',
            text: `On for ${percentText(row.onShare)} of the period but woken 0 times a minute: the simulator counts no wake-up for it while it is on.`,
        });
    }
    if (ctx.mostWakeUpsId !== null && row.id === ctx.mostWakeUpsId) {
        notes.push({ id: 'most-woken', text: 'Woken most of all the inserters of this clock.' });
    }
    return notes;
}
