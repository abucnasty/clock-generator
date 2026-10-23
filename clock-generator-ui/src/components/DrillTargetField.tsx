import type { SxProps, Theme } from '@mui/material';
import { useMemo } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import type { DrillFormData } from '../utils/configForm/formData';
import { drillTargetOptions, type DrillTargetBuild } from '../utils/drillTarget';
import { entityLabel } from '../utils/entityLabel';
import { EntitySelector } from './EntitySelector';

/**
 * What a drill drops into: one picker over the build's machines and containers, with their icons and what they make or
 * hold. Empty, and marked, when the drill's target is unset (its machine or container was deleted).
 */
export function DrillTargetField({ drill, build, getRecipeInfo, onChange, sx }: {
    drill: Pick<DrillFormData, 'id' | 'target' | 'overrides'>;
    build: DrillTargetBuild;
    getRecipeInfo?: (name: string) => RecipeInfo | null;
    onChange: (target: DrillFormData['target']) => void;
    sx?: SxProps<Theme>;
}) {
    const { itemLabel, recipeLabel } = useGameNames();
    const options = useMemo(() => drillTargetOptions(drill, build, { item: itemLabel, recipe: recipeLabel }, getRecipeInfo),
        [drill, build, itemLabel, recipeLabel, getRecipeInfo]);
    const value = options.find(option => option.type === drill.target.type && option.id === drill.target.id) ?? null;
    return <EntitySelector label="Target" ariaLabel={`Target, ${entityLabel('drill', drill.id)}`} options={options} value={value}
        error={!value} disabledReason={option => option.disabledReason} sx={sx}
        onChange={option => { if (option.type !== drill.target.type || option.id !== drill.target.id) onChange({ type: option.type, id: option.id }); }} />;
}
