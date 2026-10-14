import { Autocomplete, Box, Paper, TextField, Typography } from '@mui/material';
import { FactorioIcon } from './FactorioIcon';
import { NumberField } from './NumberField';

interface TargetOutputFormProps {
    recipe: string;
    itemsPerSecond: number;
    /** Number of duplicate setups being modeled */
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
            <Typography variant="h6" gutterBottom>
                Target Output
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Autocomplete
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
                                input: {
                                    ...params.InputProps,
                                    startAdornment: recipe ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
                                            <FactorioIcon name={recipe} size={20} />
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
                                <FactorioIcon name={option} size={20} />
                                {option}
                            </Box>
                        );
                    }}
                    freeSolo
                    autoHighlight
                />
                <NumberField
                    label="Items per Second"
                    value={itemsPerSecond}
                    onValueChange={(val) => onItemsPerSecondChange(parseFloat(val?.toString() || '') || 0)}
                    min={0}
                    step={0.1}
                    sx={{ width: 150 }}
                    required
                    error={itemsPerSecond <= 0}
                    helperText={itemsPerSecond <= 0 ? 'Must be more than 0' : undefined}
                />
                <NumberField
                    label="Copies"
                    value={copies}
                    onValueChange={(val) => onCopiesChange(parseInt(val?.toString() || '') || 1)}
                    min={1}
                    step={1}
                    sx={{ width: 120 }}
                    required
                />
            </Box>
        </Paper>
    );
}
