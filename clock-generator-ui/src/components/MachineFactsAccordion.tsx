import { ExpandMore, Input, Output, Schedule } from '@mui/icons-material';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Chip,
    Divider,
    Typography,
    Tooltip,
} from '@mui/material';
import type { SerializableMachineFacts } from 'clock-generator/browser';
import { FactorioIcon } from './FactorioIcon';
import { TICK_DECIMALS, formatNumberText, maxRateLabel } from '../utils/numberText';

interface MachineFactsAccordionProps {
    facts: SerializableMachineFacts | null;
    error?: string | null;
}

export function MachineFactsAccordion({ facts, error }: MachineFactsAccordionProps) {
    if (error) {
        return (
            <Typography variant="caption" color="error">
                Error computing facts: {error}
            </Typography>
        );
    }

    if (!facts) {
        return null;
    }

    return (
        <Accordion
            sx={{
                mt: 1,
                bgcolor: 'background.paper',
                '&:before': { display: 'none' },
                boxShadow: 1,
            }}
            disableGutters
        >
            <AccordionSummary
                expandIcon={<ExpandMore />}
                sx={{
                    minHeight: 40,
                    '& .MuiAccordionSummary-content': {
                        my: 0.5,
                        alignItems: 'center',
                        gap: 1,
                    },
                }}
            >
                <Typography variant="body2" component="span" color="text.secondary">
                    Machine Facts
                </Typography>
                <Tooltip title={`The most this machine can make: ${facts.output_rate_per_second}/s`} arrow describeChild>
                    <Chip
                        size="small"
                        label={maxRateLabel(facts.output_rate_per_second)}
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                </Tooltip>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
                {/* Output Section */}
                <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                        <Output sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="subtitle2" color="text.secondary">
                            Output
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        <FactItem
                            icon={facts.output_item}
                            label="Output Item"
                            value={facts.output_item}
                        />
                        <FactItem
                            label="Amount Per Craft"
                            value={formatNumberText(facts.output_per_craft)}
                        />
                        <FactItem
                            label="Max rate"
                            value={`${formatNumberText(facts.output_rate_per_second)}/s`}
                            tooltip={`${facts.output_rate_per_second}/s`}
                        />
                        <FactItem
                            label="Output Block"
                            value={facts.output_block_size.toString()}
                        />
                    </Box>
                </Box>

                <Divider sx={{ my: 1.5 }} />

                {/* Timing Section */}
                <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                        <Schedule sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="subtitle2" color="text.secondary">
                            Timing
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        <FactItem
                            label="Craft"
                            value={`${formatNumberText(facts.ticks_per_craft, { maxDecimals: TICK_DECIMALS })} ticks`}
                            tooltip={`${facts.ticks_per_craft} ticks`}
                        />
                        <FactItem
                            label="Bonus"
                            value={`${formatNumberText(facts.ticks_per_bonus_craft, { maxDecimals: TICK_DECIMALS })} ticks`}
                            tooltip={`${facts.ticks_per_bonus_craft} ticks`}
                        />
                        <FactItem
                            label="Insertion Duration"
                            value={`${formatNumberText(facts.insertion_duration_ticks, { maxDecimals: TICK_DECIMALS })} ticks`}
                            tooltip={`${facts.insertion_duration_ticks} ticks`}
                        />
                        <FactItem
                            label="Insertion Limit Multiplier"
                            value={formatNumberText(facts.overload_multiplier, { maxDecimals: TICK_DECIMALS })}
                        />
                    </Box>
                </Box>

                {facts.fuel && (
                    <>
                        <Divider sx={{ my: 1.5 }} />
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                            <FactItem
                                icon={facts.fuel.item_name}
                                label="Fuel"
                                value={`${formatNumberText(facts.fuel.consumption_rate_per_second)}/s`}
                                tooltip={`${facts.fuel.consumption_rate_per_second}/s while crafting`}
                            />
                            <FactItem
                                label="Fuel Per Craft"
                                value={formatNumberText(facts.fuel.amount_per_craft, { maxDecimals: TICK_DECIMALS })}
                                tooltip={`${facts.fuel.amount_per_craft}`}
                            />
                        </Box>
                    </>
                )}

                {facts.inputs.length > 0 && (
                    <>
                        <Divider sx={{ my: 1.5 }} />

                        {/* Inputs Section */}
                        <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                                <Input sx={{ fontSize: 18, color: 'text.secondary' }} />
                                <Typography variant="subtitle2" color="text.secondary">
                                    Inputs
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {facts.inputs.map((input) => (
                                    <Box
                                        key={input.item_name}
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 2,
                                            p: 1,
                                            bgcolor: 'action.hover',
                                            borderRadius: 1,
                                        }}
                                    >
                                        <FactorioIcon name={input.item_name} size={24} alt="" />
                                        <Typography variant="body2" sx={{ minWidth: 120 }}>
                                            {input.item_name}
                                        </Typography>
                                        <Tooltip title={`${input.consumption_rate_per_second}/s`} arrow describeChild>
                                            <span>
                                                <Chip
                                                    size="small"
                                                    label={`${formatNumberText(input.consumption_rate_per_second)}/s`}
                                                    variant="outlined"
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                            </span>
                                        </Tooltip>
                                        <Tooltip title="Required amount per craft" arrow describeChild>
                                            <span>
                                                <Chip
                                                    size="small"
                                                    label={`${input.amount_per_craft}/craft`}
                                                    variant="outlined"
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                            </span>
                                        </Tooltip>
                                        <Tooltip title="Automated insertion limit quantity" arrow describeChild>
                                            <span>
                                                <Chip
                                                    size="small"
                                                    label={`limit: ${input.automated_insertion_limit}`}
                                                    variant="outlined"
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                            </span>
                                        </Tooltip>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    </>
                )}
            </AccordionDetails>
        </Accordion>
    );
}

interface FactItemProps {
    icon?: string;
    label: string;
    value: string;
    tooltip?: string;
}

const FACT_DESCRIPTIONS: Record<string, string> = {
    'Output Item': 'Output item name',
    'Fuel': 'Fuel items burned per second while crafting',
    'Fuel Per Craft': 'Fuel items burned per craft',
    'Amount Per Craft': 'Amount produced per craft (including productivity)',
    'Max rate': 'Most this machine can make, in items per second',
    'Output Block': 'How many output items the machine holds before it stops crafting until some are taken out',
    'Craft': 'Ticks required per craft',
    'Bonus': 'Ticks per bonus craft from productivity',
    'Insertion Duration':
        'How long items can still be inserted, in ticks, before the machine locks up for being over its insertion limit. '
        + 'It is impacted by both crafting speed and productivity.',
    'Insertion Limit Multiplier': 'Each ingredient\'s insertion limit is the amount a craft takes times this, rounded up',
    'Productivity': 'Productivity bonus percentage',
    'Crafting Speed': 'Machine crafting speed multiplier',
    'Recipe': 'Recipe name',
};

function FactItem({ icon, label, value, tooltip }: FactItemProps) {
    const baseDescription = FACT_DESCRIPTIONS[label];
    const description = tooltip && baseDescription
        ? <>{baseDescription}<br />{tooltip}</>
        : tooltip ?? baseDescription;
    const content = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {icon && <FactorioIcon name={icon} size={18} alt="" />}
            <Typography variant="body2" color="text.secondary">
                {label}:
            </Typography>
            <Typography variant="body2" fontWeight="medium">
                {value}
            </Typography>
        </Box>
    );
    return description ? (
        <Tooltip title={description} arrow describeChild>
            <span>{content}</span>
        </Tooltip>
    ) : content;
}
