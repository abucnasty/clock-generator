import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useStore, type Node, type NodeProps, type EdgeMarker, type Viewport } from '@xyflow/react';
import { Box, Button, Checkbox, FormControlLabel, LinearProgress, MenuItem, TextField, Typography } from '@mui/material';
import { Pause, PlayArrow, SkipNext, SkipPrevious } from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import type { Config, TimelineRecording } from 'clock-generator/browser';
import { buildFlowGraph, type EntityNodeData, type InserterNodeData, type DrillNodeData, ENTITY_NODE_WIDTH, INSERTER_NODE_WIDTH, INSERTER_NODE_CHIP_WIDTH, DRILL_NODE_WIDTH } from '../utils/buildFlowGraph';
import { configToFormData } from '../utils/configForm/configMapping';
import { flowEntityKey, flowFocus } from '../utils/flowFocus';
import { adjacentTransfer, flowEventSummary, flowReplayEvents, flowReplayIndex, flowReplaySnapshot, flowReplayCycles, type FlowReplaySnapshot } from '../utils/flowReplay';
import { craftingCycleAt, craftingCycleIndex } from '../utils/craftingCycles';
import type { TimelineInspection } from '../utils/timelineInspection';
import { timelineStateLabel, timelineStateStyle } from '../utils/timelinePresentation';
import { patternBackground } from '../theme/beltCharts';
import { themeTokens } from '../theme/runtimeTokens';
import { useMeasuredFlowNodes } from '../hooks/useMeasuredFlowNodes';
import { useGameNames } from '../hooks/useGameNames';
import { formatNumberText } from '../utils/numberText';
import { FactorioIcon } from './FactorioIcon';

const NODE_HEIGHT = 168;
const number = (value: number) => formatNumberText(value, { maxDecimals: 2 });
type ReplayData = (EntityNodeData | InserterNodeData | DrillNodeData) & {
    identity: string; snapshot: FlowReplaySnapshot; effects: ReturnType<typeof flowEventSummary>;
};

/** Fixed geometry: changing a state, held item or quantity never moves a neighbour. */
function ReplayNode({ data }: NodeProps<Node<ReplayData>>) {
    const tokens = themeTokens(useTheme());
    const { itemLabel, recipeLabel } = useGameNames();
    const compact = useStore(state => state.transform[2] < 0.65);
    const entity = 'entityType' in data ? data : null;
    const ins = 'inserterId' in data ? data : null;
    const drill = 'drillId' in data ? data : null;
    const label = entity?.label ?? (ins ? `Inserter ${ins.inserterId}` : `Drill ${drill?.drillId}`);
    const icon = entity?.iconName ?? drill?.drillType ?? 'stack-inserter';
    const color = ins ? tokens.control.border : tokens.role[entity?.entityType === 'belt' ? 'blue' : entity?.entityType === 'chest' ? 'green' : 'orange'].main;
    const snapshot = data.snapshot;
    const stateStyle = snapshot.state ? timelineStateStyle(snapshot.state) : null;
    const width = ins ? ins.enableChip ? INSERTER_NODE_CHIP_WIDTH : INSERTER_NODE_WIDTH : drill ? DRILL_NODE_WIDTH : ENTITY_NODE_WIDTH;
    return <>
        <Box title={entity?.entityType === 'belt' ? `${entity.halfTitle ?? entity.label}. Select to inspect a connected inserter; physical belt contents are not recorded.` : entity?.halfTitle} sx={{ width, height: NODE_HEIGHT, boxSizing: 'border-box', bgcolor: tokens.surface.panel, border: `2px solid ${color}`, borderRadius: 1, p: 1, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <FactorioIcon name={icon} size={28} alt="" />
                <Typography variant="subtitle2" sx={{ fontSize: compact ? 17 : 13, whiteSpace: 'nowrap', color: ins ? tokens.text.primary : color }}>{label}</Typography>
            </Box>
            <Typography variant="caption" noWrap component="div" sx={{ height: 17, visibility: compact ? 'hidden' : 'visible' }}>
                {entity?.machineParams?.recipe ? recipeLabel(entity.machineParams.recipe) : entity?.filterIcons?.map(itemLabel).join(', ') ?? (drill?.minedItem ? itemLabel(drill.minedItem) : 'Recorded transfers')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'start', gap: 0.5, height: 28 }}>
                {stateStyle && <Box aria-hidden sx={{ width: 12, height: 12, mt: 0.5, flexShrink: 0, background: patternBackground(stateStyle) }} />}
                <Typography variant="caption" sx={{ fontSize: 12, lineHeight: 1.3 }}>{snapshot.state ? timelineStateLabel(snapshot.state) : entity?.entityType === 'belt' ? 'Belt contents not recorded' : 'Recorded inventory'}</Typography>
            </Box>
            {snapshot.craft !== undefined ? <Box sx={{ height: 23 }}>
                <LinearProgress aria-label={`${label} craft progress`} variant="determinate" value={Math.max(0, Math.min(100, snapshot.craft))} />
                <Typography variant="caption">Craft {number(snapshot.craft)}%</Typography>
            </Box> : <Typography variant="caption" component="div" sx={{ height: 23 }}>{snapshot.enabled === undefined ? '' : snapshot.enabled ? 'Circuit enabled' : 'Circuit disabled'}</Typography>}
            <Box sx={{ height: 28, display: 'flex', gap: 0.5, alignItems: 'start', overflow: 'hidden' }}>
                {ins ? <>{snapshot.handItem && <FactorioIcon name={snapshot.handItem} size={20} alt="" />}<Typography variant="caption">{snapshot.hand ? `${number(snapshot.hand)} ${snapshot.handItem ? itemLabel(snapshot.handItem) : 'items'} in hand` : 'Empty hand'}</Typography></>
                    : snapshot.produced !== undefined ? <Typography variant="caption">{number(snapshot.produced)} made since tick 0</Typography>
                    : <Typography variant="caption">{snapshot.inventory.slice(0, 2).map(stock => `${stock.value} ${stock.item ? itemLabel(stock.item) : stock.unit}`).join(' · ')}</Typography>}
            </Box>
            <Typography variant="caption" component="div" title={data.effects.map(effect => `${effect.kind}: ${number(effect.amount)} ${effect.item ? itemLabel(effect.item) : 'items'}`).join('; ')} sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {data.effects.length ? data.effects.slice(0, 2).map(effect => <Box component="span" key={`${effect.kind}:${effect.item}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mr: 0.5 }}>{effect.item && <FactorioIcon name={effect.item} size={14} alt={itemLabel(effect.item)} />}{`${effect.kind === 'produce' ? '+' : effect.kind === 'pickup' ? '↑' : '↓'}${number(effect.amount)}`}</Box>) : ' '}
            </Typography>
        </Box>
        {(!entity || entity.half !== 'in') && !drill && <Handle type="target" id={ins?.vertical ? 'in' : undefined} position={ins?.vertical ? ins.vertical === 'down' ? Position.Top : Position.Bottom : Position.Left} />}
        {(!entity || entity.half !== 'out') && <Handle type="source" id={ins?.vertical ? 'out' : undefined} position={ins?.vertical ? ins.vertical === 'down' ? Position.Bottom : Position.Top : Position.Right} />}
        {entity?.verticalHandles && <>
            <Handle type="target" id="top-in" position={Position.Top} style={{ left: '35%' }} /><Handle type="source" id="top-out" position={Position.Top} style={{ left: '65%' }} />
            <Handle type="source" id="bottom-out" position={Position.Bottom} style={{ left: '35%' }} /><Handle type="target" id="bottom-in" position={Position.Bottom} style={{ left: '65%' }} />
        </>}
    </>;
}
const nodeTypes = { entityNode: ReplayNode, inserterNode: ReplayNode, drillNode: ReplayNode };

interface FlowReplayProps {
    config: Config; recording: TimelineRecording; tick: number; inspection: TimelineInspection; cycleTicks: number;
    onTick(tick: number): void; onChange(patch: Partial<TimelineInspection>): void; onInspectActivity(): void;
    fullscreen?: boolean;
}

export function FlowReplay(props: FlowReplayProps) {
    return <ReactFlowProvider><ReplayContent {...props} /></ReactFlowProvider>;
}

function ReplayContent({ config, recording, tick, inspection, cycleTicks, onTick, onChange, onInspectActivity, fullscreen }: FlowReplayProps) {
    const tokens = themeTokens(useTheme());
    const { itemLabel, recipeLabel } = useGameNames();
    const index = useMemo(() => flowReplayIndex(recording), [recording]);
    const form = useMemo(() => configToFormData(config), [config]);
    const graph = useMemo(() => buildFlowGraph(form.machines, form.inserters, form.belts, form.chests, form.drills?.configs ?? [], undefined, false, { itemLabel, recipeLabel }, NODE_HEIGHT), [form, itemLabel, recipeLabel]);
    const [playingRecording, setPlayingRecording] = useState<TimelineRecording | null>(null);
    const playing = playingRecording === recording;
    const speed = inspection.replaySpeed ?? 0.25;
    const cycles = useMemo(() => flowReplayCycles(cycleTicks, recording), [cycleTicks, recording]);
    const cycle = craftingCycleAt(cycles, craftingCycleIndex(cycles, tick));
    const firstTick = inspection.replayCycleOnly && cycle ? Math.ceil(cycle.start) : 0;
    const lastTick = inspection.replayCycleOnly && cycle ? Math.min(recording.end_tick, Math.ceil(cycle.end) - (cycle.end === cycles?.end ? 0 : 1)) : recording.end_tick;
    const cursor = useRef({ tick, onTick, lastTick }); cursor.current = { tick, onTick, lastTick };
    // A new recording starts paused, including when a cached clock is selected again.
    useEffect(() => { setPlayingRecording(null); }, [recording]);
    useEffect(() => {
        if (!playing) return;
        let frame = 0, previous: number | null = null, position = cursor.current.tick, published = cursor.current.tick;
        const advance = (time: number) => {
            if (cursor.current.tick !== published) { setPlayingRecording(null); return; }
            if (previous === null) previous = time;
            if (time - previous >= 50) {
                position += Math.min(250, time - previous) * 60 * speed / 1000;
                previous = time;
                const next = Math.min(cursor.current.lastTick, Math.floor(position));
                published = next;
                cursor.current.onTick(next);
                if (next >= cursor.current.lastTick) { setPlayingRecording(null); return; }
            }
            frame = requestAnimationFrame(advance);
        };
        frame = requestAnimationFrame(advance);
        return () => cancelAnimationFrame(frame);
    }, [playing, speed]);
    useEffect(() => {
        const pauseWhenHidden = () => { if (document.hidden) setPlayingRecording(null); };
        document.addEventListener('visibilitychange', pauseWhenHidden);
        return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
    }, []);
    const seek = (next: number) => { setPlayingRecording(null); onTick(next); };
    const effectStart = playing ? Math.max(0, tick - Math.ceil(speed * 6)) : tick;
    const effects = useMemo(() => flowReplayEvents(index, effectStart, tick), [index, effectStart, tick]);
    const focus = useMemo(() => flowFocus(graph.nodes, graph.edges, inspection.entityId), [graph, inspection.entityId]);
    const [hovered, setHovered] = useState<string | null>(null);
    const focusedId = inspection.replayFocus ? inspection.entityId : null;
    const routeFocus = useMemo(() => flowFocus(graph.nodes, graph.edges, hovered ?? focusedId), [graph, hovered, focusedId]);
    const nodeKeys = useMemo(() => new Map(graph.nodes.map(node => [node.id, flowEntityKey(node)])), [graph]);
    const nodes = useMemo(() => graph.nodes.map(node => {
        const key = flowEntityKey(node);
        return { ...node, selected: focus.same.has(node.id),
            ariaLabel: `${node.ariaLabel}. Press Enter to inspect recorded activity.`,
            style: { opacity: (hovered ?? focusedId) && !routeFocus.related.has(node.id) ? 0.65 : 1 },
            data: { ...node.data, identity: key, snapshot: flowReplaySnapshot(index, key, tick), effects: flowEventSummary(effects, key) } as ReplayData };
    }), [graph, index, tick, effects, focus, routeFocus, hovered, focusedId]);
    const measured = useMeasuredFlowNodes(nodes);
    const edges = useMemo(() => graph.edges.map(edge => {
        const from = nodeKeys.get(edge.source)!;
        const to = nodeKeys.get(edge.target)!;
        const transfers = effects.filter(event => event.kind === 'pickup' ? event.entity_id === to : event.kind === 'drop' ? event.entity_id === from : false);
        const active = transfers.length > 0;
        const highlighted = routeFocus.routes.has(edge.id);
        const color = active ? tokens.role.green.main : highlighted ? tokens.role.orange.main : tokens.control.border;
        return { ...edge, label: active ? transfers.reduce((sum, event) => sum + event.amount, 0) + ' items' : undefined,
            labelStyle: { fill: tokens.text.primary, fontSize: 12 }, labelBgStyle: { fill: tokens.surface.panel },
            markerEnd: { ...(edge.markerEnd as EdgeMarker), color }, style: { stroke: color, strokeWidth: active ? 4 : highlighted ? 2.5 : 1.5, opacity: (hovered ?? focusedId) && !highlighted && !active ? 0.3 : 1 } };
    }), [graph, effects, routeFocus, tokens, hovered, focusedId, nodeKeys]);
    const states = useMemo(() => [...new Set(recording.entities.flatMap(entity => entity.signals.filter(signal => signal.id === 'state').flatMap(signal => signal.values.map(String))))], [recording]);
    const previous = adjacentTransfer(index, tick, -1, firstTick, lastTick), next = adjacentTransfer(index, tick, 1, firstTick, lastTick);
    const chooseNode = (node: Node) => {
        setPlayingRecording(null);
        // Belts supply context in the map; select one of their recorded inserters for useful inspection.
        const key = flowEntityKey(node);
        const entity = index.entities.get(key)?.entity;
        const inspectId = entity?.type === 'belt' ? recording.entities.find(other => other.type === 'inserter' && (other.source === key || other.sink === key))?.id : key;
        if (inspectId) onChange({ entityId: inspectId, replayFocus: true });
    };
    return <Box component="section" aria-label="Flow replay">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1 }}>
            <Button startIcon={playing ? <Pause /> : <PlayArrow />} variant="contained" color="success" onClick={() => {
                if (playing) setPlayingRecording(null);
                else { if (tick >= lastTick) onTick(firstTick); setPlayingRecording(recording); }
            }}>{playing ? 'Pause' : 'Play'}</Button>
            <Button color="inherit" size="small" onClick={() => seek(Math.max(firstTick, tick - 1))} disabled={tick <= firstTick}>−1 tick</Button>
            <Button color="inherit" size="small" onClick={() => seek(Math.min(lastTick, tick + 1))} disabled={tick >= lastTick}>+1 tick</Button>
            <Button color="inherit" size="small" startIcon={<SkipPrevious />} disabled={previous === null} onClick={() => previous !== null && seek(previous)}>Previous transfer</Button>
            <Button color="inherit" size="small" endIcon={<SkipNext />} disabled={next === null} onClick={() => next !== null && seek(next)}>Next transfer</Button>
            <TextField select label="Playback speed" size="small" value={speed} onChange={event => onChange({ replaySpeed: Number(event.target.value) })} sx={{ minWidth: 130 }}>
                {[0.25, 0.5, 1, 2, 4, 8].map(value => <MenuItem key={value} value={value}>{value}×</MenuItem>)}
            </TextField>
            <Button color="inherit" size="small" onClick={() => { setPlayingRecording(null); onInspectActivity(); }}>Inspect activity</Button>
            {inspection.replayFocus && <Button color="inherit" size="small" onClick={() => onChange({ replayFocus: false })}>Show all routes</Button>}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
            <FormControlLabel label="Play one crafting cycle" control={<Checkbox size="small" disabled={!cycles} checked={inspection.replayCycleOnly === true && Boolean(cycles)} onChange={(_, checked) => { setPlayingRecording(null); onChange({ replayCycleOnly: checked }); }} />} />
            {cycle && <>
                <Button size="small" color="inherit" disabled={cycle.start === 0} onClick={() => { const target = craftingCycleAt(cycles, craftingCycleIndex(cycles, tick) - 1); if (target) seek(Math.ceil(target.start)); }}>Previous cycle</Button>
                <Typography variant="caption">Crafting cycle {craftingCycleIndex(cycles, tick) + 1} of {cycles?.count} · {number(cycle.start)}–{number(cycle.end)} ticks</Typography>
                <Button size="small" color="inherit" disabled={craftingCycleIndex(cycles, tick) + 1 === cycles?.count} onClick={() => { const target = craftingCycleAt(cycles, craftingCycleIndex(cycles, tick) + 1); if (target) seek(Math.ceil(target.start)); }}>Next cycle</Button>
            </>}
        </Box>
        <Box component="ul" aria-label="Flow replay legend" sx={{ m: 0, mb: 1, p: 0, display: 'flex', gap: 1.5, flexWrap: 'wrap', listStyle: 'none' }}>
            {states.map(state => <Box component="li" key={state} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}><Box aria-hidden sx={{ width: 18, height: 10, background: patternBackground(timelineStateStyle(state)) }} /><Typography variant="caption">{timelineStateLabel(state)}</Typography></Box>)}
        </Box>
        <Typography variant="caption" component="p" sx={{ mb: 1 }}>Play to follow recorded transfers. Green connections show pickups ↑ and deliveries ↓; orange shows the selected route. {playing ? `Highlights cover ticks ${effectStart}–${tick}.` : `Highlights show tick ${tick}.`} Belts show routes, not physical item positions.</Typography>
        <Box sx={{ height: fullscreen ? 'max(450px, calc(100vh - 440px))' : 600, minHeight: 400, bgcolor: tokens.surface.inset, border: 1, borderColor: 'divider',
            '--xy-node-color': tokens.text.primary, '--xy-handle-background-color': tokens.control.border,
            '& .react-flow__node.selected > div:first-of-type': { outline: `2px solid ${tokens.role.orange.main}`, outlineOffset: 3 },
            '& .react-flow__node:focus-visible > div:first-of-type': { outline: `2px solid ${tokens.control.focus}`, outlineOffset: 3 },
            '& .react-flow__controls-button': { bgcolor: tokens.surface.panel, color: tokens.text.primary, borderColor: tokens.control.border, '& svg': { fill: 'currentColor' } },
        }}>
            <ReactFlow nodes={measured.nodes} onNodesChange={measured.onNodesChange} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
                minZoom={0.1} maxZoom={2} fitView={!inspection.replayViewport} fitViewOptions={{ padding: 0.1 }} defaultViewport={inspection.replayViewport}
                onMoveEnd={(_, viewport: Viewport) => onChange({ replayViewport: viewport })}
                onNodeClick={(_, node) => chooseNode(node)} onNodeMouseEnter={(_, node) => setHovered(flowEntityKey(node))} onNodeMouseLeave={() => setHovered(null)}
                onPaneClick={() => onChange({ replayFocus: false })}
                onKeyDown={event => { const target = event.target as HTMLElement; if (event.key === 'Enter' && target.classList.contains('react-flow__node')) { const node = graph.nodes.find(node => node.id === target.dataset.id); if (node) { event.preventDefault(); chooseNode(node); } } }}
                ariaLabelConfig={{ 'node.a11yDescription.default': 'Press Enter to inspect recorded activity.', 'node.a11yDescription.keyboardDisabled': 'Press Enter to inspect recorded activity.' }}
                proOptions={{ hideAttribution: true }}>
                <Background color={tokens.control.edge} variant={BackgroundVariant.Dots} gap={20} size={1} /><Controls showInteractive={false} />
            </ReactFlow>
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>Node values describe one modelled copy at the selected tick. Production totals start at tick 0. Transfers are schematic, without simulated arm or belt positions. Playback stops at the recorded endpoint.</Typography>
    </Box>;
}
