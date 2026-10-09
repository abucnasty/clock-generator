import { Alert, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import { memo } from 'react';
import type { FuelInserterPlan, FuelLevelSeries, FuelMachinePlan } from 'clock-generator/browser';
import type { FuelRunView, FuelSwing, FuelViewData } from '../worker/types';
import { FactorioIcon } from './FactorioIcon';
import { COLOR_BLIND_PALETTE } from './colors';

const LEVEL_COLOR = COLOR_BLIND_PALETTE.skyBlue;
const WINDOW_COLOR = COLOR_BLIND_PALETTE.lightGrey;
const SWING_COLOR = COLOR_BLIND_PALETTE.orange;
const EMPTY_COLOR = COLOR_BLIND_PALETTE.vermillion;
const LABEL_WIDTH = 200;
const LEVEL_HEIGHT = 56;
const ROW_HEIGHT = 20;

const entityNumber = (entityId: string) => entityId.split(':')[1];
const machineLabel = (machineId: string) => `Machine ${entityNumber(machineId)}`;
const inserterLabel = (inserterId: string) => `Inserter ${entityNumber(inserterId)}`;
const ticksAndSeconds = (ticks: number) => `${Math.round(ticks)} ticks (${(ticks / 60).toFixed(1)} s)`;
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

interface FuelPanelProps {
    fuel: FuelViewData;
}

/** Whether the clock of the blueprint counts the fuel clocks too, or each has a counter of its own */
function exportedClockText(fuel: FuelViewData): string {
    const { plan } = fuel;
    const moduli = Array.from(new Set(plan.inserters.map(inserter => inserter.modulus))).sort((a, b) => a - b);
    const fuelClocks = `${moduli.length === 1 ? 'a fuel clock' : 'fuel clocks'} of ${moduli.join(' and ')} ticks`;
    if (plan.merged_clock_ticks !== null) {
        return `One clock counts ${plan.merged_clock_ticks.toLocaleString()} ticks, the least common multiple of the `
            + `${plan.period_ticks} tick period and ${fuelClocks}. Modulo combinators give the period and each fuel clock from it.`;
    }
    return `The blueprint has ${fuelClocks} next to the clock of the period, each with a counter of its own, because `
        + (plan.separate_clocks_reason === 'fractional_period'
            ? `the ${plan.period_ticks.toFixed(3)} tick period is not a whole number of ticks.`
            : 'one clock for all of them would count further than a signal can hold.');
}

function RanOutAlert({ run }: { run: FuelRunView }) {
    const span = `${run.durationTicks} ticks (${run.periods} clock periods)`;
    const empty = run.levels.filter(levels => levels.empty_ticks > 0);
    if (empty.length > 0) {
        return (
            <Alert severity="error" sx={{ mb: 2 }}>
                {empty.map(levels => `${machineLabel(levels.machine_id)} ran out of fuel at tick ${levels.first_empty_tick} `
                    + `and had none for ${levels.empty_ticks} ticks`).join('; ')}
                {` over the ${span} simulated.`}
            </Alert>
        );
    }
    const lowest = run.levels.length > 0 ? Math.min(...run.levels.map(levels => levels.min_level)) : null;
    return (
        <Alert severity={run.fuelSwingsRecorded ? 'success' : 'warning'} sx={{ mb: 2 }}>
            {`No machine ran out of fuel over the ${span} simulated.`}
            {lowest !== null && ` The lowest any machine got was ${lowest.toFixed(2)} items.`}
            {!run.fuelSwingsRecorded && ' No fuel inserter swung in that time, so the refills are not shown.'}
        </Alert>
    );
}

function MachineTable({ machines, run }: { machines: FuelMachinePlan[]; run: FuelRunView | null }) {
    const levelsOf = (machineId: string) => run?.levels.find(levels => levels.machine_id === machineId);
    return (
        <TableContainer>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Machine</TableCell>
                        <TableCell>Fuel</TableCell>
                        <TableCell align="right">Burn while crafting</TableCell>
                        <TableCell align="right">Crafts</TableCell>
                        <TableCell align="right">Effective burn</TableCell>
                        <TableCell align="right">Per clock period</TableCell>
                        <TableCell align="right">Limit of {machines[0]?.insertion_limit} lasts</TableCell>
                        <TableCell align="right">Energy use</TableCell>
                        {run && <TableCell align="right">Simulated burn</TableCell>}
                        {run && <TableCell align="right">Lowest fuel</TableCell>}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {machines.map(machine => {
                        const levels = levelsOf(machine.machine_id);
                        return (
                            <TableRow key={machine.machine_id}>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                        <FactorioIcon name={machine.output_item} size={18} />
                                        {machineLabel(machine.machine_id)}
                                        <Typography variant="caption" color="text.secondary">{machine.recipe}</Typography>
                                    </Box>
                                </TableCell>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                        <FactorioIcon name={machine.fuel_item} size={18} />
                                        {machine.fuel_item}
                                    </Box>
                                </TableCell>
                                <TableCell align="right">{machine.burn_rate_per_second.toFixed(3)}/s</TableCell>
                                <TableCell align="right">{percent(machine.crafting_share)}</TableCell>
                                <TableCell align="right">{machine.effective_burn_rate_per_second.toFixed(3)}/s</TableCell>
                                <TableCell align="right">{machine.burned_per_period.toFixed(2)}</TableCell>
                                <TableCell align="right">
                                    {machine.insertion_limit_lasted_at_least_ticks === undefined
                                        ? ticksAndSeconds(machine.insertion_limit_lasts_ticks)
                                        : `at least ${ticksAndSeconds(machine.insertion_limit_lasted_at_least_ticks)}`}
                                </TableCell>
                                <TableCell align="right">
                                    {machine.energy_consumption_bonus >= 0 ? '+' : ''}{machine.energy_consumption_bonus.toFixed(0)}%
                                </TableCell>
                                {run && (
                                    <TableCell align="right">
                                        {levels ? `${(levels.burned / run.durationTicks * 60).toFixed(3)}/s` : '-'}
                                    </TableCell>
                                )}
                                {run && (
                                    <TableCell align="right" sx={{ color: levels && levels.empty_ticks > 0 ? 'error.main' : undefined }}>
                                        {levels ? levels.min_level.toFixed(2) : '-'}
                                    </TableCell>
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

function InserterTable({ inserters, run }: { inserters: FuelInserterPlan[]; run: FuelRunView | null }) {
    return (
        <TableContainer>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Inserter</TableCell>
                        <TableCell>Feeds</TableCell>
                        <TableCell align="right">Enabled every</TableCell>
                        <TableCell align="right">For ticks</TableCell>
                        <TableCell align="right">Enables</TableCell>
                        <TableCell align="right">A hand lasts</TableCell>
                        <TableCell align="right">Expected swings</TableCell>
                        <TableCell align="right">Enables that swing</TableCell>
                        {run && <TableCell align="right">Simulated swings</TableCell>}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {inserters.map(inserter => {
                        const swings = run?.swings[inserter.inserter_id] ?? [];
                        const enables = run ? Math.ceil(run.durationTicks / inserter.modulus) : 0;
                        return (
                            <TableRow key={inserter.inserter_id}>
                                <TableCell>{inserterLabel(inserter.inserter_id)}</TableCell>
                                <TableCell>{machineLabel(inserter.machine_id)}</TableCell>
                                <TableCell align="right">{inserter.modulus} ticks</TableCell>
                                <TableCell align="right">{inserter.window.start} to {inserter.window.end}</TableCell>
                                <TableCell align="right">{inserter.enables_per_minute.toFixed(1)}/min</TableCell>
                                <TableCell align="right">
                                    {inserter.hand_size} for {ticksAndSeconds(inserter.hand_lasts_ticks)}
                                </TableCell>
                                <TableCell align="right">{inserter.expected_swings_per_minute.toFixed(1)}/min</TableCell>
                                <TableCell align="right">{percent(inserter.swing_share)}</TableCell>
                                {run && (
                                    <TableCell align="right">
                                        {swings.length} of {enables} enables ({(swings.length / run.durationTicks * 3600).toFixed(1)}/min)
                                    </TableCell>
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

/** The fuel a machine held: the highest of each sample as an area, the lowest as a line, and the insertion limit dashed */
function FuelLevelChart({ levels, durationTicks, insertionLimit }: { levels: FuelLevelSeries; durationTicks: number; insertionLimit: number }) {
    const top = Math.max(levels.max_level, insertionLimit) * 1.08;
    const y = (level: number) => (1 - level / top) * LEVEL_HEIGHT;
    const x = (sample: number) => Math.min(sample * levels.ticks_per_sample, durationTicks);
    // each sample is a step as wide as the ticks it covers
    const steps = (values: number[]) => values.flatMap((value, sample) => [`${x(sample)},${y(value)}`, `${x(sample + 1)},${y(value)}`]);
    const emptySamples = levels.empty_ticks === 0 ? [] : levels.min.flatMap((min, sample) => min <= 0 ? [sample] : []);

    return (
        <Box
            component="svg"
            viewBox={`0 0 ${durationTicks} ${LEVEL_HEIGHT}`}
            preserveAspectRatio="none"
            sx={{ display: 'block', width: '100%', height: LEVEL_HEIGHT, bgcolor: 'action.hover', borderRadius: 0.5 }}
        >
            <polygon points={[`0,${LEVEL_HEIGHT}`, ...steps(levels.max), `${durationTicks},${LEVEL_HEIGHT}`].join(' ')} fill={LEVEL_COLOR} fillOpacity={0.3} />
            <polyline points={steps(levels.min).join(' ')} fill="none" stroke={LEVEL_COLOR} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <line
                x1={0} x2={durationTicks} y1={y(insertionLimit)} y2={y(insertionLimit)}
                stroke={WINDOW_COLOR} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
            />
            {emptySamples.map(sample => (
                <rect
                    key={sample} x={x(sample)} width={x(sample + 1) - x(sample)} y={0} height={LEVEL_HEIGHT}
                    fill={EMPTY_COLOR} fillOpacity={0.5} stroke={EMPTY_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                />
            ))}
        </Box>
    );
}

function SwingBar({ swing, durationTicks }: { swing: FuelSwing; durationTicks: number }) {
    return (
        <Tooltip
            title={`${swing.amount} items, tick ${swing.start} to ${swing.end}`}
            arrow
            placement="top"
        >
            <Box
                sx={{
                    position: 'absolute',
                    left: `${(swing.start / durationTicks) * 100}%`,
                    width: `${Math.max(((swing.end - swing.start) / durationTicks) * 100, 0.4)}%`,
                    top: 2,
                    height: ROW_HEIGHT - 4,
                    bgcolor: SWING_COLOR,
                    borderRadius: 0.5,
                    cursor: 'pointer',
                }}
            />
        </Tooltip>
    );
}

/** One fuel inserter over the run: every enable window of its fuel clock, and the windows it swung in */
function FuelClockRow({ inserter, swings, durationTicks }: { inserter: FuelInserterPlan; swings: FuelSwing[]; durationTicks: number }) {
    const windowStarts: number[] = [];
    for (let start = inserter.window.start; start < durationTicks; start += inserter.modulus) {
        windowStarts.push(start);
    }
    const windowTicks = inserter.window.end - inserter.window.start + 1;

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', height: ROW_HEIGHT, mt: 0.5 }}>
            <Box sx={{ width: LABEL_WIDTH, flexShrink: 0, pr: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FactorioIcon name="stack-inserter" size={16} />
                <Typography variant="body2" noWrap sx={{ fontSize: '0.75rem' }}>
                    {inserterLabel(inserter.inserter_id)}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: '0.65rem' }}>
                    every {inserter.modulus}
                </Typography>
            </Box>
            <Box sx={{ flex: 1, height: ROW_HEIGHT, position: 'relative', bgcolor: 'action.hover', borderRadius: 0.5 }}>
                <Box
                    component="svg"
                    viewBox={`0 0 ${durationTicks} 1`}
                    preserveAspectRatio="none"
                    sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                >
                    {windowStarts.map(start => (
                        // the stroke keeps a window visible when a long run makes it narrower than a pixel
                        <rect
                            key={start} x={start} width={windowTicks} y={0} height={1}
                            fill={WINDOW_COLOR} fillOpacity={0.6} stroke={WINDOW_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                        />
                    ))}
                </Box>
                {swings.map(swing => <SwingBar key={swing.start} swing={swing} durationTicks={durationTicks} />)}
            </Box>
        </Box>
    );
}

function LegendItem({ color, label, opacity = 1 }: { color: string; label: string; opacity?: number }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Box sx={{ width: 12, height: 12, bgcolor: color, opacity, borderRadius: 0.25 }} />
            <Typography variant="caption">{label}</Typography>
        </Box>
    );
}

function FuelTimeline({ fuel, run }: { fuel: FuelViewData; run: FuelRunView }) {
    const { durationTicks } = run;
    const markerInterval = Math.ceil(durationTicks / 10 / 100) * 100;
    const tickMarkers: number[] = [];
    for (let tick = 0; tick <= durationTicks; tick += markerInterval) {
        tickMarkers.push(tick);
    }

    return (
        <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                <LegendItem color={LEVEL_COLOR} label="Fuel in the machine" />
                <LegendItem color={WINDOW_COLOR} label="Fuel clock enables the inserter" opacity={0.6} />
                <LegendItem color={SWING_COLOR} label="Inserter swings" />
                <LegendItem color={EMPTY_COLOR} label="No fuel" opacity={0.5} />
            </Box>

            <Box sx={{ display: 'flex', mb: 0.5 }}>
                <Box sx={{ width: LABEL_WIDTH, flexShrink: 0 }} />
                <Box sx={{ flex: 1, position: 'relative', height: 20 }}>
                    {tickMarkers.map(tick => (
                        <Typography
                            key={tick}
                            variant="caption"
                            sx={{
                                position: 'absolute',
                                left: `${(tick / durationTicks) * 100}%`,
                                transform: 'translateX(-50%)',
                                color: 'text.secondary',
                                fontSize: '0.65rem',
                            }}
                        >
                            {tick}
                        </Typography>
                    ))}
                </Box>
            </Box>

            {fuel.plan.machines.map(machine => {
                const levels = run.levels.find(it => it.machine_id === machine.machine_id);
                return (
                    <Box key={machine.machine_id} sx={{ mb: 2 }}>
                        {levels && (
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Box sx={{ width: LABEL_WIDTH, flexShrink: 0, pr: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <FactorioIcon name={machine.output_item} size={18} />
                                        <Typography variant="body2" noWrap sx={{ fontSize: '0.75rem' }}>
                                            {machineLabel(machine.machine_id)} ({machine.recipe})
                                        </Typography>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: '0.65rem' }}>
                                        {machine.fuel_item} {levels.min_level.toFixed(1)} to {levels.max_level.toFixed(1)}
                                    </Typography>
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <FuelLevelChart levels={levels} durationTicks={durationTicks} insertionLimit={machine.insertion_limit} />
                                </Box>
                            </Box>
                        )}
                        {fuel.plan.inserters.filter(inserter => inserter.machine_id === machine.machine_id).map(inserter => (
                            <FuelClockRow
                                key={inserter.inserter_id}
                                inserter={inserter}
                                swings={run.swings[inserter.inserter_id] ?? []}
                                durationTicks={durationTicks}
                            />
                        ))}
                    </Box>
                );
            })}
        </>
    );
}

/**
 * Fuel is outside the transfer plan: what each burner machine uses, the fuel clocks the blueprint exports to refill
 * them, and the exported clock run long enough to show the fuel going down and being refilled.
 */
function FuelPanelComponent({ fuel }: FuelPanelProps) {
    const { plan, run } = fuel;
    return (
        <Box>
            {run && <RanOutAlert run={run} />}

            <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="h6">Fuel consumption</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    A machine burns fuel only while it crafts, so it burns its crafting share of the rate over a clock period.
                </Typography>
                <MachineTable machines={plan.machines} run={run} />
            </Paper>

            <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="h6">Fuel clocks</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    A fuel inserter is enabled for a few ticks as often as the fuel slot's limit lasts, whatever the clock period is.
                    It only swings when the slot is below the limit, so most enables pass without a swing. {exportedClockText(fuel)}
                </Typography>
                <InserterTable inserters={plan.inserters} run={run} />
            </Paper>

            {run && (
                <Paper sx={{ p: 2 }}>
                    <Typography variant="h6">Fuel timeline</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        The exported clock run for {run.periods} clock periods: {run.durationTicks} ticks ({(run.durationTicks / 60).toFixed(1)} seconds).
                        The dashed line is the fuel slot's limit.
                    </Typography>
                    <FuelTimeline fuel={fuel} run={run} />
                </Paper>
            )}
        </Box>
    );
}

export const FuelPanel = memo(FuelPanelComponent);
