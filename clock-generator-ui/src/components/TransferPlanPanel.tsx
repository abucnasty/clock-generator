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
    /** Currently ignored ingredient names */
    ignoredIngredients: string[];
    onIgnoreChange: (items: string[]) => void;
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

export function TransferPlanPanel({
    transferPlan,
    usedLcm,
    ignoredIngredients,
    onIgnoreChange,
}: TransferPlanPanelProps) {
    const { entities, computed_lcm } = transferPlan;

    const toggleIgnore = (itemName: string) => {
        if (ignoredIngredients.includes(itemName)) {
            onIgnoreChange(ignoredIngredients.filter((i) => i !== itemName));
        } else {
            onIgnoreChange([...ignoredIngredients, itemName]);
        }
    };

    // Collect all unique ignored-able items (exclude items that appear on inserters
    // that also have non-ignored items, to keep the UI focused)
    const isLcmOverridden = usedLcm !== computed_lcm;

    return (
        <Accordion defaultExpanded={false} sx={{ mt: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                    Transfer Plan
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 2 }}>
                    <Chip
                        label={`LCM: ${computed_lcm}`}
                        size="small"
                        color="default"
                        variant="outlined"
                    />
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
                    {ignoredIngredients.length > 0 && (
                        <Chip
                            icon={<BlockIcon />}
                            label={`${ignoredIngredients.length} ignored`}
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
                            <TableCell align="center" sx={{ width: '110px' }}>Ignore from LCM</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {entities.map((entity) =>
                            entity.item_transfers.map((transfer, transferIdx) => {
                                const isIgnored = ignoredIngredients.includes(transfer.item_name);
                                const isFirstRow = transferIdx === 0;

                                return (
                                    <TableRow
                                        key={`${entity.entity_id}-${transfer.item_name}`}
                                        sx={{
                                            opacity: isIgnored ? 0.5 : 1,
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
                                                        textDecoration: isIgnored ? 'line-through' : 'none',
                                                        color: isIgnored ? 'text.disabled' : 'text.primary',
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
                                                    color: isIgnored ? 'text.disabled' : 'text.primary',
                                                }}
                                            >
                                                {formatFraction(transfer.numerator, transfer.denominator)}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="center">
                                            <Tooltip
                                                title={
                                                    isIgnored
                                                        ? 'Click to include in LCM'
                                                        : 'Click to exclude from LCM (inserter will be set to ALWAYS)'
                                                }
                                            >
                                                <Chip
                                                    icon={isIgnored ? <BlockIcon /> : undefined}
                                                    label={isIgnored ? 'Ignored' : 'Include'}
                                                    size="small"
                                                    color={isIgnored ? 'secondary' : 'default'}
                                                    variant={isIgnored ? 'filled' : 'outlined'}
                                                    onClick={() => toggleIgnore(transfer.item_name)}
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
                        Transfers per cycle are fractions of the LCM period. Ignored ingredients are excluded from the
                        LCM calculation — their inserters will be forced to{' '}
                        <strong>ALWAYS</strong> enabled. Re-run the simulation after making changes.
                    </Typography>
                </Box>
            </AccordionDetails>
        </Accordion>
    );
}
