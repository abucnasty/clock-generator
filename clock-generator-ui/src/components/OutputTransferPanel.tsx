import { ArrowForward, ExpandLess, ExpandMore } from '@mui/icons-material';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useId, useState, type ReactNode } from 'react';
import type { MachineTargetRate, OutputTransferGenerationIssue, OutputTransferSummary, SerializableMachineFacts } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { isInfinityChest, type ChestFormData } from '../hooks/useConfigForm';
import { chestLabel, entityLabel } from '../utils/entityLabel';
import { formatNumberText } from '../utils/numberText';
import { FactorioIcon } from './FactorioIcon';
import { PanelSection } from './Panel';

/** List rows disclose route detail on demand while the physical target and problems remain visible. */
function OutputTransferSection({ control, children, collapsible, count, missing, status, generationIssues }: {
    control?: ReactNode; children: ReactNode; collapsible: boolean; count: number; missing: number;
    status?: string; generationIssues: OutputTransferGenerationIssue[];
}) {
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();
    return <PanelSection level={4} title="Output transfer">
        {control}
        {generationIssues.map(issue => <Alert key={`${issue.machine_id}:${issue.target_machine_id}:${issue.code}`} severity="warning" sx={{ mb: 1 }}>{issue.message}</Alert>)}
        {collapsible && <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
            <Button size="small" color="inherit" startIcon={expanded ? <ExpandLess /> : <ExpandMore />}
                aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}
                sx={{ p: 0, minHeight: 28, textTransform: 'none' }}>Output routes ({count})</Button>
            {missing > 0 && <Typography variant="caption" color="warning.main">{missing} {missing === 1 ? 'output needs' : 'outputs need'} a route</Typography>}
            {status && <Typography variant="caption" color="text.secondary">{status}</Typography>}
        </Box>}
        {collapsible ? <Box id={detailsId} hidden={!expanded}>{expanded && children}</Box> : children}
    </PanelSection>;
}

export function OutputTransferPanel({ summary, chests, facts, targetRate, atTarget = false, fallbackItems = [], control, generationIssues = [], loading = false, collapsible = false, onFix, onEditInserter }:
    { summary: OutputTransferSummary | null; chests: ChestFormData[]; facts?: SerializableMachineFacts | null; targetRate?: MachineTargetRate;
      generationIssues?: OutputTransferGenerationIssue[];
      atTarget?: boolean;
      fallbackItems?: string[];
      loading?: boolean;
      /** Machine list rows start compact; an entity editor already provides focused context. */
      collapsible?: boolean;
      control?: React.ReactNode; onFix?: (item: string) => void; onEditInserter?: (id: number) => void }) {
    const { itemLabel } = useGameNames();
    const outputFacts = facts?.outputs ?? (facts ? [{ item_name: facts.output_item, amount_per_craft: facts.output_per_craft,
        rate_per_second: facts.output_rate_per_second, rate_ratio: facts.output_rate_ratio ?? { numerator: facts.output_rate_per_second, denominator: 1 },
        output_block_size: facts.output_block_size, stochastic: false }] : []);
    const section = (children: ReactNode) => <OutputTransferSection control={control} collapsible={collapsible}
        count={summary?.results.length ?? (outputFacts.length || fallbackItems.length)}
        missing={summary?.results.filter(result => result.coverage === 'missing').length ?? 0}
        status={loading ? 'Checking output routes…' : !summary || summary.status === 'unavailable' || summary.results.some(result => result.coverage === 'unknown') ? 'Output routes unavailable' : undefined}
        generationIssues={generationIssues}>{children}</OutputTransferSection>;
    if (!summary) {
        const items = outputFacts.length ? outputFacts.map(output => output.item_name) : fallbackItems;
        return section(<>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>{loading ? 'Checking output routes…' : 'Output routes unavailable'}</Typography>
            {items.map(item => {
                const fact = outputFacts.find(output => output.item_name === item);
                return <Box key={item} role="group" aria-label={itemLabel(item)} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
                    <FactorioIcon name={item} size={26} alt="" />
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{itemLabel(item)}</Typography>
                        {fact && <Typography variant="caption" color="text.secondary" component="div">{fact.stochastic ? 'Expected ' : ''}{formatNumberText(fact.amount_per_craft)} per craft · {fact.stochastic ? 'Expected capacity' : 'Capacity'}: {formatNumberText(fact.rate_per_second)}/s</Typography>}
                        <Typography variant="body2" color="text.secondary">Output routes unavailable</Typography>
                    </Box>
                </Box>;
            })}
        </>);
    }
    const labelOf = (target: { type: 'machine' | 'belt' | 'chest'; id: number }) => target.type === 'chest'
        ? chestLabel(chests.find(chest => chest.id === target.id) ?? { id: target.id })
        : entityLabel(target.type, target.id);
    const target = summary.physical_target;
    const directTargetLabel = target ? labelOf(target) : null;
    const targetChest = target?.type === 'chest' ? chests.find(chest => chest.id === target.id) : undefined;
    const canEnableRemoval = targetChest && isInfinityChest(targetChest) && !targetChest.remove_unfiltered_items;
    return section(<>
        {summary.status === 'unavailable' && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Output routes unavailable</Typography>}
        {summary.mechanism === 'result-placement' && summary.results.length > 0 && summary.results.every(result => result.direct === 'rejected') && (
            <Box sx={{ mb: 1 }}>
                <Typography variant="body2" color="text.secondary">This target currently takes none of these results. Change the target or its settings, or remove the results with inserters.</Typography>
                {canEnableRemoval && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    On {directTargetLabel}, enable “Also remove unfiltered items” to accept these results directly.
                </Typography>}
            </Box>
        )}
        {summary.results.map(result => {
            const fact = outputFacts.find(output => output.item_name === result.item_name);
            const atTargetRate = targetRate?.outputs?.find(output => output.item_name === result.item_name)?.rate_per_second;
            const direct = summary.mechanism === 'mining-drop'
                ? result.direct === 'accepted' && directTargetLabel ? `Drop to ${directTargetLabel}`
                    : result.coverage === 'missing' ? '' : 'Output routes unavailable'
                : result.direct === 'accepted' && directTargetLabel ? `Direct to ${directTargetLabel}`
                : result.direct === 'rejected' ? 'Stays in machine output'
                    : result.direct === 'none' ? 'Available to inserters'
                        : result.direct === 'unknown' ? 'Output routes unavailable'
                            : 'Available to inserters';
            return <Box key={result.item_name} role="group" aria-label={itemLabel(result.item_name)} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
                <FactorioIcon name={result.item_name} size={26} alt="" />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{itemLabel(result.item_name)}</Typography>
                    {fact && <Typography variant="caption" color="text.secondary" component="div">
                        {fact.stochastic ? 'Expected ' : ''}{formatNumberText(fact.amount_per_craft)} per craft · {atTargetRate === undefined
                            ? `${fact.stochastic ? 'Expected capacity' : 'Capacity'}: ${formatNumberText(fact.rate_per_second)}/s`
                            : `${fact.stochastic ? 'Expected at target' : 'At target'}: ${formatNumberText(atTargetRate)}/s`}
                    </Typography>}
                    {atTarget && fact && atTargetRate === undefined && <Typography variant="caption" color="text.secondary" component="div">At-target rate unavailable</Typography>}
                    {direct && <Typography variant="body2" color="text.secondary">{direct}</Typography>}
                    {result.direct === 'accepted' && result.inserters.length > 0 && <Typography variant="caption" color="text.secondary" component="div">
                        The target takes this item directly. Inserters can take what remains in the machine output.
                    </Typography>}
                    {result.inserters.map(inserter => onEditInserter
                        ? <Button key={inserter.inserter_id} size="small" variant="text" sx={{ justifyContent: 'flex-start', p: 0, minHeight: 28 }}
                            onClick={() => onEditInserter(inserter.inserter_id)} aria-label={`Edit Inserter ${inserter.inserter_id}`}>
                            <ArrowForward sx={{ fontSize: 14, mr: 0.5 }} />Inserter {inserter.inserter_id} → {labelOf(inserter.target)}
                        </Button>
                        : <Typography key={inserter.inserter_id} variant="body2" color="text.secondary">Inserter {inserter.inserter_id} → {labelOf(inserter.target)}</Typography>)}
                    {result.coverage === 'missing' && <Box><Typography variant="body2" color="warning.main">No route for this item</Typography>
                        {onFix && <Button size="small" onClick={() => onFix(result.item_name)}>Fix output route</Button>}</Box>}
                    {result.coverage === 'unknown' && <Typography variant="body2" color="text.secondary">Output routes unavailable</Typography>}
                </Box>
            </Box>;
        })}
    </>);
}
