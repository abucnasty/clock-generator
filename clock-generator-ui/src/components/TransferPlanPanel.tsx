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
import { FactorioIcon } from './FactorioIcon';

interface TransferPlanPanelProps {
    transferPlan: SerializableTransferPlan;
    /** The LCM value that was actually used in the last simulation run */
    usedLcm: number;
    excludedIngredients: string[];
    onExcludeChange: (items: string[]) => void;
}

function formatFraction(numerator: number, denominator: number): string {
    if (denominator === 1) return String(numerator);
    return `${numerator}/${denominator}`;
}

function formatEntityLabel(entityId: string): string {
    const colonIdx = entityId.indexOf(':');
    if (colonIdx === -1) return entityId;
    const type = entityId.slice(0, colonIdx);
    const num = entityId.slice(colonIdx + 1);
    const capitalised = type.charAt(0).toUpperCase() + type.slice(1);
    return `${capitalised} #${num}`;
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
        <Accordion defaultExpanded sx={{ mt: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                    Transfer Plan
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 2 }}>
                    <Tooltip title={`The least common multiple (LCM) that is computed based on the transfer fractions of all inserters. The clock will repeat every LCM cycles.`}>
                        <Chip
                            label={`LCM: ${computed_lcm}`}
                            size="small"
                            color="default"
                            variant="outlined"
                        />
                    </Tooltip>

                    {isLcmOverridden && (
                        <Tooltip title={`Manual LCM override active: ${usedLcm} (computed: ${computed_lcm})`}>
                            <Chip
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
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ width: '30%' }}>Entity</TableCell>
                            <TableCell>Item</TableCell>
                            <TableCell align="right" sx={{ width: '120px' }}>Transfers / cycle</TableCell>
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
                                                        {formatEntityLabel(entity.entity_id)}
                                                    </Typography>
                                                </Box>
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                                <FactorioIcon name={transfer.item_name} size={18} />
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
                                                        : 'Click to exclude from LCM (inserter will be set to ALWAYS)'
                                                }
                                            >
                                                <Chip
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
                        Transfers per cycle are fractions of the LCM period. Excluded ingredients are omitted from the
                        LCM calculation — their inserters will be forced to{' '}
                        <strong>ALWAYS</strong> enabled. Re-run the simulation after making changes.
                    </Typography>
                </Box>
            </AccordionDetails>
        </Accordion>
    );
}

export const TransferPlanPanel = memo(TransferPlanPanelComponent);
