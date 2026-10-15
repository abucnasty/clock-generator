import { Delete } from '@mui/icons-material';
import { Box, FormControl, IconButton, MenuItem, Select } from '@mui/material';
import type { TargetType } from 'clock-generator/browser';
import { ComparisonOperator, ValueReferenceType } from 'clock-generator/light';
import type { Condition, ValueReference } from '../hooks/useConfigForm';
import { BUTTON_NAMES, SELECT_NAMES } from '../utils/a11yLabels';
import { itemFieldId, type RuleProblem } from '../utils/ruleProblems';
import { StatusConditionRow } from './StatusConditionRow';
import { ValueReferenceSelector } from './ValueReferenceSelector';

const ALL_OPERATORS: { value: ComparisonOperator; label: string }[] = [
    { value: ComparisonOperator.GREATER_THAN, label: '>' },
    { value: ComparisonOperator.LESS_THAN, label: '<' },
    { value: ComparisonOperator.GREATER_THAN_OR_EQUAL, label: '≥' },
    { value: ComparisonOperator.LESS_THAN_OR_EQUAL, label: '≤' },
    { value: ComparisonOperator.EQUAL, label: '=' },
    { value: ComparisonOperator.NOT_EQUAL, label: '≠' },
];

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

interface ConditionRowProps {
    condition: Condition;
    onChange: (condition: Condition) => void;
    onDelete: () => void;
    availableItems: string[];
    sourceType: SourceSinkType;
    sinkType: SourceSinkType;
    canDelete: boolean;
    /** The condition's place in the rule, "rule.0.1", which its fields' ids are made from */
    path: string;
    idPrefix: string;
    /** The form's problems by field id */
    problems: ReadonlyMap<string, RuleProblem>;
}

export function ConditionRow({
    condition,
    onChange,
    onDelete,
    availableItems,
    sourceType,
    sinkType,
    canDelete,
    path,
    idPrefix,
    problems,
}: ConditionRowProps) {
    const leftId = itemFieldId(idPrefix, path, 'left');
    const rightId = itemFieldId(idPrefix, path, 'right');
    // Use specialized row for MACHINE_STATUS enum conditions
    if (condition.left.type === ValueReferenceType.MACHINE_STATUS) {
        return (
            <StatusConditionRow
                condition={condition}
                onChange={onChange}
                onDelete={onDelete}
                sourceType={sourceType}
                sinkType={sinkType}
                canDelete={canDelete}
            />
        );
    }

    const handleLeftChange = (left: ValueReference) => {
        // If switching to MACHINE_STATUS, set operator to == and right to CONSTANT 1
        if (left.type === ValueReferenceType.MACHINE_STATUS) {
            onChange({ 
                left, 
                operator: ComparisonOperator.EQUAL,
                right: { type: ValueReferenceType.CONSTANT, value: 1 }
            });
        } else {
            onChange({ ...condition, left });
        }
    };

    const handleOperatorChange = (operator: ComparisonOperator) => {
        onChange({ ...condition, operator });
    };

    const handleRightChange = (right: ValueReference) => {
        onChange({ ...condition, right });
    };

    return (
        <Box
            sx={{
                display: 'flex',
                gap: 1,
                alignItems: 'center',
                flexWrap: 'wrap',
                py: 0.5,
            }}
        >
            <ValueReferenceSelector
                value={condition.left}
                onChange={handleLeftChange}
                availableItems={availableItems}
                sourceType={sourceType}
                sinkType={sinkType}
                compact
                itemFieldId={leftId}
                itemError={problems.get(leftId)?.text}
            />

            <FormControl size="small" sx={{ minWidth: 60 }}>
                <Select
                    inputProps={{ 'aria-label': SELECT_NAMES.comparisonOperator }}
                    value={condition.operator}
                    onChange={(e) => handleOperatorChange(e.target.value as ComparisonOperator)}
                >
                    {ALL_OPERATORS.map((op) => (
                        <MenuItem key={op.value} value={op.value}>
                            {op.label}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <ValueReferenceSelector
                value={condition.right}
                onChange={handleRightChange}
                availableItems={availableItems}
                sourceType={sourceType}
                sinkType={sinkType}
                compact
                itemFieldId={rightId}
                itemError={problems.get(rightId)?.text}
            />

            <IconButton
                onClick={onDelete}
                disabled={!canDelete}
                size="small"
                color="error"
                aria-label={BUTTON_NAMES.removeCondition}
            >
                <Delete fontSize="small" />
            </IconButton>
        </Box>
    );
}
