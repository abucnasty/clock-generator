import { Alert, AlertTitle, Box, Button, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { memo, useId, useMemo, useState } from 'react';
import type { InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import type { BeltFormData, ChestFormData, MachineFormData } from '../hooks/useConfigForm';
import { useGameNames } from '../hooks/useGameNames';
import { entityLabel } from '../utils/entityLabel';
import { coverageIssueElementId } from '../utils/firstProblem';
import { EntityBadge } from './EntityBadge';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { entityOptionsOf, findOption, type EntityOption } from '../utils/inserterOptions';
import { RouteBadge, ContentIcons } from './RouteIdentity';

interface Props {
    issues: InserterCoverageIssue[];
    machines?: MachineFormData[];
    belts?: BeltFormData[];
    chests?: ChestFormData[];
    onApplyFix: (issue: InserterCoverageIssue, fix: InserterFixOption) => void;
    fixUnavailable?: (fix: InserterFixOption, issue: InserterCoverageIssue) => string | null;
    focusTargets?: boolean;
}

interface Repair {
    key: string;
    issue: InserterCoverageIssue;
    fix: InserterFixOption;
    items: string[];
}

function repairKey(fix: InserterFixOption): string {
    switch (fix.type) {
        case 'existing_connection': return `connect:${fix.endpoint_type}:${fix.endpoint_id}`;
        case 'machine_to_machine': return `connect:machine:${fix.source_machine_id}`;
        case 'review_filters': return `review:${fix.inserter_id}`;
        case 'add_lane_to_existing_belt': return `lane:${fix.belt_id}:${fix.item_name}`;
        default: return `${fix.type}:${fix.item_name}`;
    }
}

function repairLabel({ issue, fix }: Repair): string {
    const machine = entityLabel('machine', issue.machine_id);
    switch (fix.type) {
        case 'review_filters': return `Review ${entityLabel('inserter', fix.inserter_id)} filters`;
        case 'existing_connection': {
            const endpoint = entityLabel(fix.endpoint_type, fix.endpoint_id);
            return issue.kind === 'missing_input_inserter' ? `Connect ${endpoint} → ${machine}` : `Connect ${machine} → ${endpoint}`;
        }
        case 'machine_to_machine': return `Connect ${entityLabel('machine', fix.source_machine_id)} → ${machine}`;
        case 'add_lane_to_existing_belt': return `Add a lane to ${entityLabel('belt', fix.belt_id)}`;
        case 'new_belt': return 'Add a new belt + inserter';
        case 'infinity_chest': return 'Add an infinity chest + inserter';
    }
}

const ConnectionRepairs = memo(function ConnectionRepairs({ issues, onApplyFix, fixUnavailable, focusTargets = true, options }: Props & { options: EntityOption[] }) {
    const { itemLabel } = useGameNames();
    const [menu, setMenu] = useState<{ anchor: HTMLElement; choices: Repair[]; label: string } | null>(null);
    const menuId = useId();
    const choices = useMemo(() => {
        const repairs = new Map<string, Repair>();
        for (const issue of issues) for (const fix of issue.fix_options) {
            const key = repairKey(fix);
            const existing = repairs.get(key);
            if (existing) { if (!existing.items.includes(issue.item_name)) existing.items.push(issue.item_name); }
            else repairs.set(key, { key, issue, fix, items: [issue.item_name] });
        }
        return [...repairs.values()];
    }, [issues]);
    const reviews = choices.filter(choice => choice.fix.type === 'review_filters');
    const connections = choices.filter(choice => choice.fix.type === 'existing_connection' || choice.fix.type === 'machine_to_machine');
    const preferred = reviews.length ? reviews : connections;
    const other = choices.filter(choice => !preferred.includes(choice));
    const input = issues[0].kind === 'missing_input_inserter';
    const itemText = (repair: Repair) => repair.items.map(itemLabel).join(', ');
    const detail = (repair: Repair) => repair.fix.type === 'review_filters'
        ? `Filters exclude ${itemText(repair)}`
        : `${repair.fix.type === 'add_lane_to_existing_belt' ? 'Updates the belt' : 'Adds 1 inserter'} · connects ${itemText(repair)}`;
    const endpointOf = ({ fix }: Repair) => fix.type === 'existing_connection'
        ? findOption(options, fix.endpoint_type, fix.endpoint_id)
        : fix.type === 'machine_to_machine' ? findOption(options, 'machine', fix.source_machine_id) : undefined;
    const actionLabel = (repair: Repair) => {
        const endpoint = endpointOf(repair);
        if (!endpoint) return repairLabel(repair);
        const machine = findOption(options, 'machine', repair.issue.machine_id);
        const describe = (option: EntityOption) => `${option.label}${option.sublabel ? ` (${option.sublabel})` : ''}`;
        const own = machine ? describe(machine) : entityLabel('machine', repair.issue.machine_id);
        return input ? `Connect ${describe(endpoint)} to ${own}` : `Connect ${own} to ${describe(endpoint)}`;
    };
    const actionContent = (repair: Repair) => {
        const endpoint = endpointOf(repair);
        return endpoint ? <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Typography component="span" variant="body2" sx={{ flexShrink: 0 }}>Connect {input ? 'from' : 'to'}</Typography>
            <RouteBadge option={endpoint} />
            <ContentIcons option={endpoint} size={18} />
            <Typography component="span" variant="body2" sx={{ textAlign: 'left', overflowWrap: 'anywhere' }}>{endpoint.sublabel ?? endpoint.label}</Typography>
        </Box> : repairLabel(repair);
    };
    const apply = (repair: Repair) => {
        if (fixUnavailable?.(repair.fix, repair.issue)) return;
        setMenu(null);
        onApplyFix(repair.issue, repair.fix);
    };
    const openChoices = (anchor: HTMLElement, list: Repair[], label: string) => setMenu({ anchor, choices: list, label });
    return <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, flex: '1 1 200px', minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{input ? 'In' : 'Out'}</Typography>
            {issues.map(issue => <Box key={issue.item_name} id={focusTargets ? coverageIssueElementId(issue) : undefined} tabIndex={focusTargets ? -1 : undefined}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, '&:focus': { outline: '2px solid', outlineColor: 'error.main', outlineOffset: 2 } }}>
                <FactorioIcon name={issue.item_name} size={20} alt="" />
                <Typography variant="body2"><GameName id={issue.item_name} /></Typography>
                {issue.is_fuel && <Typography variant="caption">(fuel)</Typography>}
            </Box>)}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
            {preferred.length === 1 && <Box>
                <Button size="small" variant="outlined" color="inherit" disabled={Boolean(fixUnavailable?.(preferred[0].fix, preferred[0].issue))} aria-label={actionLabel(preferred[0])} title={actionLabel(preferred[0])} sx={{ textTransform: 'none' }} onClick={() => apply(preferred[0])}>{actionContent(preferred[0])}</Button>
                {fixUnavailable?.(preferred[0].fix, preferred[0].issue) && <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>{fixUnavailable(preferred[0].fix, preferred[0].issue)}</Typography>}
            </Box>}
            {preferred.length > 1 && <Button size="small" variant="outlined" color="inherit" aria-haspopup="menu" aria-controls={menu ? menuId : undefined}
                onClick={event => openChoices(event.currentTarget, preferred, reviews.length ? 'Review filters' : input ? 'Choose a source' : 'Choose a destination')}>
                {reviews.length ? 'Review connection…' : input ? 'Choose source…' : 'Choose destination…'}
            </Button>}
            {other.length > 0 && <Button size="small" color="inherit" aria-haspopup="menu" aria-controls={menu ? menuId : undefined}
                onClick={event => openChoices(event.currentTarget, other, 'Other connection options')}>
                {preferred.length ? 'Other options…' : input ? 'Add source…' : 'Add destination…'}
            </Button>}
        </Box>
        <Menu id={menuId} anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}
            slotProps={{ list: { 'aria-label': menu?.label }, paper: { sx: { maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(420px, calc(100dvh - 32px))' } } }}>
            {menu?.choices.map(repair => {
                const problem = fixUnavailable?.(repair.fix, repair.issue);
                return <MenuItem key={repair.key} aria-label={actionLabel(repair)} aria-disabled={Boolean(problem)} onClick={() => apply(repair)} sx={{ whiteSpace: 'normal', py: 1 }}>
                    <Box>
                        <Box sx={{ mb: 0.25 }}>{actionContent(repair)}</Box>
                        <Typography variant="caption" color="text.secondary">{problem ?? detail(repair)}</Typography>
                    </Box>
                </MenuItem>;
            })}
        </Menu>
    </Box>;
});

export const MissingInserterAlert = memo(function MissingInserterAlert({ issues, machines = [], belts, chests, ...props }: Props) {
    const { recipeLabel, itemLabel } = useGameNames();
    const options = useMemo(() => entityOptionsOf(machines, belts ?? [], chests ?? [], { recipe: recipeLabel, item: itemLabel }), [machines, belts, chests, recipeLabel, itemLabel]);
    const grouped = useMemo(() => {
        const groups = new Map<number, InserterCoverageIssue[]>();
        for (const issue of issues) {
            const group = groups.get(issue.machine_id) ?? [];
            if (!group.some(item => item.kind === issue.kind && item.item_name === issue.item_name)) group.push(issue);
            groups.set(issue.machine_id, group);
        }
        return [...groups].map(([machineId, missing]) => ({
            machineId, missing,
            directions: (['missing_input_inserter', 'missing_output_inserter'] as const)
                .map(kind => missing.filter(issue => issue.kind === kind)).filter(direction => direction.length > 0),
        }));
    }, [issues]);
    if (issues.length === 0) return null;
    return <Alert severity="error" sx={{ mb: 2, '& .MuiAlert-message': { minWidth: 0, width: '100%' } }}>
        <AlertTitle sx={{ mb: 0.75 }}>Missing connections <Typography component="span" variant="caption" sx={{ ml: 0.5 }}>{issues.length} items · {grouped.length} {grouped.length === 1 ? 'machine' : 'machines'}</Typography></AlertTitle>
        <Box role="region" aria-label="Missing connection repairs" tabIndex={0}
            sx={{ maxHeight: 280, overflowY: 'auto', overflowX: 'hidden', pr: 0.5, scrollbarGutter: 'stable', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
            {grouped.map(({ machineId, missing, directions }, index) => {
                const machine = machines.find(row => row.id === machineId);
                return <Box key={machineId} role="group" aria-label={`Missing connections for ${entityLabel('machine', machineId)}`}
                    sx={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 0.7fr) minmax(0, 2fr)', gap: 1, alignItems: 'center', py: 0.75,
                        ...(index > 0 && { borderTop: '1px solid', borderColor: 'divider' }),
                        '@media (max-width: 650px)': { gridTemplateColumns: '1fr', gap: 0.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                        <EntityBadge id={machineId} size="small"><FactorioIcon name={machine?.type === 'biochamber' ? 'biochamber' : machine?.type === 'furnace' ? 'electric-furnace' : 'assembling-machine-3'} size={22} alt="" /></EntityBadge>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{entityLabel('machine', machineId)}</Typography>
                            <Typography variant="caption" component="div" noWrap><GameName id={missing[0].recipe} kind="recipe" /></Typography>
                        </Box>
                    </Box>
                    <Stack spacing={0.5}>
                        {directions.map(direction => <ConnectionRepairs key={direction[0].kind} issues={direction} options={options} {...props} />)}
                    </Stack>
                </Box>;
            })}
        </Box>
    </Alert>;
});
