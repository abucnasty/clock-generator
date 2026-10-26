import { Box, MenuItem, TextField, Typography, type SxProps, type Theme } from '@mui/material';
import { useMemo } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import type { MachineFormData } from '../utils/configForm/formData';
import { entitySelectorLabel } from '../utils/entitySelector';
import { RESULT_TARGET_TEXT, resultTargetName, resultTargetOptions, type ResultTargetBuild, type ResultTargetOption } from '../utils/resultTarget';
import { HelpButton } from './HelpButton';
import { ContentIcons, RouteBadge } from './RouteIdentity';

/** The value of the no-receiver choice, which no container id can be. */
const OWN_OUTPUT = 'own-output';

function Choice({ option }: { option: ResultTargetOption }) {
    return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <RouteBadge option={option} />
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography variant="body2">{option.label}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ContentIcons option={option} size={16} />
                {option.sublabel && <Typography variant="caption" color="text.secondary">{option.sublabel}</Typography>}
            </Box>
        </Box>
    </Box>;
}

/**
 * The physical receiver at a recycler's output, or no receiver. Empty, and marked, when its container was deleted.
 */
export function ResultTargetField({ machine, machineLabel, build, getRecipeInfo, onChange, sx }: {
    machine: Pick<MachineFormData, 'id' | 'result_target'>;
    /** "Machine 1", which the field's accessible name ends in */
    machineLabel: string;
    build: ResultTargetBuild;
    getRecipeInfo?: (name: string) => RecipeInfo | null;
    onChange: (resultTarget: MachineFormData['result_target']) => void;
    sx?: SxProps<Theme>;
}) {
    const { itemLabel, recipeLabel } = useGameNames();
    const options = useMemo(() => resultTargetOptions(build, { item: itemLabel, recipe: recipeLabel }, getRecipeInfo)
        .filter(option => option.type !== 'machine' || option.id !== machine.id),
        [build, itemLabel, recipeLabel, getRecipeInfo, machine.id]);
    const named = machine.result_target;
    const chosen = named === undefined ? undefined : options.find(option => option.type === named.type && option.id === named.id);
    // a container that is not there is not a choice: the field is empty, and marked
    const value = named === undefined ? OWN_OUTPUT : chosen ? `${chosen.type}:${chosen.id}` : '';
    return <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ...sx as object }}>
        <TextField id={`machine-result-target-${machine.id}`} select size="small" fullWidth label={RESULT_TARGET_TEXT.label} value={value} error={value === ''}
            onChange={event => {
                const [type, id] = event.target.value.split(':');
                onChange(event.target.value === OWN_OUTPUT ? undefined : { type: type as 'chest' | 'machine', id: Number(id) });
            }}
            slotProps={{ select: {
                SelectDisplayProps: { 'aria-label': resultTargetName(machineLabel), 'aria-labelledby': undefined },
                renderValue: shown => shown === OWN_OUTPUT ? RESULT_TARGET_TEXT.none
                    : chosen ? <Box title={entitySelectorLabel(chosen)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                        <RouteBadge option={chosen} /><ContentIcons option={chosen} />
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entitySelectorLabel(chosen)}</Box>
                    </Box> : '',
            } }}>
            <MenuItem value={OWN_OUTPUT}>{RESULT_TARGET_TEXT.none}</MenuItem>
            {options.map(option => <MenuItem key={`${option.type}:${option.id}`} value={`${option.type}:${option.id}`}><Choice option={option} /></MenuItem>)}
        </TextField>
        <HelpButton label={RESULT_TARGET_TEXT.helpLabel}>
            <Typography variant="body2">{RESULT_TARGET_TEXT.help}</Typography>
        </HelpButton>
    </Box>;
}
