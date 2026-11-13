import { InfoOutlined, WarningAmber } from '@mui/icons-material';
import { alpha, Box, Button, ButtonBase, Tooltip, Typography, useTheme } from '@mui/material';
import { useId, useState, type ReactNode } from 'react';
import type { InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { useGameNames } from '../hooks/useGameNames';
import { ADVISORY_COPY, advisoryInserters, advisoryLine, advisoryMachines, dropsByTiles, idLines, pickupFact, type Advisory } from '../utils/advisory';
import { entityLabel, type LabelKind } from '../utils/entityLabel';
import { AppDialog } from './AppDialog';
import { EntityBadge } from './EntityBadge';
import { FactorioIcon } from './FactorioIcon';
import { MachineIcon } from './MachineIcon';
import { WithQuality } from './QualityBadge';

/**
 * An advisory of the Build check as one line: its mark, what it is, the inserters or machines it is about (each a step to
 * its row), and Details, which opens a window with the rest.
 */
export function AdvisoryLine({ advisory, severity, inserters, machines, onReviewInserter, onReviewMachine }: {
    advisory: Advisory;
    severity: 'warning' | 'info' | 'error';
    inserters: readonly InserterFormData[];
    machines: readonly MachineFormData[];
    onReviewInserter?: (id: number) => void;
    onReviewMachine?: (id: number) => void;
}) {
    const [open, setOpen] = useState(false);
    const line = advisoryLine(advisory);
    const note = severity === 'info';
    const Mark = note ? InfoOutlined : WarningAmber;
    const inserterIds = advisoryInserters(advisory);
    const machineIds = advisoryMachines(advisory);
    return <Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 1 }}>
            <Mark sx={{ color: `${severity}.main` }} titleAccess={note ? ADVISORY_COPY.marks.info : ADVISORY_COPY.marks.warning} />
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{line}</Typography>
            {inserterIds.length > 0 && <Chips label={ADVISORY_COPY.chips.inserters} kind="inserter" ids={inserterIds} onClick={onReviewInserter}
                icon={id => <InserterChipIcon value={inserters.find(row => row.id === id)} />} />}
            {machineIds.length > 0 && <Chips label={ADVISORY_COPY.chips.machines} kind="machine" ids={machineIds} onClick={onReviewMachine}
                icon={id => <MachineIcon machine={machines.find(row => row.id === id) ?? {}} size={20} />} />}
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" color="inherit" variant="outlined" onClick={() => setOpen(true)}>{ADVISORY_COPY.details}</Button>
        </Box>
        <AppDialog open={open} onClose={() => setOpen(false)} title={line} closeButton maxWidth="sm">
            <AdvisoryDetail advisory={advisory} inserters={inserters} />
        </AppDialog>
    </Box>;
}

/** The entities of a line as the rows show them: icon and number; each a button to its row where there is a step to it */
function Chips({ label, kind, ids, icon, onClick }: {
    label: string; kind: LabelKind; ids: number[]; icon: (id: number) => ReactNode; onClick?: (id: number) => void;
}) {
    return <Box component="ul" aria-label={label} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, m: 0, p: 0, listStyle: 'none' }}>
        {ids.map(id => {
            const name = entityLabel(kind, id);
            const badge = <EntityBadge id={id} size="small"><Box component="span" aria-hidden sx={{ display: 'inline-flex' }}>{icon(id)}</Box></EntityBadge>;
            return <Box component="li" key={id} sx={{ display: 'flex' }}>
                {onClick
                    ? <Tooltip title={name}>
                        <ButtonBase aria-label={`Review ${name.toLowerCase()}`} onClick={() => onClick(id)}
                            sx={{ borderRadius: 0.5, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 } }}>{badge}</ButtonBase>
                    </Tooltip>
                    : <Box component="span" title={name}>{badge}</Box>}
            </Box>;
        })}
    </Box>;
}

/** An inserter's icon with its quality, as its row shows it; a stack inserter where the row is not known */
function InserterChipIcon({ value }: { value: InserterFormData | undefined }) {
    return <WithQuality quality={value?.quality ?? 'legendary'} size={20}>
        <FactorioIcon name={value?.prototype ?? 'stack-inserter'} size={20} alt="" />
    </WithQuality>;
}

/** The window of an advisory: a picture or a list where there is one, then why, what it can cost and what to do where its words say them */
function AdvisoryDetail({ advisory, inserters }: { advisory: Advisory; inserters: readonly InserterFormData[] }) {
    const { itemLabel } = useGameNames();
    switch (advisory.kind) {
        case 'side-loaded-drop': {
            const words = ADVISORY_COPY.sideLoadedDrop;
            return <Box sx={{ display: 'grid', gap: 2 }}>
                {dropsByTiles(advisory.drops).map(group => <SideLoadDrawing key={group.tiles} tiles={group.tiles} inserters={group.inserters}
                    icon={inserters.find(row => row.id === group.inserters[0])?.prototype ?? 'stack-inserter'} />)}
                <Facts rows={[[ADVISORY_COPY.labels.why, words.why], [ADVISORY_COPY.labels.cost, words.cost], [ADVISORY_COPY.labels.fix, words.fix]]} />
            </Box>;
        }
        case 'pickup-not-tested': {
            const words = ADVISORY_COPY.pickupNotTested;
            return <Box sx={{ display: 'grid', gap: 2 }}>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {advisory.pickups.map(pickup => <Typography component="li" variant="body2" key={`${pickup.inserter_id}:${pickup.item}`}>{pickupFact(pickup, itemLabel)}</Typography>)}
                </Box>
                <Facts rows={[[ADVISORY_COPY.labels.why, words.why], [ADVISORY_COPY.labels.cost, words.cost]]} />
            </Box>;
        }
        case 'machine-prototype':
            return <Box sx={{ display: 'grid', gap: 1 }}>
                {advisory.machines.map(machine => <Typography variant="body2" key={machine.machine_id}>{machine.message}</Typography>)}
            </Box>;
        default:
            // the engine's words, whole: they say what and what to do in each sentence
            return <Typography variant="body2">{advisory.text}</Typography>;
    }
}

function Facts({ rows }: { rows: [string, string][] }) {
    return <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '9.5rem 1fr' }, columnGap: 2, rowGap: { xs: 0.25, sm: 1 } }}>
        {rows.map(([label, text]) => <Box key={label} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="overline" color="text.secondary" sx={{ lineHeight: 1.6, mt: { xs: 1, sm: 0 } }}>{label}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>{text}</Typography>
        </Box>)}
    </Box>;
}

/** Tiles of a belt seen from above, with chevrons the way it moves */
function BeltTiles({ x, y, count, direction, size, fill, edge, chevron }: {
    x: number; y: number; count: number; direction: 'right' | 'down'; size: number; fill: string; edge: string; chevron: string;
}) {
    const tiles: ReactNode[] = [];
    for (let i = 0; i < count; i++) {
        const tx = direction === 'right' ? x + i * size : x;
        const ty = direction === 'down' ? y + i * size : y;
        const c = size / 2;
        const points = direction === 'right'
            ? `${tx + c - 4},${ty + c - 6} ${tx + c + 3},${ty + c} ${tx + c - 4},${ty + c + 6}`
            : `${tx + c - 6},${ty + c - 4} ${tx + c},${ty + c + 3} ${tx + c + 6},${ty + c - 4}`;
        tiles.push(<g key={i}>
            <rect x={tx} y={ty} width={size} height={size} fill={fill} stroke={edge} />
            <polyline points={points} fill="none" stroke={chevron} strokeWidth={2} />
        </g>);
    }
    return <>{tiles}</>;
}

/**
 * The shape the advisory is about, from above: the inserters drop onto a short belt of `tiles` tiles that side-loads onto
 * the other belt, which is fed from behind; other inserters drop onto the other belt further on. At most four tiles of the
 * short belt are drawn; the count says how many it has.
 */
function SideLoadDrawing({ tiles, inserters, icon }: { tiles: number; inserters: number[]; icon: string }) {
    const theme = useTheme();
    const arrow = `advisory-arrow-${useId().replace(/:/g, '')}`;
    const words = ADVISORY_COPY.sideLoadedDrop;
    const T = 28;
    const lines = idLines(inserters);
    const shown = Math.max(Math.min(tiles, 4), 1);
    // room for the inserters' numbers beside the short belt, a line each
    const top = 18 + Math.max(0, (lines.length - 1) * 16 - (shown - 1) * T);
    const beltY = top + shown * T;
    const shortX = 20 + 7 * T;
    const otherX = 20 + 11 * T;
    const width = 460;
    const height = beltY + T + 30;
    const c = {
        text: theme.palette.text.primary, muted: theme.palette.text.secondary, edge: alpha(theme.palette.text.primary, 0.35),
        belt: alpha(theme.palette.text.primary, 0.08), chevron: alpha(theme.palette.text.primary, 0.55), warn: theme.palette.warning.main,
    };
    const iconHref = `/icons/${icon.toLowerCase().replace(/_/g, '-')}.png`;
    return <Box component="figure" sx={{ m: 0 }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: 540, display: 'block' }} role="img" aria-label={words.drawing(inserters, tiles)}>
            <defs>
                <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill={c.text} />
                </marker>
            </defs>
            <g aria-hidden>
                {/* the other belt, fed from behind */}
                <BeltTiles x={20} y={beltY} count={14} direction="right" size={T} fill={c.belt} edge={c.edge} chevron={c.chevron} />
                <text x={20} y={beltY + T + 18} fontSize={12} fill={c.muted}>{words.otherBelt}</text>
                {/* the short belt and the side-load */}
                <BeltTiles x={shortX} y={top} count={shown} direction="down" size={T} fill={alpha(c.warn, 0.12)} edge={c.warn} chevron={c.warn} />
                <rect x={shortX - 1} y={beltY} width={T + 2} height={T} fill="none" stroke={c.warn} strokeWidth={2} strokeDasharray="4 3" />
                <path d={`M ${shortX + T + 8} ${top} h 6 V ${beltY} h -6`} fill="none" stroke={c.muted} />
                <text x={shortX + T + 20} y={top + (beltY - top) / 2 + 4} fontSize={12} fill={c.muted}>{words.tiles(tiles)}</text>
                {/* the inserters of the advisory, dropping onto the short belt's first tile */}
                <image href={iconHref} x={shortX - T - 26} y={top} width={T} height={T} />
                <line x1={shortX - 24} y1={top + T / 2} x2={shortX - 2} y2={top + T / 2} stroke={c.text} strokeWidth={1.5} markerEnd={`url(#${arrow})`} />
                <text x={shortX - T - 32} y={top + T / 2 + 4} fontSize={13} fontWeight={700} fill={c.text} textAnchor="end">
                    {lines.map((text, index) => <tspan key={index} x={shortX - T - 32} dy={index === 0 ? 0 : 16}>{text}</tspan>)}
                </text>
                {/* other inserters dropping onto the other belt further on */}
                <image href={iconHref} x={otherX + 2} y={beltY - T - 8} width={T - 4} height={T - 4} opacity={0.55} />
                <line x1={otherX + T / 2} y1={beltY - 12} x2={otherX + T / 2} y2={beltY + 6} stroke={c.muted} strokeWidth={1.5} markerEnd={`url(#${arrow})`} />
                <text x={otherX + T + 6} y={beltY - 14} fontSize={12} fill={c.muted}>{words.others}</text>
            </g>
        </svg>
    </Box>;
}
