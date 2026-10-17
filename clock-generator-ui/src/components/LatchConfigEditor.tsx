import {
    Box,
    Divider,
    FormControlLabel,
    Paper,
    Switch,
    Typography,
} from '@mui/material';
import type { TargetType } from 'clock-generator/browser';
import type { RuleSet } from '../hooks/useConfigForm';
import { FIELD_NAMES } from '../utils/a11yLabels';
import type { RuleProblem } from '../utils/ruleProblems';
import { entityNoun } from '../utils/ruleSentence';
import { RuleSetEditor } from './RuleSetEditor';
import { createDefaultRuleSet } from './ruleSetUtils';

type SourceSinkType = typeof TargetType[keyof typeof TargetType];

interface LatchConfigEditorProps {
    enabled: boolean;
    releaseCondition: RuleSet | undefined;
    onToggle: (enabled: boolean) => void;
    onReleaseChange: (release: RuleSet) => void;
    availableItems: string[];
    sourceType: SourceSinkType;
    sinkType: SourceSinkType;
    entityType: 'inserter' | 'drill';
    idPrefix: string;
    /** The form's problems by field id */
    problems: ReadonlyMap<string, RuleProblem>;
}

export function LatchConfigEditor({
    enabled,
    releaseCondition,
    onToggle,
    onReleaseChange,
    availableItems,
    sourceType,
    sinkType,
    entityType,
    idPrefix,
    problems,
}: LatchConfigEditorProps) {
    const handleToggle = (checked: boolean) => {
        onToggle(checked);
        // Initialize release condition when enabling
        if (checked && !releaseCondition) {
            onReleaseChange(createDefaultRuleSet());
        }
    };

    return (
        <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box>
                    <Typography variant="subtitle2">Latched</Typography>
                    <Typography variant="caption" color="text.secondary">
                        Once switched on, it stays on until the release conditions are true.
                    </Typography>
                </Box>
                <FormControlLabel
                    control={
                        <Switch
                            checked={enabled}
                            onChange={(e) => handleToggle(e.target.checked)}
                            // the label is empty: the heading beside the switch is what it is called
                            slotProps={{ input: { 'aria-label': FIELD_NAMES.latchedMode } }}
                        />
                    }
                    label=""
                />
            </Box>

            {enabled && releaseCondition && (
                <>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Release conditions
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        When these are true, the {entityNoun(entityType)} is switched off again.
                    </Typography>
                    <RuleSetEditor
                        ruleSet={releaseCondition}
                        onChange={onReleaseChange}
                        availableItems={availableItems}
                        sourceType={sourceType}
                        sinkType={sinkType}
                        path="release"
                        idPrefix={idPrefix}
                        problems={problems}
                    />
                </>
            )}
        </Paper>
    );
}
