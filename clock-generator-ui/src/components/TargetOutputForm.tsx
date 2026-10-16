import { Autocomplete, Box, Paper, TextField, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import { NumberField } from './NumberField';
import { TARGET_RECIPE_NAME } from '../utils/a11yLabels';
import { COPIES_HELPER, itemsPerSecondHelper } from '../utils/numberText';
import { ELEMENT_IDS } from '../utils/firstProblem';

interface TargetOutputFormProps {
    recipe: string;
    itemsPerSecond: number;
    /** Number of duplicate setups being modeled; may be fractional, such as 5.5, for a partial block */
    copies: number;
    recipeNames: string[];
    onRecipeChange: (recipe: string) => void;
    onItemsPerSecondChange: (value: number) => void;
    onCopiesChange: (value: number) => void;
}

export function TargetOutputForm({
    recipe,
    itemsPerSecond,
    copies,
    recipeNames,
    onRecipeChange,
    onItemsPerSecondChange,
    onCopiesChange,
}: TargetOutputFormProps) {
    return (
        <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" component="h2" gutterBottom>
                Target Output
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Autocomplete
                    id={ELEMENT_IDS.targetRecipe}
                    sx={{ minWidth: 300, flex: 1 }}
                    options={recipeNames}
                    value={recipe || null}
                    onChange={(_, newValue) => onRecipeChange(newValue || '')}
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            label="Recipe"
                            placeholder="Search recipes..."
                            required
                            slotProps={{
                                // the label says "Recipe" in every row: say whose it is
                                htmlInput: { ...params.inputProps, 'aria-label': TARGET_RECIPE_NAME },
                                input: {
                                    ...params.InputProps,
                                    startAdornment: recipe ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
                                            <FactorioIcon name={recipe} size={20} alt="" />
                                        </Box>
                                    ) : null,
                                },
                            }}
                        />
                    )}
                    renderOption={(props, option) => {
                        const { key, ...rest } = props;
                        return (
                            <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FactorioIcon name={option} size={20} alt="" />
                                {option}
                            </Box>
                        );
                    }}
                    freeSolo
                    autoHighlight
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
                />
                <NumberField
                    id={ELEMENT_IDS.targetCopies}
                    label="Copies"
                    value={copies}
                    onValueChange={(val) => onCopiesChange(val ?? 0)}
                    min={0}
                    step={0.5}
                    sx={{ width: 200 }}
                    required
                    error={copies <= 0}
                    helperText={copies <= 0 ? 'Must be more than 0' : COPIES_HELPER}
                />
            </Box>
        </Paper>
    );
}
