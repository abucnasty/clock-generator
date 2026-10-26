import { ArrowForward, LocalFireDepartmentOutlined } from '@mui/icons-material';
import { Box, Tooltip, Typography } from '@mui/material';
import type { MachineTargetRate, SerializableMachineFacts } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { formatNumberText } from '../utils/numberText';
import { FactorioIcon } from './FactorioIcon';

/** Capacity or steady-state demand, always per machine in one copy of the build. */
export function MachineProductionSummary({ facts, targetRate, atTarget = false }: { facts: SerializableMachineFacts; targetRate?: MachineTargetRate; atTarget?: boolean }) {
    const { itemLabel } = useGameNames();
    const share = targetRate?.crafting_share ?? 1;
    const inputAtTarget = atTarget && targetRate !== undefined;
    const mode = inputAtTarget ? 'planned at target' : 'maximum';
    const fuelTiming = inputAtTarget ? 'averaged at target' : 'while crafting';
    // Older saved facts have no output vector. Their scalar fields remain the main-product alias.
    const outputs = facts.outputs?.length ? facts.outputs : [{
        item_name: facts.output_item,
        amount_per_craft: facts.output_per_craft,
        rate_per_second: facts.output_rate_per_second,
        rate_ratio: facts.output_rate_ratio ?? { numerator: facts.output_rate_per_second, denominator: 1 },
        output_block_size: facts.output_block_size,
        stochastic: false,
    }];
    const targetRatesUnavailable = atTarget && outputs.some(output => !targetRate?.outputs?.some(candidate => candidate.item_name === output.item_name));
    return <Box role="group" aria-label={`${targetRate ? 'At-target' : 'Maximum'} production per machine`} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
        {facts.inputs.length > 0 && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: '100%' }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            {facts.inputs.map(input => {
                const rate = input.consumption_rate_per_second * share;
                const label = `${itemLabel(input.item_name)}: ${mode} consumption ${formatNumberText(rate)} per second per machine (${formatNumberText(input.amount_per_craft)} per craft)`;
                return <Tooltip key={input.item_name} title={label} arrow>
                    <Box component="span" tabIndex={0} role="img" aria-label={label} sx={{ display: 'inline-flex', borderRadius: 0.5 }}>
                        <CountedIcon name={input.item_name} quantity={`${formatNumberText(rate)}/s`} />
                    </Box>
                </Tooltip>;
            })}
            </Box>
        </Box>}
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            {facts.inputs.length > 0 && <ArrowForward aria-hidden sx={{ fontSize: 14, color: 'text.secondary' }} />}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                {outputs.map(output => {
                    const plannedRate = atTarget
                        ? targetRate?.outputs?.find(candidate => candidate.item_name === output.item_name)?.rate_per_second
                        : undefined;
                    const showingCapacity = !atTarget || plannedRate === undefined;
                    const outputRate = showingCapacity ? output.rate_per_second : plannedRate;
                    const quantity = outputRate === undefined ? '—' : `${formatNumberText(outputRate)}/s`;
                    const rateLabel = showingCapacity ? `${output.stochastic ? 'expected capacity' : 'capacity'} ${formatNumberText(outputRate)} per second` : `at target ${formatNumberText(outputRate)} per second`;
                    const label = `${itemLabel(output.item_name)}: ${rateLabel} per machine. ${formatNumberText(output.amount_per_craft)} per craft${output.stochastic ? ', expected' : ''}.`;
                    return <Tooltip key={output.item_name} title={label} arrow>
                        <Box component="span" tabIndex={0} role="img" aria-label={`${itemLabel(output.item_name)}: ${quantity} ${output.stochastic ? 'expected' : ''}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, borderRadius: 0.5 }}>
                            <CountedIcon name={output.item_name} quantity={quantity} />
                            {output.stochastic && <Typography component="span" variant="caption" color="text.secondary">Expected</Typography>}
                            {atTarget && showingCapacity && <Typography component="span" variant="caption" color="text.secondary">Capacity</Typography>}
                        </Box>
                    </Tooltip>;
                })}
            </Box>
        </Box>
        {targetRatesUnavailable && <Typography component="span" variant="caption" color="text.secondary">At-target rate unavailable</Typography>}
        {facts.fuel && <Tooltip title={`Consumes ${itemLabel(facts.fuel.item_name)} as fuel: ${formatNumberText(facts.fuel.consumption_rate_per_second * share)}/s ${fuelTiming} (${formatNumberText(facts.fuel.amount_per_craft)} per craft).`} arrow>
            <Box component="span" tabIndex={0} role="img" aria-label={`Fuel: ${itemLabel(facts.fuel.item_name)}, ${formatNumberText(facts.fuel.consumption_rate_per_second * share)} per second ${fuelTiming}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, borderLeft: 1, borderColor: 'divider', pl: 0.75, borderRadius: 0.5 }}>
                <LocalFireDepartmentOutlined aria-hidden sx={{ fontSize: 14 }} />
                <Typography component="span" variant="caption">Fuel</Typography>
                <FactorioIcon name={facts.fuel.item_name} size={18} alt="" />
            </Box>
        </Tooltip>}
        {targetRate && <Tooltip title={`Demand for one machine in one copy of the build. ${share > 1 ? 'Above capacity: lower the target or add capacity.' : 'Planned steady-state utilization; generated-clock performance may differ.'}`} arrow>
            <Typography component="span" tabIndex={0} variant="caption" sx={{ color: share > 1 ? 'warning.main' : 'text.secondary', whiteSpace: 'nowrap', borderRadius: 0.5 }}>
                {formatNumberText(share * 100, { maxDecimals: 1 })}% capacity{share > 1 ? ' — above max' : ''}
            </Typography>
        </Tooltip>}
    </Box>;
}

function CountedIcon({ name, quantity }: { name: string; quantity: string }) {
    return <Box component="span" aria-hidden sx={{ display: 'inline-grid', minWidth: 28, height: 34, justifyItems: 'center' }}>
        <Box component="span" sx={{ gridArea: '1 / 1', alignSelf: 'start', display: 'flex' }}>
            <FactorioIcon name={name} size={28} alt="" />
        </Box>
        <Typography component="span" sx={{ gridArea: '1 / 1', alignSelf: 'end', zIndex: 1, color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: '13px', whiteSpace: 'nowrap', textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 1px 3px #000' }}>
            {quantity}
        </Typography>
    </Box>;
}
