import { memo } from 'react';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Chip,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import BlockIcon from '@mui/icons-material/Block';
import type { SerializableTransferPlan } from 'clock-generator/browser';
import { EnableControlMode } from 'clock-generator/light';
import { ENABLE_MODE_LABELS } from '../utils/enableRuleLabel';
import { entityLabel } from '../utils/entityLabel';
import { FactorioIcon } from './FactorioIcon';

interface TransferPlanPanelProps {
    transferPlan: SerializableTransferPlan;
    /** The LCM value that was actually used in the last simulation run */
    usedLcm: number;
    excludedIngredients: string[];
    onExcludeChange: (items: string[]) => void;
}

const ALWAYS_ON = ENABLE_MODE_LABELS[EnableControlMode.ALWAYS];

function formatFraction(numerator: number, denominator: number): string {
    if (denominator === 1) return String(numerator);
    return `${numerator}/${denominator}`;
}

function TransferPlanPanelComponent({
    transferPlan,
    usedLcm,
    excludedIngredients,
    onExcludeChange,
}: TransferPlanPanelProps) {
    const { entities, computed_lcm } = transferPlan;

    const toggleExclude = (itemName: string) => {
        if (excludedIngredients.includes(itemName)) {
            onExcludeChange(excludedIngredients.filter((i) => i !== itemName));
        } else {
            onExcludeChange([...excludedIngredients, itemName]);
        }
    };
    const isLcmOverridden = usedLcm !== computed_lcm;

    return (
        <Accordion defaultExpanded slotProps={{ heading: { component: 'h3' } }} sx={{ mt: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1" component="span" sx={{ fontWeight: 'bold' }}>
                    Swing Plan
                </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
                {/* here, not in the title: the title is a button, and a focusable chip in a button cannot be reached or named */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
                    <Tooltip title="LCM: the number of crafting cycles in one clock period (the least common multiple of every inserter's swings per cycle)." describeChild>
                        <Chip
                            tabIndex={0}
                            label={`LCM: ${computed_lcm}`}
                            size="small"
                            color="default"
                            variant="outlined"
                        />
                    </Tooltip>

                    {isLcmOverridden && (
                        <Tooltip title={`Manual LCM override active: ${usedLcm} (calculated: ${computed_lcm})`} describeChild>
                            <Chip
                                tabIndex={0}
                                label={`Used: ${usedLcm}`}
                                size="small"
                                color="warning"
                                variant="outlined"
                            />
                        </Tooltip>
                    )}
                    {excludedIngredients.length > 0 && (
                        <Chip
                            icon={<BlockIcon />}
                            label={`${excludedIngredients.length} excluded`}
                            size="small"
                            color="secondary"
                            variant="outlined"
                        />
                    )}
                </Box>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ width: '30%' }}>Entity</TableCell>
                            <TableCell>Item</TableCell>
                            <TableCell align="right" sx={{ width: '120px' }}>Swings / cycle</TableCell>
                            <TableCell align="center" sx={{ width: '110px' }}>Exclude from LCM</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {entities.map((entity) =>
                            entity.item_transfers.map((transfer, transferIdx) => {
                                const isExcluded = excludedIngredients.includes(transfer.item_name);
                                const isFirstRow = transferIdx === 0;

                                return (
                                    <TableRow
                                        key={`${entity.entity_id}-${transfer.item_name}`}
                                        sx={{
                                            opacity: isExcluded ? 0.5 : 1,
                                            '& td': { borderBottom: isFirstRow || transferIdx > 0 ? undefined : 'none' },
                                        }}
                                    >
                                        <TableCell>
                                            {isFirstRow ? (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    <Chip
                                                        label={entity.entity_type}
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ fontSize: '0.65rem', height: 18 }}
                                                    />
                                                    <Typography variant="body2">
                                                        {entityLabel(entity.entity_type, entity.entity_number)}
                                                    </Typography>
                                                </Box>
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                                <FactorioIcon name={transfer.item_name} size={18} alt="" />
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        textDecoration: isExcluded ? 'line-through' : 'none',
                                                        color: isExcluded ? 'text.disabled' : 'text.primary',
                                                    }}
                                                >
                                                    {transfer.item_name}
                                                </Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right">
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    fontFamily: 'monospace',
                                                    color: isExcluded ? 'text.disabled' : 'text.primary',
                                                }}
                                            >
                                                {formatFraction(transfer.numerator, transfer.denominator)}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="center">
                                            <Tooltip
                                                title={
                                                    isExcluded
                                                        ? 'Click to include in LCM'
                                                        : `Click to exclude from LCM. An inserter whose items are all excluded is set to ${ALWAYS_ON} unless it already has an enable rule of your own.`
                                                }
                                                describeChild
                                            >
                                                <Chip
                                                    // starts with the word on the chip, and says what it is about
                                                    aria-label={`${isExcluded ? 'Excluded from' : 'Included in'} LCM: ${transfer.item_name}`}
                                                    icon={isExcluded ? <BlockIcon /> : undefined}
                                                    label={isExcluded ? 'Excluded' : 'Included'}
                                                    size="small"
                                                    color={isExcluded ? 'secondary' : 'default'}
                                                    variant={isExcluded ? 'filled' : 'outlined'}
                                                    onClick={() => toggleExclude(transfer.item_name)}
                                                    sx={{ cursor: 'pointer' }}
                                                />
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
                <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="caption" color="text.secondary">
                        Swings per cycle can be fractions. The clock period is the number of crafting cycles (the LCM)
                        after which they all come out whole. Excluded ingredients are left out of that calculation, and an
                        inserter whose items are all excluded is forced to <strong>{ALWAYS_ON}</strong>, unless you gave
                        it an enable rule of your own, which stays. Validate again, then Generate, after making changes.
                    </Typography>
                </Box>
            </AccordionDetails>
        </Accordion>
    );
}

export const TransferPlanPanel = memo(TransferPlanPanelComponent);
