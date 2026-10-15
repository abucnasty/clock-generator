import { Box, Paper, Typography } from '@mui/material';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { TARGET_RECIPE_NAME } from '../utils/a11yLabels';
import { COPIES_HELPER, itemsPerSecondHelper } from '../utils/numberText';
import { ELEMENT_IDS } from '../utils/firstProblem';
import { TARGET_OUTPUT_HEADING_ID } from '../utils/introCard';
import { targetRateWarningOf, type MachinesMax } from '../utils/targetRateWarning';

interface TargetOutputFormProps {
    recipe: string;
    itemsPerSecond: number;
    /** Number of duplicate setups being modeled */
    copies: number;
    /** The most the machines making the recipe can make, for the warning under Items per Second; null while unknown */
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
        <Paper sx={{ p: 2, mb: 2 }}>
            {/* focused by script when the intro card or a dialog that held the focus goes */}
            <Typography id={TARGET_OUTPUT_HEADING_ID} tabIndex={-1} variant="h6" component="h2" gutterBottom>
                Target Output
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <ItemSelector
                    kind="recipe"
                    inputId={ELEMENT_IDS.targetRecipe}
                    sx={{ flex: 1 }}
                    minWidth={300}
                    size="medium"
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
                    sx={{ width: 220 }}
                    required
                    error={itemsPerSecond <= 0}
                    helperText={itemsPerSecond <= 0 ? 'Must be more than 0' : itemsPerSecondHelper(itemsPerSecond, copies)}
                    warning={targetRateWarningOf({ itemsPerSecond, copies, max: machinesMax })}
                />
                <NumberField
                    id={ELEMENT_IDS.targetCopies}
                    label="Copies"
                    value={copies}
                    onValueChange={(val) => onCopiesChange(parseInt(val?.toString() || '') || 1)}
                    min={1}
                    step={1}
                    sx={{ width: 200 }}
                    required
                    helperText={COPIES_HELPER}
                />
            </Box>
        </Paper>
    );
}
