import { Box, Link, Typography, alpha, useTheme } from '@mui/material';
import { useId, useRef, type ReactNode } from 'react';
import type { BuildLane, CheckedLanes, MissedSwings, SharedLaneCause } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { useElementWidth } from '../hooks/useElementWidth';
import { laneOf } from '../utils/checkedLanes';
import { inserterNamerOf, type InserterNamer } from '../utils/inserterNames';
import { takersAlongOf } from '../utils/laneTakers';
import {
    CAUSE_WORDS, chipRowsOf, inserterChipsOf, legendOf, MISSED_SWINGS_COPY, nameInText, ONE_COPY_WORDS, oneCopyCaptionOf, oneCopyTextPartsOf, pictureLabelsOf,
    stripRowsOf, swingsEachOf, takersOf, textPartsOf, type StripMark, type StripRow,
} from '../utils/missedSwings';
import type { ClockModelAssumptions } from '../worker/types';
import { Disclosure } from './Disclosure';

/** The width the pictures are drawn at before the page has measured their place (and in a test, which has no layout) */
const UNMEASURED_WIDTH = 760;
/** Below this width the pictures take their narrow layout: shorter words, the row labels above their cells */
const NARROW_BELOW = 600;
/** The window cycles the ticks of picture two name */
const TICKS = [1, 20, 40, 60];

interface Colours {
    text: string;
    muted: string;
    line: string;
    cell: string;
    chip: string;
    gap: string;
    full: string;
}

function useColours(): Colours {
    const theme = useTheme();
    return {
        text: theme.palette.text.primary,
        muted: theme.palette.text.secondary,
        line: theme.palette.divider,
        cell: alpha(theme.palette.text.primary, 0.12),
        chip: alpha(theme.palette.text.primary, 0.05),
        // the gap of the copy before in the page's lighter red, a full output in its yellow
        gap: theme.palette.error.light,
        full: theme.palette.warning.main,
    };
}

function Text({ x, y, size = 12, fill, anchor = 'start', weight = 400, children }: { x: number; y: number; size?: number; fill: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; children: ReactNode }) {
    return <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={weight}>{children}</text>;
}

/** Picture one: one chip for each copy, in their order from the entry; a row for all the copies, the fewer copies that hold, one copy alone */
function CopiesPicture({ cause, copies, width, narrow, laneItems, label, named, along }: {
    cause: SharedLaneCause; copies: number; width: number; narrow: boolean; laneItems: string[]; label: string; named: InserterNamer | null;
    /** A build of one copy: the inserters on the lanes that miss swings in order along the belt, and the tiles between each and the next where known */
    along: { ids: number[]; tiles: number[] | null };
}) {
    const c = useColours();
    // a build of one copy: a chip for each inserter on the lane, in place of a chip for each copy
    const inserters = named ? inserterChipsOf(cause, along.ids) : null;
    const rows = inserters ? [inserters.row] : chipRowsOf(cause, copies);
    const slots = rows[0].values.length;
    const L = narrow ? 90 : 130, g = narrow ? 3 : 6, right = width - 2;
    const cw = (right - L - g * (slots - 1)) / slots;
    const cx = Array.from({ length: slots }, (_, i) => L + i * (cw + g) + cw / 2);
    const parts: ReactNode[] = [];
    const lane = cause.kind === 'lane';
    parts.push(<Text key="entry" x={L} y={11} size={11} fill={c.muted}>
        {lane ? (narrow ? MISSED_SWINGS_COPY.entry : MISSED_SWINGS_COPY.entryOfLanes(laneItems)) : MISSED_SWINGS_COPY.entryOfInputLanes}</Text>);
    let y = 14;
    if (lane) {
        parts.push(<Text key="flows" x={right} y={11} size={11} fill={c.muted} anchor="end">{MISSED_SWINGS_COPY.beltFlows}</Text>);
        parts.push(<line key="arrow" x1={L} y1={20} x2={right - 6} y2={20} stroke={c.muted} strokeWidth={2} />);
        parts.push(<polygon key="head" points={`${right - 7},15 ${right},20 ${right - 7},25`} fill={c.muted} />);
        cx.forEach((x, i) => parts.push(<line key={`drop-${i}`} x1={x} y1={20} x2={x} y2={27} stroke={c.muted} />));
        y = 27;
        // the result's spacing is the step of the copies, not the distance between inserters: a build of one copy has the tiles
        // between its inserters from their places (laneTakers.ts)
        const spacing = inserters ? undefined : cause.spacing?.data;
        const gaps = inserters ? along.tiles : null;
        if (gaps && slots > 1) {
            const equal = gaps.every(gap => Math.abs(gap - gaps[0]) < 1e-9);
            if (equal) {
                parts.push(<line key="sp" x1={cx[0]} y1={36} x2={cx[1]} y2={36} stroke={c.text} />);
                [cx[0], cx[1]].forEach((x, i) => parts.push(<line key={`sp-${i}`} x1={x} y1={32} x2={x} y2={40} stroke={c.text} />));
                const words = ONE_COPY_WORDS.tilesBetween(gaps[0]);
                if (narrow) {
                    parts.push(<Text key="spt" x={right} y={54} size={11} fill={c.text} anchor="end">{words}</Text>);
                    y = 58;
                } else {
                    parts.push(<Text key="spt" x={cx[1] + 8} y={40} size={11} fill={c.text}>{words}</Text>);
                    y = 44;
                }
            } else {
                parts.push(<Text key="spt" x={0} y={40} size={11} fill={c.text}>{ONE_COPY_WORDS.tilesApart(narrow)}</Text>);
                gaps.forEach((gap, i) => parts.push(<Text key={`sp-${i}`} x={(cx[i] + cx[i + 1]) / 2} y={40} size={11} fill={c.text} anchor="middle">{MISSED_SWINGS_COPY.figureOf(gap)}</Text>));
                y = 44;
            }
        }
        if (spacing && slots > 1) {
            const words = MISSED_SWINGS_COPY.spacing(spacing.travel_ticks, spacing.step_tiles, spacing.window_cycle_ticks);
            parts.push(<line key="sp" x1={cx[0]} y1={36} x2={cx[1]} y2={36} stroke={c.text} />);
            [cx[0], cx[1]].forEach((x, i) => parts.push(<line key={`sp-${i}`} x1={x} y1={32} x2={x} y2={40} stroke={c.text} />));
            if (narrow) {
                parts.push(<Text key="spt" x={right} y={54} size={11} fill={c.text} anchor="end">{words}</Text>);
                y = 58;
            } else {
                parts.push(<Text key="spt" x={cx[1] + 8} y={40} size={11} fill={c.text}>{words}</Text>);
                y = 44;
            }
        }
    }
    parts.push(<Text key="copy" x={0} y={y + 13} size={11} fill={c.muted}>{inserters ? ONE_COPY_WORDS.inserter : MISSED_SWINGS_COPY.copy}</Text>);
    // a part copy (5.5 copies) stands last: its head says so
    const part = !inserters && !Number.isInteger(copies);
    cx.forEach((x, i) => parts.push(<Text key={`n-${i}`} x={x} y={y + 13} size={11} fill={c.muted} anchor="middle">
        {inserters ? inserters.heads[i] : part && i === slots - 1 ? MISSED_SWINGS_COPY.partCopy(i + 1, narrow) : i + 1}</Text>));
    y += 20;
    rows.forEach((row, r) => {
        parts.push(<Text key={`l-${r}`} x={0} y={y + 19} fill={c.text}>{row.label}</Text>);
        row.values.forEach((value, i) => {
            const x = cx[i] - cw / 2;
            const key = `c-${r}-${i}`;
            if (value === null) {
                parts.push(<rect key={key} x={x + 0.5} y={y + 0.5} width={Math.max(0, cw - 1)} height={28} rx={2} fill="none" stroke={c.line} strokeDasharray="3 3" data-chip="absent" />);
            } else if (value === 0) {
                parts.push(<g key={key} data-chip="0"><rect x={x + 0.5} y={y + 0.5} width={Math.max(0, cw - 1)} height={28} rx={2} fill={c.chip} stroke={c.line} />
                    <Text x={cx[i]} y={y + 19} size={13} fill={c.muted} anchor="middle">0</Text></g>);
            } else {
                parts.push(<g key={key} data-chip={value}><rect x={x + 1} y={y + 1} width={Math.max(0, cw - 2)} height={28} rx={2} fill={alpha(c.gap, 0.22)} stroke={c.gap} strokeWidth={2} />
                    <Text x={cx[i]} y={y + 20} size={narrow && value >= 100 ? 11 : 15} fill={c.text} anchor="middle" weight={700}>{value}</Text></g>);
            }
        });
        y += 36;
    });
    parts.push(<Text key="unit" x={right} y={y + 8} size={11} fill={c.muted} anchor="end">{MISSED_SWINGS_COPY.unit(swingsEachOf(cause, inserters !== null))}</Text>);
    const height = y + 14;
    return <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={label} style={{ display: 'block' }} data-picture={inserters ? 'inserters' : 'copies'}>{parts}</svg>;
}

/** A mark of picture two: red for the copy before's gap, yellow for a full output, both halves for both, hatched for unknown */
function Mark({ x, y, w, h, kind, hatch, c }: { x: number; y: number; w: number; h: number; kind: StripMark['kind']; hatch: string; c: Colours }) {
    if (kind === 'both') return <><rect x={x} y={y} width={w} height={h / 2} fill={c.gap} /><rect x={x} y={y + h / 2} width={w} height={h / 2} fill={c.full} /></>;
    if (kind === 'neither') return <rect x={x + 0.5} y={y + 0.5} width={Math.max(0, w - 1)} height={h - 1} fill={`url(#${hatch})`} stroke={c.text} strokeWidth={1} />;
    return <rect x={x} y={y} width={w} height={h} fill={kind === 'full' ? c.full : c.gap} />;
}

/** The legend's swatch of a kind of mark, drawn as the mark is */
function Swatch({ kind, hatch }: { kind: StripMark['kind']; hatch: string }) {
    const c = useColours();
    return <svg width={9} height={14} aria-hidden style={{ flexShrink: 0 }}><Mark x={0} y={0} w={9} h={14} kind={kind} hatch={hatch} c={c} /></svg>;
}

/** The hatch of an "unknown" mark, one pattern for each picture */
function HatchDef({ id }: { id: string }) {
    const c = useColours();
    return <defs><pattern id={id} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={4} height={4} fill={alpha(c.text, 0.15)} /><line x1={0} y1={0} x2={0} y2={4} stroke={c.text} strokeWidth={1.5} /></pattern></defs>;
}

/** Picture two: a row for each inserter (or, at a full join, each copy) that misses, one cell for each window cycle */
function WindowCyclesPicture({ rows, width, narrow, label, hatch }: { rows: StripRow[]; width: number; narrow: boolean; label: string; hatch: string }) {
    const c = useColours();
    const span = Math.max(...rows.map(it => it.windowCycles));
    // the row labels stand left of the cells where they fit, else above them
    const longest = Math.max(...rows.flatMap(row => [row.label.length * 6.4, ...row.sub.map(it => it.length * 5.6)]));
    const L = narrow || longest > 220 ? 0 : Math.max(130, Math.ceil(longest) + 14);
    const above = L === 0;
    const right = width - 2;
    const pitch = (right - L) / span;
    const gap = narrow ? 1 : 1.5;
    const parts: ReactNode[] = [<HatchDef key="hatch" id={hatch} />];
    parts.push(<Text key="wc" x={0} y={10} size={11} fill={c.muted}>{above ? '' : MISSED_SWINGS_COPY.windowCycle}</Text>);
    const ticksAt = (y: number, key: string) => TICKS.filter(k => k <= span).forEach(k => {
        const x = L + (k - 1) * pitch + (pitch - gap) / 2;
        parts.push(<Text key={`${key}-t${k}`} x={x} y={y + 10} size={11} fill={c.muted} anchor="middle">{k}</Text>);
        parts.push(<line key={`${key}-l${k}`} x1={x} y1={y + 14} x2={x} y2={y + 19} stroke={c.muted} />);
    });
    let y = 0;
    if (!above) { ticksAt(0, 'top'); y = 24; }
    rows.forEach(row => {
        const direct = row.marks.length <= 8;
        if (above) {
            parts.push(<Text key={`${row.key}-l`} x={0} y={y + 12} fill={c.text}>{row.label}</Text>);
            parts.push(<Text key={`${row.key}-s`} x={0} y={y + 26} size={11} fill={c.muted}>{row.sub.join(' · ')}</Text>);
            y += 30;
            ticksAt(y, row.key);
            y += 24;
        } else {
            parts.push(<Text key={`${row.key}-l`} x={0} y={y + 9} fill={c.text}>{row.label}</Text>);
            row.sub.forEach((it, i) => parts.push(<Text key={`${row.key}-s${i}`} x={0} y={y + 23 + 14 * i} size={11} fill={c.muted}>{it}</Text>));
        }
        const marks = new Map(row.marks.map(it => [it.windowCycle, it]));
        // a direct label that would run into the one before it goes on a second line
        let lastEnd = -Infinity, second = false;
        for (let i = 0; i < row.windowCycles; i++) {
            const x = L + i * pitch, w = Math.max(0.5, pitch - gap);
            const mark = marks.get(i + 1);
            if (mark === undefined) {
                parts.push(<rect key={`${row.key}-${i}`} x={x} y={y} width={w} height={16} fill={c.cell} />);
                continue;
            }
            parts.push(<g key={`${row.key}-${i}`} data-mark={mark.kind} data-missed={mark.missed}><title>{mark.tip}</title><Mark x={x} y={y - 3} w={w} h={22} kind={mark.kind} hatch={hatch} c={c} /></g>);
            if (direct) {
                const words = mark.kind === 'fewer' ? MISSED_SWINGS_COPY.joinLabel : CAUSE_WORDS[mark.kind].label;
                const half = words.length * 3.2;
                const low = x + w / 2 - half < lastEnd + 4;
                second ||= low;
                if (!low) lastEnd = x + w / 2 + half;
                parts.push(<Text key={`${row.key}-${i}-d`} x={x + w / 2} y={y + (low ? 45 : 32)} size={11} fill={c.muted} anchor="middle">{words}</Text>);
            }
        }
        const labels = direct ? (second ? 13 : 0) : 0;
        y += labels + (above ? (direct ? 40 : 28) : Math.max(direct ? 46 : 34, 14 * row.sub.length + 24));
    });
    const height = y - 4;
    return <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={label} style={{ display: 'block' }} data-picture="window-cycles">{parts}</svg>;
}

function Figure({ title, children, caption, extra }: { title: string; children: ReactNode; caption: string; extra?: ReactNode }) {
    return <Box component="figure" sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{title}</Typography>
        {children}
        {extra}
        {caption !== '' && <Typography component="figcaption" variant="caption" color="text.secondary">{caption}</Typography>}
    </Box>;
}

function Legend({ swings, hatch, oneCopy }: { swings: MissedSwings; hatch: string; oneCopy: boolean }) {
    return <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.75, fontSize: 12 }} data-legend="">
        {legendOf(swings, oneCopy).map(entry => <Box component="span" key={entry.kind} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Swatch kind={entry.kind} hatch={hatch} /><span>{entry.text}</span>
        </Box>)}
    </Box>;
}

interface MissedSwingsPicturesProps {
    checked: CheckedLanes;
    cause: SharedLaneCause;
    lanes: readonly BuildLane[] | undefined;
    /** The build's machines by inserter, which a build of one copy names its inserters with */
    assumptions?: Pick<ClockModelAssumptions, 'machineOfInserter' | 'laneTakers'>;
    /** Selects the other clock the line names; without it, its name is plain text */
    onSelectClock?: (id: string) => void;
}

/**
 * The pictures of the missed swings in place of the cause's sentences: copy by copy, then window cycle by window cycle
 * where the engine gives the swings; the line that names another clock of the build that holds; and the engine's
 * sentences behind "Read this as text". Each picture gives a screen reader the sentences it stands for.
 */
export function MissedSwingsPictures({ checked, cause, lanes, assumptions, onSelectClock }: MissedSwingsPicturesProps) {
    const ref = useRef<HTMLDivElement>(null);
    const measured = useElementWidth(ref);
    const width = measured > 0 ? measured : UNMEASURED_WIDTH;
    const narrow = width < NARROW_BELOW;
    const { itemLabel } = useGameNames();
    const named = inserterNamerOf(checked.line.copies, assumptions);
    const hatch = `unknown-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const copies = checked.line.copies;
    const missing = cause.headline.data.copies.map(it => it.copy);
    const labels = pictureLabelsOf(cause, named ? { named, itemLabel: id => itemLabel(id) } : undefined);
    const shortItems = [...new Set(checked.rows.filter(row => row.state.kind === 'short').map(row => laneOf(lanes, row)?.item).filter((it): it is string => Boolean(it)))];
    const laneItems = shortItems.map(item => nameInText(itemLabel(item)));
    const fewer = cause.changes?.data.fewer_copies ?? null;
    const caption = named ? oneCopyCaptionOf(cause) : cause.kind === 'join'
        ? MISSED_SWINGS_COPY.joinCaption(missing, cause.swings?.kind === 'join' ? cause.swings.side_belt : true)
        : MISSED_SWINGS_COPY.laneCaption(missing, fewer !== null && fewer > 1 ? fewer : null, cause.alone.data.missed);
    const swings = cause.swings;
    const takers = takersOf(cause);
    // a build of one copy: every inserter on the lanes that miss swings, in order along the belt
    const missedLanes = checked.rows.filter(row => row.state.kind === 'short').map(row => ({ belt_id: row.belt_id, lane: row.lane }));
    const along = takersAlongOf(assumptions?.laneTakers, missedLanes, takers.map(it => it.inserter_id));
    const rows = swings === undefined ? [] : stripRowsOf(swings, itemLabel, named, takers[0]?.inserter_id ?? 0);
    const span = Math.max(0, ...rows.map(it => it.windowCycles));
    const other = cause.changes?.data.other_clock ?? null;
    return <Box ref={ref} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2.25, minWidth: 0 }} data-missed-swings={cause.kind}>
        <Figure title={named ? ONE_COPY_WORDS.pictureOne : MISSED_SWINGS_COPY.pictureOne} caption={caption}>
            <CopiesPicture cause={cause} copies={copies} width={width} narrow={narrow} laneItems={laneItems} label={labels.one} named={named} along={along} />
        </Figure>
        {swings !== undefined && rows.length > 0 && <Figure title={named ? ONE_COPY_WORDS.pictureTwo(span, takers.map(it => it.inserter_id > 0 ? named(it.inserter_id) : ONE_COPY_WORDS.outputInserter)) : MISSED_SWINGS_COPY.pictureTwo(span, missing)}
            caption={swings.kind === 'join' ? MISSED_SWINGS_COPY.joinCaptionTwo(swings.copies[0]?.gives ?? 0) : MISSED_SWINGS_COPY.laneCaptionTwo}
            extra={<Legend swings={swings} hatch={hatch} oneCopy={named !== null} />}>
            <WindowCyclesPicture rows={rows} width={width} narrow={narrow} label={labels.two} hatch={hatch} />
        </Figure>}
        {other !== null && <Typography variant="body2" data-other-clock="">
            {named ? ONE_COPY_WORDS.otherClock(cause.kind) : MISSED_SWINGS_COPY.otherClock(cause.kind, copies)}
            {onSelectClock ? <Link component="button" variant="body2" sx={{ verticalAlign: 'baseline' }} onClick={() => onSelectClock(other.id)}>{other.label.split(':')[0]}</Link>
                : other.label.split(':')[0]}
            {MISSED_SWINGS_COPY.otherClockAfter(other.window_cycle_ticks)}
        </Typography>}
        <Disclosure summary={MISSED_SWINGS_COPY.readAsText} sx={{ borderTop: 1, borderColor: 'divider', pt: 0.5 }} data-read-as-text="">
            <Box sx={{ display: 'grid', gap: 0.75, pt: 0.5 }}>
                {(named ? oneCopyTextPartsOf(cause, named, itemLabel) : textPartsOf(cause)).map(text => <Typography key={text} variant="body2">{text}</Typography>)}
            </Box>
        </Disclosure>
    </Box>;
}
