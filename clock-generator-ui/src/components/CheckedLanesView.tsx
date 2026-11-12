import { Cancel, CheckCircle, ExpandMore, RemoveCircleOutline, Warning } from '@mui/icons-material';
import { Box, Button, Collapse, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useId, useState, type ReactNode } from 'react';
import type { BuildLane, CheckedLanes, SharedLaneCause } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { useGameNames } from '../hooks/useGameNames';
import {
    CHECKED_LANES_COPY, endText, laneOf, lanesCountText, laneText, roleText, stateTone, supplyText, togetherText, type StateTone,
} from '../utils/checkedLanes';
import { ScrollX } from './ScrollX';

/** The icon beside a state's label: never the colour alone, the label says it */
const TONE_ICON: Record<StateTone, ReactNode> = {
    holds: <CheckCircle fontSize="small" aria-hidden sx={{ color: 'secondary.light' }} />,
    caution: <Warning fontSize="small" aria-hidden sx={{ color: 'warning.main' }} />,
    loss: <Cancel fontSize="small" aria-hidden sx={{ color: 'error.light' }} />,
    quiet: <RemoveCircleOutline fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />,
};

/** A cell's value with the small line under it */
function Cell({ value, sub }: { value: ReactNode; sub?: string }) {
    return <>
        {value}
        {sub && <Typography variant="caption" component="div" color="text.secondary">{sub}</Typography>}
    </>;
}

interface SharedLanesTableProps {
    checked: CheckedLanes;
    lanes: readonly BuildLane[] | undefined;
    /** The heading's level where the table sits */
    level: 3 | 4;
}

/**
 * One row a lane the copies share, in the engine's order: the lane by its numbers, its role, item and end, what the copies
 * take or drop on it together, its supply rate, and its state (the engine's label, then its sentence).
 */
export function SharedLanesTable({ checked, lanes, level }: SharedLanesTableProps) {
    const headingId = useId();
    const { itemLabel } = useGameNames();
    const { columns } = CHECKED_LANES_COPY;
    return <Box sx={{ minWidth: 0 }} data-shared-lanes="">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1.5, mb: 0.5 }}>
            <Typography component={`h${level}`} variant="subtitle2" id={headingId} sx={{ fontWeight: 600 }}>{CHECKED_LANES_COPY.heading}</Typography>
            <Typography variant="body2" color="text.secondary" data-lanes-count="">{lanesCountText(checked.rows)}</Typography>
        </Box>
        <ScrollX label={CHECKED_LANES_COPY.heading}>
            <Table size="small" aria-labelledby={headingId} sx={{ minWidth: 720, '& td, & th': { verticalAlign: 'top' } }}>
                <TableHead>
                    <TableRow>
                        <TableCell scope="col">{columns.lane}</TableCell>
                        <TableCell scope="col">{columns.role}</TableCell>
                        <TableCell scope="col">{columns.item}</TableCell>
                        <TableCell scope="col">{columns.end}</TableCell>
                        <TableCell scope="col" align="right">{columns.together(checked.line.copies)}</TableCell>
                        <TableCell scope="col" align="right">{columns.supply}</TableCell>
                        <TableCell scope="col">{columns.state}</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {checked.rows.map(row => {
                        const lane = laneOf(lanes, row);
                        return <TableRow key={`${row.belt_id}-${row.lane}`} data-lane-state={row.state.kind}>
                            <TableCell component="th" scope="row" sx={{ whiteSpace: 'nowrap' }}>{laneText(row)}</TableCell>
                            <TableCell>{roleText(lane)}</TableCell>
                            <TableCell>{lane?.item ? itemLabel(lane.item) : '—'}</TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}><Cell {...endText(lane)} /></TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><Cell {...togetherText(row)} /></TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><Cell {...supplyText(row, lane)} /></TableCell>
                            <TableCell sx={{ minWidth: 200 }}>
                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }} data-state-label="">
                                    {TONE_ICON[stateTone(row.state)]}{row.label}
                                </Box>
                                <Typography variant="caption" component="div" color="text.secondary" data-state-sentence="">{row.sentence}</Typography>
                            </TableCell>
                        </TableRow>;
                    })}
                </TableBody>
            </Table>
        </ScrollX>
    </Box>;
}

/** A part of the cause under its name; the text is the engine's */
function Part({ name, text }: { name: string; text: string }) {
    return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '160px minmax(0, 1fr)' }, columnGap: 1.5 }}>
        <Typography component="dt" variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>{name}</Typography>
        <Typography component="dd" variant="body2" sx={{ m: 0 }}>{text}</Typography>
    </Box>;
}

/**
 * The parts of the cause of a clock that is not stable on a shared lane, in order: the headline, the cause in a marked block
 * with the reason from the spacing where the engine gives one, where and how much, one copy alone, and what changes it
 */
export function SharedLaneCauseParts({ cause }: { cause: SharedLaneCause }) {
    return <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1 }} data-lane-cause={cause.kind}>
        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }} data-cause-headline="">
            {TONE_ICON.loss}{cause.headline.text}
        </Typography>
        {(cause.cause || cause.spacing) && <Box sx={{ borderLeft: 3, borderColor: 'error.light', pl: 1.5, py: 0.25, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0.5 }} data-cause-block="">
            {cause.cause && <Typography variant="body1" sx={{ fontWeight: 600 }}>{cause.cause.text}</Typography>}
            {cause.spacing && <Typography variant="body2">{cause.spacing.text}</Typography>}
        </Box>}
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0.75 }}>
            <Part name={CHECKED_LANES_COPY.where} text={cause.where.text} />
            <Part name={CHECKED_LANES_COPY.alone} text={cause.alone.text} />
            {cause.changes && <Part name={CHECKED_LANES_COPY.changes} text={cause.changes.text} />}
        </Box>
    </Box>;
}

/**
 * What the result says was checked on the lanes the copies of the selected clock's build share. A clock with no cause:
 * "Made for 9 copies of your build.", the engine's line, and "What was checked", which opens the table. A clock with a cause:
 * its parts in place of the line, then the table, open. A build of one copy: its "Made for 1 copy of your build." alone.
 */
export function CheckedLanesSummary({ clock }: { clock: ClockAlternativeView }) {
    const [open, setOpen] = useState(false);
    const tableId = useId();
    const checked = clock.checkedLanes;
    const lanes = clock.assumptions?.lanes;
    return <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1 }} data-checked-lanes="">
        <Typography variant="body2" data-made-for="">{CHECKED_LANES_COPY.madeFor(clock.copies)}</Typography>
        {checked && (checked.cause ? <>
            <SharedLaneCauseParts cause={checked.cause} />
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5 }}>{CHECKED_LANES_COPY.whatWasChecked}</Typography>
                <SharedLanesTable checked={checked} lanes={lanes} level={4} />
            </Box>
        </> : <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5 }}>
                <Typography variant="body2" sx={{ flex: '1 1 320px' }} data-checked-line="">{checked.line.sentence}</Typography>
                <Button size="small" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen(!open)}
                    endIcon={<ExpandMore sx={{ transform: open ? 'rotate(180deg)' : 'none' }} />}>
                    {CHECKED_LANES_COPY.whatWasChecked}
                </Button>
            </Box>
            <Collapse id={tableId} in={open} mountOnEnter unmountOnExit timeout={150}>
                <SharedLanesTable checked={checked} lanes={lanes} level={4} />
            </Collapse>
        </>)}
    </Box>;
}
