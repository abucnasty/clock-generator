import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Button, Typography, useTheme } from '@mui/material';
import type { SwingComparison as SwingComparisonData } from 'clock-generator/browser';

/** A clocked drop further than this from every planned drop is a swing of its own, not the planned one moved */
const PAIR_WITHIN_TICKS = 40;
/** Moved by no more than this counts as on the plan */
const ON_PLAN_TICKS = 4;

const LABEL_WIDTH = 150;
const LANE_HEIGHT = 46;
const AXIS_HEIGHT = 22;
const PLOT_PADDING = 12;

interface Pair { planned: number | null; clocked: number | null }

/** Pair each clocked drop with the nearest unused planned drop, so a moved swing is drawn as one arrow */
function pairDrops(planned: number[], clocked: number[]): Pair[] {
    const free = new Set(planned.keys());
    const pairs: Pair[] = [];
    for (const tick of clocked) {
        let best = -1;
        for (const index of free) {
            if (best < 0 || Math.abs(planned[index] - tick) < Math.abs(planned[best] - tick)) best = index;
        }
        if (best >= 0 && Math.abs(planned[best] - tick) <= PAIR_WITHIN_TICKS) {
            free.delete(best);
            pairs.push({ planned: planned[best], clocked: tick });
        } else {
            pairs.push({ planned: null, clocked: tick });
        }
    }
    free.forEach(index => pairs.push({ planned: planned[index], clocked: null }));
    return pairs;
}

interface Lane { labels: string[]; planned: number[]; clocked: number[] }

/** Inserters that swing identically in both runs share a lane */
function groupLanes(data: SwingComparisonData): Lane[] {
    const lanes = new Map<string, Lane>();
    for (const it of data.inserters) {
        const key = `${it.planned.join(',')}|${it.clocked.join(',')}`;
        const lane = lanes.get(key);
        if (lane) lane.labels.push(it.label);
        else lanes.set(key, { labels: [it.label], planned: it.planned, clocked: it.clocked });
    }
    return [...lanes.values()];
}

function laneName(labels: string[]): string {
    const numbers = labels.map(it => it.replace(/^Inserter\s+/, ''));
    const name = numbers.every(it => /^\d+$/.test(it))
        ? `Inserter ${[...numbers].sort((a, b) => Number(a) - Number(b)).join(', ')}`
        : labels.join(', ');
    return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

/**
 * The plan's swings against the exported clock's, one lane per group of inserters: a ring where the plan dropped, a
 * dot where the clock does, and an arrow between the two so how far a swing moved can be seen at a glance.
 */
export function SwingComparison({ data }: { data: SwingComparisonData }) {
    const theme = useTheme();
    const [width, setWidth] = useState(900);
    const lanes = groupLanes(data);
    const plotWidth = Math.max(300, width - LABEL_WIDTH - PLOT_PADDING * 2);
    const x = (tick: number) => LABEL_WIDTH + PLOT_PADDING + (tick / data.period) * plotWidth;
    const height = AXIS_HEIGHT + lanes.length * LANE_HEIGHT;
    const step = [10, 20, 25, 50, 100, 200].find(it => data.period / it <= 12) ?? 500;
    const ticks = Array.from({ length: Math.floor(data.period / step) + 1 }, (_, i) => i * step);

    const planColor = theme.palette.text.secondary;
    const okColor = theme.palette.success.main;
    const movedColor = theme.palette.warning.main;
    const extraColor = theme.palette.error.main;
    const colorOf = (pair: Pair) => pair.planned === null || pair.clocked === null
        ? extraColor
        : Math.abs(pair.planned - pair.clocked) <= ON_PLAN_TICKS ? okColor : movedColor;

    return (
        <Box ref={(el: HTMLDivElement | null) => { if (el && Math.abs(el.clientWidth - width) > 1) setWidth(el.clientWidth); }}>
            <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', my: 1 }}>
                <Legend color={planColor} hollow text="Plan" />
                <Legend color={okColor} text="Clock, on plan" />
                <Legend color={movedColor} text="Clock, moved (arrow points to where it drops)" />
                <Legend color={extraColor} text="Only in one run" />
            </Box>
            <svg width={width} height={height} role="img" aria-label="Plan and exported clock drop ticks per inserter">
                <defs>
                    <marker id="swing-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 z" fill={movedColor} />
                    </marker>
                </defs>
                {ticks.map(tick => (
                    <g key={tick}>
                        <line x1={x(tick)} x2={x(tick)} y1={AXIS_HEIGHT - 4} y2={height} stroke={theme.palette.divider} />
                        <text x={x(tick)} y={12} fontSize={10} textAnchor="middle" fill={theme.palette.text.secondary}>{tick}</text>
                    </g>
                ))}
                {lanes.map((lane, index) => {
                    const top = AXIS_HEIGHT + index * LANE_HEIGHT;
                    const planY = top + 13;
                    const clockY = top + 33;
                    return (
                        <g key={index}>
                            <line x1={0} x2={width} y1={top} y2={top} stroke={theme.palette.divider} />
                            <text x={4} y={top + 20} fontSize={12} fill={theme.palette.text.primary}>
                                <title>{lane.labels.join(', ')}</title>
                                {laneName(lane.labels)}
                            </text>
                            <text x={4} y={top + 36} fontSize={10} fill={theme.palette.text.secondary}>
                                {lane.planned.length} planned, {lane.clocked.length} clocked
                            </text>
                            {pairDrops(lane.planned, lane.clocked).map((pair, i) => {
                                const color = colorOf(pair);
                                const moved = color === movedColor;
                                return (
                                    <g key={i}>
                                        {pair.planned !== null && (
                                            <circle cx={x(pair.planned)} cy={planY} r={4} fill="none" stroke={pair.clocked === null ? extraColor : planColor} strokeWidth={1.5}>
                                                <title>Plan: tick {pair.planned}</title>
                                            </circle>
                                        )}
                                        {moved && (
                                            <line x1={x(pair.planned!)} y1={planY + 4} x2={x(pair.clocked!)} y2={clockY - 5} stroke={movedColor} strokeWidth={1.2} markerEnd="url(#swing-arrow)" />
                                        )}
                                        {pair.clocked !== null && (
                                            <circle cx={x(pair.clocked)} cy={clockY} r={4} fill={color}>
                                                <title>
                                                    Clock: tick {pair.clocked}
                                                    {pair.planned !== null ? ` (plan ${pair.planned}, ${pair.clocked - pair.planned > 0 ? '+' : ''}${pair.clocked - pair.planned})` : ' (not in the plan)'}
                                                </title>
                                            </circle>
                                        )}
                                    </g>
                                );
                            })}
                        </g>
                    );
                })}
            </svg>
            <Typography variant="caption" color="text.secondary">
                Top row of each lane is the plan, bottom row the exported clock. Inserters that swing identically share a lane.
            </Typography>
        </Box>
    );
}

function Legend({ color, hollow, text }: { color: string; hollow?: boolean; text: string }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: hollow ? 'transparent' : color, border: `2px solid ${color}`, boxSizing: 'border-box' }} />
            <Typography variant="caption">{text}</Typography>
        </Box>
    );
}

/** Collapsed list of the exact ticks behind the chart */
export function ExactTicks({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
        <Box sx={{ mt: 1 }}>
            <Button size="small" onClick={() => setOpen(!open)}>{open ? 'Hide exact ticks' : 'Show exact ticks'}</Button>
            {open && children}
        </Box>
    );
}
