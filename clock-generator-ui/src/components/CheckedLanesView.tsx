import { Cancel, CheckCircle, RemoveCircleOutline, Warning } from '@mui/icons-material';
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useId, type ReactNode } from 'react';
import type { BuildLane, CheckedLaneRow, CheckedLanes, SharedLaneCause } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { useGameNames } from '../hooks/useGameNames';
import {
    CHECKED_LANES_COPY, endText, laneOf, lanesCountText, laneText, roleText, rowSentenceShown, stateTone, supplyText, togetherText, type StateTone,
} from '../utils/checkedLanes';
import { lanesShownOf } from '../utils/diagnostics';
import { MissedSwingsPictures } from './MissedSwingsPictures';
import { ScrollX } from './ScrollX';

/** The icon beside a state's label: never the colour alone, the label says it */
const TONE_ICON: Record<StateTone, ReactNode> = {
    holds: <CheckCircle fontSize="small" aria-hidden sx={{ color: 'secondary.light' }} />,
    caution: <Warning fontSize="small" aria-hidden sx={{ color: 'warning.main' }} />,
    loss: <Cancel fontSize="small" aria-hidden sx={{ color: 'error.light' }} />,
    quiet: <RemoveCircleOutline fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />,
};

/** A value with the small line under it */
function Cell({ value, sub }: { value: ReactNode; sub?: string }) {
    return <>
        {value}
        {sub && <Typography variant="caption" component="div" color="text.secondary">{sub}</Typography>}
    </>;
}

/** A row's state: the engine's label, then its sentence where it says more than the label and the tab (rowSentenceShown) */
function State({ row }: { row: CheckedLaneRow }) {
    const sentence = rowSentenceShown(row);
    return <>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }} data-state-label="">
            {TONE_ICON[stateTone(row.state)]}{row.label}
        </Box>
        {sentence !== null && <Typography variant="caption" component="div" color="text.secondary" data-state-sentence="">{sentence}</Typography>}
    </>;
}

/** The cells of a row after its lane, in the columns' order, each with its column's name */
function useCellsOf(checked: CheckedLanes, lanes: readonly BuildLane[] | undefined) {
    const { itemLabel } = useGameNames();
    const { columns } = CHECKED_LANES_COPY;
    return (row: CheckedLaneRow) => {
        const lane = laneOf(lanes, row);
        return [
            { name: columns.role, value: { value: roleText(lane) } },
            { name: columns.item, value: { value: lane?.item ? itemLabel(lane.item) : '—' } },
            { name: columns.end, value: endText(lane), nowrap: true },
            { name: columns.together(checked.line.copies), value: togetherText(row), nowrap: true, right: true },
            { name: columns.supply, value: supplyText(row, lane), nowrap: true, right: true },
        ];
    };
}

interface SharedLanesTableProps {
    checked: CheckedLanes;
    lanes: readonly BuildLane[] | undefined;
    /** The heading's level where the table sits */
    level: 3 | 4;
    /** A narrow page's blocks, or the table; by the page's width when not given */
    narrow?: boolean;
}

/**
 * One row a lane the copies share, in the engine's order: the lane by its numbers, its role, item and end, what the copies
 * take or drop on it together, its supply rate, and its state (the engine's label, then its sentence). On a narrow page each
 * lane is a block of a list instead: the lane and its state first, then the other columns as names and values, so that
 * nothing scrolls sideways.
 */
export function SharedLanesTable({ checked, lanes, level, narrow }: SharedLanesTableProps) {
    const headingId = useId();
    const narrowPage = useMediaQuery(useTheme().breakpoints.down('sm'), { noSsr: true });
    const cellsOf = useCellsOf(checked, lanes);
    const { columns } = CHECKED_LANES_COPY;
    const blocks = narrow ?? narrowPage;
    return <Box sx={{ minWidth: 0 }} data-shared-lanes={blocks ? 'blocks' : 'table'}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1.5, mb: 0.5 }}>
            <Typography component={`h${level}`} variant="subtitle2" id={headingId} sx={{ fontWeight: 600 }}>{CHECKED_LANES_COPY.heading}</Typography>
            <Typography variant="body2" color="text.secondary" data-lanes-count="">{lanesCountText(checked.rows)}</Typography>
        </Box>
        {blocks ? <Box component="ul" aria-labelledby={headingId} sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
            {checked.rows.map(row => <Box component="li" key={`${row.belt_id}-${row.lane}`} data-lane-state={row.state.kind}
                sx={{ borderTop: 1, borderColor: 'divider', pt: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} data-lane="">
                    <Box component="span" color="text.secondary" sx={{ fontWeight: 400 }}>{columns.lane} </Box>{laneText(row)}
                </Typography>
                <Box><State row={row} /></Box>
                <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 1.5, rowGap: 0.25 }}>
                    {cellsOf(row).map(cell => <Box key={cell.name} sx={{ display: 'contents' }}>
                        <Typography component="dt" variant="body2" color="text.secondary">{cell.name}</Typography>
                        <Typography component="dd" variant="body2" sx={{ m: 0 }}><Cell {...cell.value} /></Typography>
                    </Box>)}
                </Box>
            </Box>)}
        </Box> : <ScrollX label={CHECKED_LANES_COPY.heading}>
            <Table size="small" aria-labelledby={headingId} sx={{ minWidth: 720, '& td, & th': { verticalAlign: 'top' } }}>
                <TableHead>
                    <TableRow>
                        <TableCell scope="col">{columns.lane}</TableCell>
                        {[columns.role, columns.item, columns.end].map(name => <TableCell key={name} scope="col">{name}</TableCell>)}
                        {[columns.together(checked.line.copies), columns.supply].map(name => <TableCell key={name} scope="col" align="right">{name}</TableCell>)}
                        <TableCell scope="col">{columns.state}</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {checked.rows.map(row => <TableRow key={`${row.belt_id}-${row.lane}`} data-lane-state={row.state.kind}>
                        <TableCell component="th" scope="row" sx={{ whiteSpace: 'nowrap' }}>{laneText(row)}</TableCell>
                        {cellsOf(row).map(cell => <TableCell key={cell.name} align={cell.right ? 'right' : undefined}
                            sx={cell.nowrap ? { whiteSpace: 'nowrap' } : undefined}><Cell {...cell.value} /></TableCell>)}
                        <TableCell sx={{ minWidth: 200 }}><State row={row} /></TableCell>
                    </TableRow>)}
                </TableBody>
            </Table>
        </ScrollX>}
    </Box>;
}

/** The headline of a cause: how many swings which copies miss. `level`: a heading of that level, where it heads the cause's parts */
export function CauseHeadline({ cause, level }: { cause: SharedLaneCause; level?: 3 }) {
    return <Typography variant="body2" component={level ? `h${level}` : 'p'} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 600, m: 0 }} data-cause-headline="">
        {TONE_ICON.loss}{cause.headline.text}
    </Typography>;
}

interface SharedLaneCausePartsProps {
    checked: CheckedLanes & { cause: SharedLaneCause };
    lanes: readonly BuildLane[] | undefined;
    /** Selects the other clock that the line names, by its id */
    onSelectClock?: (id: string) => void;
}

/**
 * The cause of a clock that is not stable on a shared lane: the headline, then the pictures of the missed swings, the line
 * that names another clock of the build that holds, and the engine's sentences behind "Read this as text"
 */
export function SharedLaneCauseParts({ checked, lanes, onSelectClock }: SharedLaneCausePartsProps) {
    const cause = checked.cause;
    return <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.5, minWidth: 0 }} data-lane-cause={cause.kind}>
        <CauseHeadline cause={cause} level={3} />
        <MissedSwingsPictures checked={checked} cause={cause} lanes={lanes} onSelectClock={onSelectClock} />
    </Box>;
}

interface LaneDiagnosticsProps {
    clock: ClockAlternativeView;
    /** Selects the other clock that the cause's line names, by its id */
    onSelectClock?: (id: string) => void;
}

/**
 * What the Diagnostics tab of the selected clock shows of the lanes its copies share (lanesShownOf). A clock with a cause: its
 * headline and pictures, then the table. A clock with no cause: the engine's line, then the table. The table is open. A clock
 * with no checked lanes: one sentence.
 */
export function LaneDiagnostics({ clock, onSelectClock }: LaneDiagnosticsProps) {
    const lanes = clock.assumptions?.lanes;
    const shown = lanesShownOf(clock);
    if (shown.kind === 'sentence') return <Typography variant="body2" data-checked-lanes="" data-lanes-sentence="">{shown.text}</Typography>;
    return <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1 }} data-checked-lanes="">
        {shown.kind === 'cause'
            ? <SharedLaneCauseParts checked={shown.checked} lanes={lanes} onSelectClock={onSelectClock} />
            : <Typography variant="body2" data-checked-line="">{shown.checked.line.sentence}</Typography>}
        <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5 }}>{CHECKED_LANES_COPY.whatWasChecked}</Typography>
            <SharedLanesTable checked={shown.checked} lanes={lanes} level={3} />
        </Box>
    </Box>;
}
