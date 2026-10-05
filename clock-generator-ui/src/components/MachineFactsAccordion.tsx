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
                <Typography variant="body2" color="text.secondary">
                    Machine Facts
                </Typography>
                <Tooltip title={`${facts.output_rate_per_second}/s`} arrow>
                    <Chip
                        size="small"
                        label={`${facts.output_rate_per_second.toFixed(4)}/s`}
                        color="primary"
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
                            value={facts.output_per_craft.toFixed(2)}
                        />
                        <FactItem
                            label="Rate"
                            value={`${facts.output_rate_per_second.toFixed(4)}/s`}
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
                            value={`${facts.ticks_per_craft.toFixed(4)} ticks`}
                            tooltip={`${facts.ticks_per_craft} ticks`}
                        />
                        <FactItem
                            label="Bonus"
                            value={`${facts.ticks_per_bonus_craft.toFixed(4)} ticks`}
                            tooltip={`${facts.ticks_per_bonus_craft} ticks`}
                        />
                        <FactItem
                            label="Insertion Duration"
                            value={`${facts.insertion_duration_ticks.toFixed(4)} ticks`}
                            tooltip={`${facts.insertion_duration_ticks} ticks`}
                        />
                        <FactItem
                            label="Overload Multiplier"
                            value={`${facts.overload_multiplier}`}
                        />
                    </Box>
                </Box>

                {facts.nutrients && (
                    <>
                        <Divider sx={{ my: 1.5 }} />
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                            <FactItem
                                icon="nutrients"
                                label="Nutrients"
                                value={`${facts.nutrients.consumption_rate_per_second.toFixed(4)}/s`}
                                tooltip={`${facts.nutrients.consumption_rate_per_second}/s while crafting`}
                            />
                            <FactItem
                                label="Nutrients Per Craft"
                                value={facts.nutrients.amount_per_craft.toFixed(4)}
                                tooltip={`${facts.nutrients.amount_per_craft}`}
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
                                        <FactorioIcon name={input.item_name} size={24} />
                                        <Typography variant="body2" sx={{ minWidth: 120 }}>
                                            {input.item_name}
                                        </Typography>
                                        <Tooltip title={`${input.consumption_rate_per_second}/s`} arrow>
                                            <span>
                                                <Chip
                                                    size="small"
                                                    label={`${input.consumption_rate_per_second.toFixed(4)}/s`}
                                                    variant="outlined"
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                            </span>
                                        </Tooltip>
                                        <Tooltip title="Required amount per craft" arrow>
                                            <span>
                                                <Chip
                                                    size="small"
                                                    label={`${input.amount_per_craft}/craft`}
                                                    variant="outlined"
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                            </span>
                                        </Tooltip>
                                        <Tooltip title="Automated insertion limit quantity" arrow>
                                            <span>
                                                <Chip
                                                    size="small"
                                                    label={`limit: ${input.automated_insertion_limit}`}
                                                    color="secondary"
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
    'Amount Per Craft': 'Amount produced per craft (including productivity)',
    'Rate': 'Output rate in items per second',
    'Output Block': 'Output block size (items per output cycle)',
    'Craft': 'Ticks required per craft',
    'Bonus': 'Ticks per bonus craft from productivity',
    'Insertion Duration': 
        'Insertion duration before overload lockout in ticks.'
        + 'This represents the time window during which items can be inserted before the '
        + 'machine locks out due to being over the overload multiplier. ' 
        + 'It is impacted by both crafting speed and productivity.',
    'Overload Multiplier': 'Overload multiplier value',
    'Productivity': 'Productivity bonus percentage',
    'Crafting Speed': 'Machine crafting speed multiplier',
    'Type': 'Machine type (machine or furnace)',
    'Recipe': 'Recipe name',
};

function FactItem({ icon, label, value, tooltip }: FactItemProps) {
    const baseDescription = FACT_DESCRIPTIONS[label];
    const description = tooltip && baseDescription
        ? <>{baseDescription}<br />{tooltip}</>
        : tooltip ?? baseDescription;
    const content = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {icon && <FactorioIcon name={icon} size={18} />}
            <Typography variant="body2" color="text.secondary">
                {label}:
            </Typography>
            <Typography variant="body2" fontWeight="medium">
                {value}
            </Typography>
        </Box>
    );
    return description ? (
        <Tooltip title={description} arrow>
            <span>{content}</span>
        </Tooltip>
    ) : content;
}
