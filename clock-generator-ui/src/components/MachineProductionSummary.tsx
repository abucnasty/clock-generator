import { ArrowForward, LocalFireDepartmentOutlined } from '@mui/icons-material';
import { Box, Tooltip, Typography } from '@mui/material';
import type { MachineTargetRate, SerializableMachineFacts } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { formatNumberText } from '../utils/numberText';
import { FactorioIcon } from './FactorioIcon';

/** Capacity or steady-state demand, always per machine in one copy of the build. */
export function MachineProductionSummary({ facts, targetRate }: { facts: SerializableMachineFacts; targetRate?: MachineTargetRate }) {
    const { itemLabel } = useGameNames();
    const share = targetRate?.crafting_share ?? 1;
    const outputRate = targetRate?.output_rate_per_second ?? facts.output_rate_per_second;
    const mode = targetRate ? 'planned at target' : 'maximum';
    const fuelTiming = targetRate ? 'averaged at target' : 'while crafting';
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
            <Tooltip title={`${itemLabel(facts.output_item)}: ${formatNumberText(facts.output_per_craft)} per craft including productivity. ${targetRate ? 'Planned steady-state output at the requested target' : 'Maximum output before clocking'}, per machine in one copy of the build.`} arrow>
                <Box component="span" tabIndex={0} role="img" aria-label={`${itemLabel(facts.output_item)}: ${mode} ${formatNumberText(outputRate)} per second per machine`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, borderRadius: 0.5 }}>
                    <CountedIcon name={facts.output_item} quantity={`${formatNumberText(outputRate)}/s`} />
                </Box>
            </Tooltip>
        </Box>
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
