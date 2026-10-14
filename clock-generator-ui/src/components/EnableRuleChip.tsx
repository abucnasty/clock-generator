import { Chip, Tooltip } from '@mui/material';
import type { EnableControlOverride } from '../hooks/useConfigForm';
import { describeEnableRule, enableChipAriaLabel, enableChipTooltip } from '../utils/enableRuleLabel';

interface EnableRuleChipProps {
    override: EnableControlOverride | undefined;
    /** The same name the rule editor's title shows, e.g. "Inserter 3" or "Drill 2" */
    entityLabel: string;
    /** An ALWAYS that Exclude from LCM wrote, which the tooltip and the accessible name say */
    forcedAlways?: boolean;
    onClick: () => void;
}

/** The enable rule of an inserter or a drill, named on its row; quiet for AUTO, in the accent colour for any other mode. Opens the rule editor. */
export function EnableRuleChip({ override, entityLabel, forcedAlways, onClick }: EnableRuleChipProps) {
    const description = describeEnableRule(override, { forcedAlways });
    return (
        <Tooltip title={enableChipTooltip(description)} describeChild>
            <Chip
                size="small"
                label={description.chip}
                variant={description.quiet ? 'outlined' : 'filled'}
                color={description.quiet ? 'default' : 'primary'}
                onClick={onClick}
                aria-label={enableChipAriaLabel(entityLabel, description)}
                sx={{
                    maxWidth: '100%',
                    ...(description.quiet && { color: 'text.secondary' }),
                    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                }}
            />
        </Tooltip>
    );
}
