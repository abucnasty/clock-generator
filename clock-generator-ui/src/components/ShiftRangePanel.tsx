import { Box, Paper, Tooltip, Typography } from '@mui/material';
import type { ShiftRangeEdge } from 'clock-generator/browser';
import type { ShiftOptionsView } from '../worker/types';
import { COLOR_BLIND_PALETTE } from './colors';

const WORKS_COLOR = COLOR_BLIND_PALETTE.green;
const FAILS_COLOR = COLOR_BLIND_PALETTE.vermillion;
const USED_COLOR = COLOR_BLIND_PALETTE.white;
const ROW_HEIGHT = 18;

const describeShift = (ticks: number) => ticks === 0 ? 'the planned position'
    : `${Math.abs(ticks)} ticks ${ticks < 0 ? 'earlier' : 'later'}`;

interface ShiftRangePanelProps {
    options: ShiftOptionsView;
}

/** The unbroken run of working shifts around the one in use */
function workingRangeAround(shifts: { shift_ticks: number; is_stable: boolean }[], used: number): { from: number; to: number } | null {
    const at = shifts.findIndex(shift => shift.shift_ticks === used);
    if (at < 0) {
        return null;
    }
    let first = at;
    let last = at;
    while (first > 0 && shifts[first - 1].is_stable) {
        first--;
    }
    while (last < shifts.length - 1 && shifts[last + 1].is_stable) {
        last++;
    }
    return { from: shifts[first].shift_ticks, to: shifts[last].shift_ticks };
}

/** What stops the swings from going further than one end of the range that works */
function EdgeReasons({ title, edge }: { title: string; edge: ShiftRangeEdge }) {
    return (
        <Box sx={{ flex: 1, minWidth: 260 }}>
            <Typography variant="subtitle2">
                {title}: {describeShift(edge.shift_ticks)}
            </Typography>
            {edge.notes.map(note => (
                <Typography key={note} variant="body2" color="text.secondary">• {note}</Typography>
            ))}
            {edge.is_search_limit && (
                <Typography variant="body2" color="text.secondary">
                    • Nothing further was tried: the moved windows would meet the same inserters' other windows.
                </Typography>
            )}
            {edge.notes.length === 0 && !edge.is_search_limit && (
                <Typography variant="body2" color="text.secondary">• Nothing was waiting at this place; one step further does not hold the expected output.</Typography>
            )}
        </Box>
    );
}

/**
 * Every place tried for the swings a potential clock moved, drawn along one axis of ticks from the planned start,
 * so the range the machines accept is visible next to the one place the clock uses.
 */
export function ShiftRangePanel({ options }: ShiftRangePanelProps) {
    const rowLabel = (index: number) => options.moved === 'output-swing' ? `Output swing ${index}`
        : index === options.chosenIndex && options.plannedTicks ? `Swings from tick ${options.plannedTicks.start}`
        : `Swings, round ${index}`;
    const all = options.rows.flatMap(row => row.shifts.map(shift => shift.shift_ticks));
    if (all.length === 0) {
        return null;
    }

    // one cell per checked shift, as wide as the smallest gap between two of them
    const gaps = options.rows.flatMap(row => row.shifts.slice(1).map((shift, index) => shift.shift_ticks - row.shifts[index].shift_ticks));
    const cell = Math.max(1, Math.min(...gaps, Infinity) === Infinity ? 1 : Math.min(...gaps));
    const min = Math.min(...all, 0) - cell / 2;
    const max = Math.max(...all, 0) + cell / 2;
    const percent = (ticks: number) => `${((ticks - min) / (max - min)) * 100}%`;
    const width = `${(cell / (max - min)) * 100}%`;

    const usedRow = options.rows.find(row => row.index === options.chosenIndex);
    const range = usedRow ? workingRangeAround(usedRow.shifts, options.chosenShiftTicks) : null;
    const plannedChecked = options.rows.some(row => row.shifts.some(shift => shift.shift_ticks === 0));

    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                {options.moved === 'swings' ? 'When the machines accept these swings' : 'Where the output swing can go'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {options.moved === 'swings' && options.plannedTicks
                    ? <>This clock moves the swings planned in clock ticks {options.plannedTicks.start}–{options.plannedTicks.end} ({options.movedDescription}) together, </>
                    : <>This clock moves {options.movedDescription} </>}
                {describeShift(options.chosenShiftTicks)} than planned.
                {range && range.from !== range.to && (
                    <> Places from {describeShift(range.from)} to {describeShift(range.to)} work, checked every {cell} ticks.</>
                )}
                {options.moved === 'swings' && (
                    <> A machine takes an input hand once it is below its insertion limit and before it runs out, and gives an output hand once a full one is ready.</>
                )}
                {' '}Each place was checked with the clock-only simulation from 12 clock starts; the one in use was confirmed from 112.
            </Typography>

            {options.rows.map(row => (
                <Box key={row.index} sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="caption" sx={{ width: 150, flexShrink: 0 }}>
                        {rowLabel(row.index)}
                    </Typography>
                    <Box sx={{ flex: 1, position: 'relative', height: ROW_HEIGHT, bgcolor: 'action.hover', borderRadius: 0.5 }}>
                        {row.shifts.map(shift => {
                            const used = row.index === options.chosenIndex && shift.shift_ticks === options.chosenShiftTicks;
                            return (
                                <Tooltip
                                    key={shift.shift_ticks}
                                    arrow
                                    title={`${describeShift(shift.shift_ticks)}: ${shift.is_stable ? 'works' : 'does not hold the expected output'}`
                                        + (used ? ' (used by this clock)' : '')}
                                >
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            top: 0,
                                            height: ROW_HEIGHT,
                                            left: percent(shift.shift_ticks - cell / 2),
                                            width,
                                            bgcolor: shift.is_stable ? WORKS_COLOR : FAILS_COLOR,
                                            opacity: shift.is_stable ? 1 : 0.55,
                                            boxSizing: 'border-box',
                                            border: used ? `2px solid ${USED_COLOR}` : '1px solid rgba(0, 0, 0, 0.35)',
                                            zIndex: used ? 1 : 0,
                                        }}
                                    />
                                </Tooltip>
                            );
                        })}
                        {/* planned start */}
                        <Box sx={{ position: 'absolute', top: -3, bottom: -3, left: percent(0), borderLeft: `2px dashed ${USED_COLOR}`, pointerEvents: 'none', zIndex: 2 }} />
                    </Box>
                </Box>
            ))}

            {/* axis */}
            <Box sx={{ display: 'flex' }}>
                <Box sx={{ width: 150, flexShrink: 0 }} />
                <Box sx={{ flex: 1, position: 'relative', height: 18 }}>
                    {[Math.min(...all), 0, Math.max(...all)].filter((ticks, index, ticksShown) => ticksShown.indexOf(ticks) === index).map(ticks => (
                        <Typography
                            key={ticks}
                            variant="caption"
                            color="text.secondary"
                            sx={{ position: 'absolute', left: percent(ticks), transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}
                        >
                            {ticks === 0 ? 'planned' : `${ticks > 0 ? '+' : ''}${ticks}`}
                        </Typography>
                    ))}
                </Box>
            </Box>

            {options.earliest && options.latest && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
                    <EdgeReasons title="Earliest that works" edge={options.earliest} />
                    <EdgeReasons title="Latest that works" edge={options.latest} />
                </Box>
            )}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
                {[
                    { label: 'Works', swatch: { bgcolor: WORKS_COLOR } },
                    { label: 'Does not hold the expected output', swatch: { bgcolor: FAILS_COLOR, opacity: 0.55 } },
                    { label: 'Used by this clock', swatch: { bgcolor: WORKS_COLOR, border: `2px solid ${USED_COLOR}` } },
                ].map(({ label, swatch }) => (
                    <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 12, height: 12, boxSizing: 'border-box', ...swatch }} />
                        <Typography variant="caption">{label}</Typography>
                    </Box>
                ))}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ height: 12, borderLeft: `2px dashed ${USED_COLOR}` }} />
                    <Typography variant="caption">
                        Planned start{plannedChecked ? '' : ' (offered as its own potential clock, not checked here)'}
                    </Typography>
                </Box>
            </Box>
        </Paper>
    );
}
