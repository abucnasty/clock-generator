import { Alert, Box, Tooltip, Typography } from '@mui/material';
import { memo, useId } from 'react';
import type { FuelInserterPlan, FuelLevelSeries, FuelMachinePlan } from 'clock-generator/browser';
import type { FuelRunView, FuelSwing, FuelViewData } from '../worker/types';
import { CHART_NAMES, SCROLL_REGION_NAMES } from '../utils/a11yLabels';
import { entityLabel } from '../utils/entityLabel';
import { FactorioIcon } from './FactorioIcon';
import { ChartSwatch } from './BeltChart';
import { GameName } from './GameName';
import { InserterStatus, MachineStatus } from 'clock-generator/light';
import { useChartColors } from '../hooks/useChartColors';
import { Panel } from './Panel';
import { CHART_MIN_WIDTH, ScrollX } from './ScrollX';
import { DataTable } from './DataTable';
import { Disclosure } from './Disclosure';
import { fuelEventRows, fuelTraceSummary, type FuelEventRow } from '../utils/fuelAccessibility';
import { durationText } from '../utils/numberText';

/** One line to a cell, the first (the entity's name) apart: the tables scroll sideways in their box instead of breaking a value over five lines */
/** The same for the fuel clocks, whose last cell ("17 in 3 wake windows (5.1/min)") is the one that wraps */
const NOWRAP_CLOCK_CELLS = { '& td:not(:first-of-type):not(:last-of-type)': { whiteSpace: 'nowrap' } } as const;
const NOWRAP_CELLS = { '& td:not(:first-of-type)': { whiteSpace: 'nowrap' } } as const;
const LABEL_WIDTH = 200;
const LEVEL_HEIGHT = 56;
const ROW_HEIGHT = 20;

const ticksAndSeconds = (ticks: number) => durationText(Math.round(ticks));
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
            + `${plan.period_ticks} tick clock period and ${fuelClocks}. Modulo combinators give the clock period and each fuel clock from it.`;
    }
    return `The blueprint has ${fuelClocks} next to the main clock, each with a counter of its own, because `
        + (plan.separate_clocks_reason === 'fractional_period'
            ? `the ${plan.period_ticks.toFixed(3)} tick clock period is not a whole number of ticks.`
            : 'one clock for all of them would count further than a signal can hold.');
}

function RanOutAlert({ run }: { run: FuelRunView }) {
    const span = `${run.durationTicks} ticks (${run.periods} clock periods)`;
    const empty = run.levels.filter(levels => levels.empty_ticks > 0);
    if (empty.length > 0) {
        return (
            <Alert severity="error" sx={{ mb: 2 }}>
                {empty.map(levels => `${entityLabel('machine', levels.machine_number)} ran out of fuel at tick ${levels.first_empty_tick} `
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
    const levelsOf = (machine: FuelMachinePlan) => run?.levels.find(levels => levels.machine_id === machine.machine_id);
    return <DataTable label={SCROLL_REGION_NAMES.fuelConsumption} minWidth={720} sx={NOWRAP_CELLS} rows={machines} rowKey={machine => machine.machine_id} columns={[
        { header: 'Machine', sx: { minWidth: 160 }, cell: machine => <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <FactorioIcon name={machine.output_item} size={18} alt="" />
            <Box>
                {entityLabel('machine', machine.machine_number)}
                <Typography variant="caption" color="text.secondary" component="div"><GameName id={machine.recipe} kind="recipe" /></Typography>
            </Box>
        </Box> },
        { header: 'Fuel', cell: machine => <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <FactorioIcon name={machine.fuel_item} size={18} alt="" />
            <GameName id={machine.fuel_item} />
        </Box> },
        { header: 'Burn while crafting', align: 'right', cell: machine => `${machine.burn_rate_per_second.toFixed(3)}/s` },
        { header: 'Crafts', align: 'right', cell: machine => percent(machine.crafting_share) },
        { header: 'Effective burn', align: 'right', cell: machine => `${machine.effective_burn_rate_per_second.toFixed(3)}/s` },
        { header: 'Per clock period', align: 'right', cell: machine => machine.burned_per_period.toFixed(2) },
        { header: `Limit of ${machines[0]?.insertion_limit} lasts`, align: 'right', cell: machine => machine.insertion_limit_lasted_at_least_ticks === undefined
            ? ticksAndSeconds(machine.insertion_limit_lasts_ticks)
            : `at least ${ticksAndSeconds(machine.insertion_limit_lasted_at_least_ticks)}` },
        { header: 'Energy use', align: 'right', cell: machine => `${machine.energy_consumption_bonus >= 0 ? '+' : ''}${machine.energy_consumption_bonus.toFixed(0)}%` },
        run !== null && { header: 'Simulated burn', align: 'right', cell: machine => {
            const levels = levelsOf(machine);
            return levels ? `${(levels.burned / run.durationTicks * 60).toFixed(3)}/s` : '-';
        } },
        run !== null && { header: 'Lowest fuel', align: 'right', cell: machine => {
            const levels = levelsOf(machine);
            return levels ? <Box component="span" sx={{ color: levels.empty_ticks > 0 ? 'error.light' : undefined }}>{levels.min_level.toFixed(2)}</Box> : '-';
        } },
    ]} />;
}

function InserterTable({ inserters, run }: { inserters: FuelInserterPlan[]; run: FuelRunView | null }) {
    return <DataTable label={SCROLL_REGION_NAMES.fuelClocks} minWidth={640} sx={NOWRAP_CLOCK_CELLS} rows={inserters} rowKey={inserter => inserter.inserter_id} columns={[
        { header: 'Inserter', cell: inserter => entityLabel('inserter', inserter.inserter_number) },
        { header: 'Feeds', cell: inserter => entityLabel('machine', inserter.machine_number) },
        { header: 'Switched on every', align: 'right', cell: inserter => `${inserter.modulus} ticks` },
        { header: 'Wake window (ticks)', align: 'right', cell: inserter => `${inserter.window.start} to ${inserter.window.end}` },
        { header: 'Wake windows', align: 'right', cell: inserter => `${inserter.enables_per_minute.toFixed(1)}/min` },
        { header: 'A hand lasts', align: 'right', cell: inserter => `${inserter.hand_size} for ${ticksAndSeconds(inserter.hand_lasts_ticks)}` },
        { header: 'Expected swings', align: 'right', cell: inserter => `${inserter.expected_swings_per_minute.toFixed(1)}/min` },
        { header: 'Wake windows with a swing', align: 'right', cell: inserter => percent(inserter.swing_share) },
        run !== null && { header: 'Simulated swings', align: 'right', cell: inserter => {
            const swings = run.swings[inserter.inserter_id] ?? [];
            const enables = Math.ceil(run.durationTicks / inserter.modulus);
            return `${swings.length} in ${enables} wake windows (${(swings.length / run.durationTicks * 3600).toFixed(1)}/min)`;
        } },
    ]} />;
}

/** The fuel a machine held: the highest of each sample as an area, the lowest as a line, and the insertion limit dashed */
function FuelLevelChart({ levels, durationTicks, insertionLimit, label, descriptionId }: { levels: FuelLevelSeries; durationTicks: number; insertionLimit: number; label: string; descriptionId: string }) {
    const { palette, track: TIMELINE_TRACK_COLOR, machine } = useChartColors();
    const LEVEL_COLOR = palette.skyBlue, WINDOW_COLOR = palette.lightGrey, EMPTY_COLOR = machine[MachineStatus.NO_FUEL];
    const top = Math.max(levels.max_level, insertionLimit) * 1.08;
    const y = (level: number) => (1 - level / top) * LEVEL_HEIGHT;
    const x = (sample: number) => Math.min(sample * levels.ticks_per_sample, durationTicks);
    // each sample is a step as wide as the ticks it covers
    const steps = (values: number[]) => values.flatMap((value, sample) => [`${x(sample)},${y(value)}`, `${x(sample + 1)},${y(value)}`]);
    const emptySamples = levels.empty_ticks === 0 ? [] : levels.min.flatMap((min, sample) => min <= 0 ? [sample] : []);

    return (
        <Box
            component="svg"
            role="img"
            aria-label={CHART_NAMES.fuelLevel(label)}
            aria-describedby={descriptionId}
            viewBox={`0 0 ${durationTicks} ${LEVEL_HEIGHT}`}
            preserveAspectRatio="none"
            sx={{ display: 'block', width: '100%', height: LEVEL_HEIGHT, bgcolor: TIMELINE_TRACK_COLOR, borderRadius: 0.5 }}
        >
            <polygon points={[`0,${LEVEL_HEIGHT}`, ...steps(levels.max), `${durationTicks},${LEVEL_HEIGHT}`].join(' ')} fill={LEVEL_COLOR} fillOpacity={0.3} stroke={LEVEL_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <polyline points={steps(levels.min).join(' ')} fill="none" stroke={LEVEL_COLOR} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <line
                x1={0} x2={durationTicks} y1={y(insertionLimit)} y2={y(insertionLimit)}
                stroke={WINDOW_COLOR} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
            />
            {emptySamples.map(sample => (
                <rect
                    key={sample} x={x(sample)} width={x(sample + 1) - x(sample)} y={0} height={LEVEL_HEIGHT}
                    fill={EMPTY_COLOR} fillOpacity={1} stroke={EMPTY_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                />
            ))}
        </Box>
    );
}

function SwingBar({ swing, durationTicks, inserterNumber }: { swing: FuelSwing; durationTicks: number; inserterNumber: number }) {
    const { inserter } = useChartColors();
    const SWING_COLOR = inserter[InserterStatus.SWING];
    return (
        <Tooltip
            title={`${swing.amount} items, tick ${swing.start} to ${swing.end}`}
            arrow
            placement="top"
        >
            <Box
                data-fuel-event={`${inserterNumber}:${swing.start}:${swing.end}:${swing.amount}`}
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
function FuelClockRow({ inserter, swings, durationTicks, descriptionId }: { inserter: FuelInserterPlan; swings: FuelSwing[]; durationTicks: number; descriptionId: string }) {
    const { palette, track: TIMELINE_TRACK_COLOR } = useChartColors();
    const WINDOW_COLOR = palette.lightGrey;
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
                    {entityLabel('inserter', inserter.inserter_number)}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: '0.65rem' }}>
                    every {inserter.modulus}
                </Typography>
            </Box>
            <Box sx={{ flex: 1, height: ROW_HEIGHT, position: 'relative', bgcolor: TIMELINE_TRACK_COLOR, borderRadius: 0.5 }}>
                <Box
                    component="svg"
                    role="img"
                    aria-label={CHART_NAMES.fuelClock(entityLabel('inserter', inserter.inserter_number))}
                    aria-describedby={descriptionId}
                    viewBox={`0 0 ${durationTicks} 1`}
                    preserveAspectRatio="none"
                    sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                >
                    {windowStarts.map(start => (
                        // the stroke keeps a window visible when a long run makes it narrower than a pixel
                        <rect
                            key={start} x={start} width={windowTicks} y={0} height={1}
                            fill={WINDOW_COLOR} fillOpacity={1} stroke={WINDOW_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke"
                        />
                    ))}
                </Box>
                {swings.map(swing => <SwingBar key={swing.start} swing={swing} durationTicks={durationTicks} inserterNumber={inserter.inserter_number} />)}
            </Box>
        </Box>
    );
}

function LegendItem({ color, label }: { color: string; label: string }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, bgcolor: 'action.hover', borderRadius: 1 }}>
            <ChartSwatch color={color} sx={{ width: 12, height: 12 }} />
            <Typography variant="caption">{label}</Typography>
        </Box>
    );
}

function FuelTimeline({ fuel, run }: { fuel: FuelViewData; run: FuelRunView }) {
    const { palette, inserter, machine } = useChartColors();
    const LEVEL_COLOR = palette.skyBlue, WINDOW_COLOR = palette.lightGrey, SWING_COLOR = inserter[InserterStatus.SWING], EMPTY_COLOR = machine[MachineStatus.NO_FUEL];
    const { durationTicks } = run;
    const summaryId = useId();
    const events: FuelEventRow[] = fuelEventRows(fuel);
    const markerInterval = Math.ceil(durationTicks / 10 / 100) * 100;
    const tickMarkers: number[] = [];
    for (let tick = 0; tick <= durationTicks; tick += markerInterval) {
        tickMarkers.push(tick);
    }

    return (
        <>
            {run.levels.map(levels => (
                <Typography key={levels.machine_id} id={`${summaryId}-machine-${levels.machine_number}`} variant="body2" sx={{ mb: 1.5 }}>
                    {fuelTraceSummary(levels, durationTicks)}
                </Typography>
            ))}
            {fuel.plan.inserters.map(inserter => (
                <Typography key={inserter.inserter_id} id={`${summaryId}-inserter-${inserter.inserter_number}`} variant="body2" sx={{ mb: 1.5 }}>
                    Inserter {inserter.inserter_number} feeds Machine {inserter.machine_number}. Its fuel clock switches it on every {inserter.modulus} ticks,
                    from tick {inserter.window.start} to {inserter.window.end} of that clock.
                    {' '}{(run.swings[inserter.inserter_id] ?? []).length} swings recorded over {durationTicks} ticks; Fuel events lists their start, end and items.
                </Typography>
            ))}
            <Disclosure summary="Fuel events" sx={{ mb: 2 }}>
                {events.length === 0 ? (
                    <Typography variant="body2">No fuel inserter swings were recorded in this run.</Typography>
                ) : <DataTable label={SCROLL_REGION_NAMES.fuelEvents} caption="Fuel inserter events" rows={events} rowKey={(_, index) => index} columns={[
                    { header: 'Inserter', cell: event => `Inserter ${event.inserterNumber}` },
                    { header: 'Feeds', cell: event => `Machine ${event.machineNumber}` },
                    { header: 'Start tick', cell: event => event.startTick },
                    { header: 'End tick', cell: event => event.endTick },
                    { header: 'Items', cell: event => event.amount },
                ]} />}
            </Disclosure>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                <LegendItem color={LEVEL_COLOR} label="Fuel in the machine" />
                <LegendItem color={WINDOW_COLOR} label="Fuel clock switches the inserter on" />
                <LegendItem color={SWING_COLOR} label="Inserter swings" />
                <LegendItem color={EMPTY_COLOR} label="No fuel" />
            </Box>

            <ScrollX label={SCROLL_REGION_NAMES.fuelTimeline} minWidth={CHART_MIN_WIDTH} tickRoom>
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
                                        <FactorioIcon name={machine.output_item} size={18} alt="" />
                                        {/* wraps: a long recipe name is not cut at the label column's edge */}
                                        <Typography variant="body2" sx={{ fontSize: '0.75rem', minWidth: 0 }}>
                                            {entityLabel('machine', machine.machine_number)} (<GameName id={machine.recipe} kind="recipe" />)
                                        </Typography>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: '0.65rem' }}>
                                        <GameName id={machine.fuel_item} /> {levels.min_level.toFixed(1)} to {levels.max_level.toFixed(1)}
                                    </Typography>
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <FuelLevelChart levels={levels} durationTicks={durationTicks} insertionLimit={machine.insertion_limit} label={entityLabel('machine', machine.machine_number)} descriptionId={`${summaryId}-machine-${machine.machine_number}`} />
                                </Box>
                            </Box>
                        )}
                        {fuel.plan.inserters.filter(inserter => inserter.machine_id === machine.machine_id).map(inserter => (
                            <FuelClockRow
                                key={inserter.inserter_id}
                                inserter={inserter}
                                swings={run.swings[inserter.inserter_id] ?? []}
                                durationTicks={durationTicks}
                                descriptionId={`${summaryId}-inserter-${inserter.inserter_number}`}
                            />
                        ))}
                    </Box>
                );
            })}
            </ScrollX>
        </>
    );
}

/**
 * Fuel is outside the swing plan: what each burner machine uses, the fuel clocks the blueprint exports to refill
 * them, and the exported clock run long enough to show the fuel going down and being refilled.
 */
function FuelPanelComponent({ fuel }: FuelPanelProps) {
    const { plan, run } = fuel;
    return (
        <Box>
            {run && <RanOutAlert run={run} />}

            {/* inside Results' Details, under its Fuel tab: the cards are a level below the section */}
            <Panel title="Fuel consumption" level={3}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    A machine burns fuel only while it crafts, so it burns its crafting share of the rate over a clock period.
                </Typography>
                <MachineTable machines={plan.machines} run={run} />
            </Panel>

            <Panel title="Fuel clocks" level={3}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    A fuel clock switches its inserter on for a few ticks (a wake window) as often as the fuel slot's limit
                    lasts, whatever the clock period is. The inserter only swings when the slot is below the limit, so most
                    wake windows pass without a swing. {exportedClockText(fuel)}
                </Typography>
                <InserterTable inserters={plan.inserters} run={run} />
            </Panel>

            {run && (
                <Panel title="Fuel timeline" level={3} sx={{ mb: 0 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        The exported clock run for {run.periods} clock periods: {durationText(run.durationTicks)}.
                        The dashed line is the fuel slot's limit.
                    </Typography>
                    <FuelTimeline fuel={fuel} run={run} />
                </Panel>
            )}
        </Box>
    );
}

export const FuelPanel = memo(FuelPanelComponent);
