import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import { 
    ValueReferenceType, 
    EntityReference, 
    ComparisonOperator, 
    RuleOperator,
    MachineStatus 
} from 'clock-generator/light';
import type { RuleSet } from '../hooks/useConfigForm';

interface Template {
    id: string;
    name: string;
    description: string;
    getRuleSet: (itemName: string) => RuleSet;
    // For latched templates, returns the release condition
    // The getRuleSet becomes the base/enable condition
    getRelease?: (itemName: string) => RuleSet;
}

const TEMPLATES: Template[] = [
    {
        id: 'source-output-blocked',
        name: 'Source Output Full',
        description: 'Enable when source machine status is in Output Full',
        getRuleSet: () => ({
            operator: RuleOperator.AND,
            rules: [{
                left: { type: ValueReferenceType.MACHINE_STATUS, entity: EntityReference.SOURCE, status: MachineStatus.OUTPUT_FULL },
                operator: ComparisonOperator.EQUAL,
                right: { type: ValueReferenceType.CONSTANT, value: 1 },
            }],
        }),
    },
    {
        id: 'sink-below-limit',
        name: 'Sink Below Insertion Limit',
        description: 'Enable when sink inventory is below automated insertion limit',
        getRuleSet: (itemName) => ({
            operator: RuleOperator.AND,
            rules: [{
                left: { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SINK, item_name: itemName },
                operator: ComparisonOperator.LESS_THAN,
                right: { type: ValueReferenceType.AUTOMATED_INSERTION_LIMIT, entity: EntityReference.SINK, item_name: itemName },
            }],
        }),
    },
    {
        id: 'latched-output-drain',
        name: 'Latched Output Drain',
        description: 'Enable when sink reaches threshold, release when drained to output block',
        getRuleSet: (itemName) => ({
            operator: RuleOperator.AND,
            rules: [{
                left: { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SOURCE, item_name: itemName },
                operator: ComparisonOperator.GREATER_THAN_OR_EQUAL,
                right: { type: ValueReferenceType.CONSTANT, value: 32 },
            }],
        }),
        getRelease: (itemName) => ({
            operator: RuleOperator.AND,
            rules: [{
                left: { type: ValueReferenceType.INVENTORY_ITEM, entity: EntityReference.SINK, item_name: itemName },
                operator: ComparisonOperator.LESS_THAN_OR_EQUAL,
                right: { type: ValueReferenceType.OUTPUT_BLOCK, entity: EntityReference.SINK },
            }],
        }),
    },
];

interface QuickTemplateSelectProps {
    // onApply receives ruleSet (the base/enable condition) and optional release condition
    onApply: (ruleSet: RuleSet, release?: RuleSet) => void;
    defaultItemName: string;
}

export function QuickTemplateSelect({ onApply, defaultItemName }: QuickTemplateSelectProps) {
    const handleSelect = (templateId: string) => {
        const template = TEMPLATES.find((t) => t.id === templateId);
        if (template) {
            const ruleSet = template.getRuleSet(defaultItemName);
            const release = template.getRelease?.(defaultItemName);
            onApply(ruleSet, release);
        }
    };

    return (
        <Box sx={{ mb: 2 }}>
            <FormControl size="small" fullWidth>
                <InputLabel shrink>Quick Templates</InputLabel>
                <Select
                    value=""
                    label="Quick Templates"
                    onChange={(e) => handleSelect(e.target.value)}
                    displayEmpty
                    notched
                    renderValue={() => (
                        <Typography variant="body2" color="text.secondary">
                            Select a template to apply...
                        </Typography>
                    )}
                >
                    {TEMPLATES.map((template) => (
                        <MenuItem key={template.id} value={template.id}>
                            <Box>
                                <Typography variant="body2">{template.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {template.description}
                                </Typography>
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
        </Box>
    );
}
