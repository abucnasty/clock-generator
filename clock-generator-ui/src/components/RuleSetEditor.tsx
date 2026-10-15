import { Add, AddCircleOutline } from '@mui/icons-material';
import { Box, Button, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { 
    RuleOperator, 
    TargetType 
} from 'clock-generator/light';
import type { Condition, RuleSet } from '../hooks/useConfigForm';
import { GROUP_NAMES, removeGroupName } from '../utils/a11yLabels';
import type { RuleProblem } from '../utils/ruleProblems';
import { ConditionRow } from './ConditionRow';
import { 
    isCondition, 
    createDefaultCondition, 
    createDefaultStatusCondition, 
    createDefaultRuleSet 
} from './ruleSetUtils';

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

interface RuleSetEditorProps {
    ruleSet: RuleSet;
    onChange: (ruleSet: RuleSet) => void;
    availableItems: string[];
    sourceType: SourceSinkType;
    sinkType: SourceSinkType;
    depth?: number;
    label?: string;
    /** The set's place in the rule: "rule" or "release" at the top, then the index of each group ("rule.2") */
    path: string;
    idPrefix: string;
    /** The form's problems by field id */
    problems: ReadonlyMap<string, RuleProblem>;
}

export function RuleSetEditor({
    ruleSet,
    onChange,
    availableItems,
    sourceType,
    sinkType,
    depth = 0,
    label,
    path,
    idPrefix,
    problems,
}: RuleSetEditorProps) {
    const handleOperatorChange = (_: React.MouseEvent<HTMLElement>, newOperator: RuleOperator | null) => {
        if (newOperator) {
            onChange({ ...ruleSet, operator: newOperator });
        }
    };

    const handleRuleChange = (index: number, rule: Condition | RuleSet) => {
        const newRules = [...ruleSet.rules];
        newRules[index] = rule;
        onChange({ ...ruleSet, rules: newRules });
    };

    const handleDeleteRule = (index: number) => {
        if (ruleSet.rules.length > 1) {
            const newRules = ruleSet.rules.filter((_, i) => i !== index);
            onChange({ ...ruleSet, rules: newRules });
        }
    };

    const handleAddCondition = () => {
        onChange({ ...ruleSet, rules: [...ruleSet.rules, createDefaultCondition()] });
    };

    const handleAddStatusCondition = () => {
        onChange({ ...ruleSet, rules: [...ruleSet.rules, createDefaultStatusCondition()] });
    };

    const handleAddGroup = () => {
        onChange({ ...ruleSet, rules: [...ruleSet.rules, createDefaultRuleSet()] });
    };

    const borderColor = depth % 2 === 0 ? 'primary.main' : 'secondary.main';
    const canAddStatusCondition = sourceType === TargetType.MACHINE || sinkType === TargetType.MACHINE;

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 1.5,
                borderLeft: 3,
                borderLeftColor: borderColor,
                bgcolor: "background.paper",
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                {label && (
                    <Typography variant="subtitle2" color="text.secondary">
                        {label}
                    </Typography>
                )}
                <ToggleButtonGroup
                    value={ruleSet.operator}
                    exclusive
                    onChange={handleOperatorChange}
                    size="small"
                    aria-label={GROUP_NAMES.joinConditions}
                >
                    <ToggleButton value={RuleOperator.AND}>AND</ToggleButton>
                    <ToggleButton value={RuleOperator.OR}>OR</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary">
                    {ruleSet.operator === RuleOperator.AND ? 'All conditions must be true' : 'Any condition can be true'}
                </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {ruleSet.rules.map((rule, index) => (
                    <Box key={index}>
                        {isCondition(rule) ? (
                            <ConditionRow
                                condition={rule}
                                onChange={(c) => handleRuleChange(index, c)}
                                onDelete={() => handleDeleteRule(index)}
                                availableItems={availableItems}
                                sourceType={sourceType}
                                sinkType={sinkType}
                                canDelete={ruleSet.rules.length > 1}
                                path={`${path}.${index}`}
                                idPrefix={idPrefix}
                                problems={problems}
                            />
                        ) : (
                            <Box sx={{ position: 'relative' }}>
                                <RuleSetEditor
                                    ruleSet={rule}
                                    onChange={(r) => handleRuleChange(index, r)}
                                    availableItems={availableItems}
                                    sourceType={sourceType}
                                    sinkType={sinkType}
                                    depth={depth + 1}
                                    path={`${path}.${index}`}
                                    idPrefix={idPrefix}
                                    problems={problems}
                                />
                                {ruleSet.rules.length > 1 && (
                                    <Button
                                        size="small"
                                        color="error"
                                        onClick={() => handleDeleteRule(index)}
                                        aria-label={removeGroupName(index + 1)}
                                        sx={{ position: 'absolute', top: 4, right: 4 }}
                                    >
                                        Remove group
                                    </Button>
                                )}
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Button
                    size="small"
                    startIcon={<Add />}
                    onClick={handleAddCondition}
                >
                    Add condition
                </Button>
                {canAddStatusCondition && (
                    <Button
                        size="small"
                        startIcon={<Add />}
                        onClick={handleAddStatusCondition}
                    >
                        Add status condition
                    </Button>
                )}
                <Button
                    size="small"
                    startIcon={<AddCircleOutline />}
                    onClick={handleAddGroup}
                    variant="outlined"
                >
                    Add group
                </Button>
            </Box>
        </Paper>
    );
}
