import { Box, Paper, Typography } from '@mui/material';
import { HelpButton } from './HelpButton';
import { copiesProblem } from '../utils/copiesProblem';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { TARGET_RECIPE_NAME } from '../utils/a11yLabels';
import { itemsPerSecondHelper } from '../utils/numberText';
import { ELEMENT_IDS } from '../utils/firstProblem';
import { TARGET_OUTPUT_HEADING_ID } from '../utils/introCard';
import { targetRateLineOf, type MachinesMax } from '../utils/targetRateLimit';

interface TargetOutputFormProps {
    recipe: string;
    itemsPerSecond: number;
    /** Number of duplicate setups being modeled; may be fractional, such as 5.5, for a partial block */
    copies: number;
    /** The most the machines making the recipe can make, for the problem line under Items per Second; null while unknown */
    machinesMax: MachinesMax | null;
    recipeNames: string[];
    onRecipeChange: (recipe: string) => void;
    onItemsPerSecondChange: (value: number) => void;
    onCopiesChange: (value: number) => void;
}

export function TargetOutputForm({
    recipe,
    itemsPerSecond,
    copies,
    machinesMax,
    recipeNames,
    onRecipeChange,
    onItemsPerSecondChange,
    onCopiesChange,
}: TargetOutputFormProps) {
    return (
        // the heading is focused by script when the intro card or a dialog that held the focus goes
        <Paper component="section" variant="outlined" data-build-anchor="target" aria-labelledby={TARGET_OUTPUT_HEADING_ID}
            sx={{ mb: 2, p: 1.5, containerType: 'inline-size', containerName: 'target-output' }}>
            <Box sx={{ display: 'grid', gap: 1.5, alignItems: 'start', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                '@container target-output (min-width: 700px)': { gridTemplateColumns: 'auto minmax(0, 1fr) 160px 110px', alignItems: 'center' } }}>
                <Typography component="h2" variant="subtitle1" id={TARGET_OUTPUT_HEADING_ID} tabIndex={-1}
                    sx={{ fontWeight: 600, gridColumn: '1 / -1', '@container target-output (min-width: 700px)': { gridColumn: 'auto' } }}>Target Output</Typography>
                <ItemSelector
                    kind="recipe"
                    inputId={ELEMENT_IDS.targetRecipe}
                    sx={{ minWidth: 0, gridColumn: '1 / -1', '@container target-output (min-width: 700px)': { gridColumn: 'auto' } }}
                    minWidth={0}
                    dropdownMinWidth={300}
                    size="small"
                    options={recipeNames}
                    value={recipe || null}
                    onChange={(newValue) => onRecipeChange(newValue || '')}
                    label="Recipe"
                    placeholder="Search recipes..."
                    required
                    // the label says "Recipe" in every row: say whose it is
                    inputAriaLabel={TARGET_RECIPE_NAME}
                    freeSolo
                />
                <NumberField
                    id={ELEMENT_IDS.targetRate}
                    label="Items per Second"
                    value={itemsPerSecond}
                    onValueChange={(val) => onItemsPerSecondChange(parseFloat(val?.toString() || '') || 0)}
                    min={0}
                    step={0.1}
                    sx={{ minWidth: 0 }}
                    size="small"
                    required
                    error={itemsPerSecond <= 0}
                    helperText={itemsPerSecond <= 0 ? 'Must be more than 0' : undefined}
                    problem={targetRateLineOf({ itemsPerSecond, copies, max: machinesMax })}
                />
                <NumberField
                    id={ELEMENT_IDS.targetCopies}
                    label="Copies"
                    value={copies}
                    onValueChange={(val) => onCopiesChange(val ?? 0)}
                    min={0}
                    step={0.5}
                    sx={{ minWidth: 0 }}
                    size="small"
                    required
                    error={Boolean(copiesProblem(copies))}
                    problem={copiesProblem(copies)}
                    preserveInputOnBlur={Boolean(copiesProblem(copies))}
                />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 0.75, mt: 0.5 }}>
                <Box component="span">{itemsPerSecondHelper(itemsPerSecond, copies)}</Box>
                <HelpButton label="About copies">
                    <Typography variant="body2" sx={{ mb: 1 }}>Describe one setup in the Build section: its machines, inserters, belts, and chests. Copies is how many identical setups you want to model.</Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>Items per Second is the combined target for all copies. For example, 250 items/s with 5 copies means each setup makes 50 items/s.</Typography>
                    <Typography variant="body2">Copies may include a partial setup, such as 0.5 or 2.25. You do not need to duplicate the rows for each copy.</Typography>
                </HelpButton>
            </Typography>
        </Paper>
    );
}
