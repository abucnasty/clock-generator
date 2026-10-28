import { Box, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { COPY_OFFSET_MIN_TILES, copyOffsetOf, copyOffsetShown, SIDES, type CopyOffset, type Side } from '../utils/copyOffset';
import { HelpButton } from './HelpButton';
import { copiesProblem } from '../utils/copiesProblem';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { TARGET_RECIPE_NAME } from '../utils/a11yLabels';
import { itemsPerSecondHelper } from '../utils/numberText';
import { ELEMENT_IDS } from '../utils/firstProblem';
import { TARGET_OUTPUT_HEADING_ID } from '../utils/introCard';
import { targetRateLineOf, type MachinesMax } from '../utils/targetRateLimit';
import { COUNTS_CHOICES, COUNTS_TEXT, type TargetCounts } from '../utils/targetCounts';

interface TargetOutputFormProps {
    recipe: string;
    itemsPerSecond: number;
    /** Number of duplicate setups being modeled; may be fractional, such as 5.5, for a partial block */
    copies: number;
    /** What the rate counts: the item made and taken out, or the item brought in and destroyed */
    counts: TargetCounts;
    /** The most the machines making (or destroying) the recipe's item can make, for the problem line under Items per Second; null while unknown */
    machinesMax: MachinesMax | null;
    recipeNames: string[];
    /** The items the build's machines take in, which a target that counts an item destroyed is chosen from */
    destroyedItemNames?: string[];
    onRecipeChange: (recipe: string) => void;
    onItemsPerSecondChange: (value: number) => void;
    onCountsChange: (counts: TargetCounts) => void;
    onCopiesChange: (value: number) => void;
    /** Where the next copy stands from this one, in tiles; undefined while not given */
    copyOffset?: CopyOffset;
    /** Whether to ask for it: the copies drop onto a belt from inserters whose places are known */
    showCopyOffset?: boolean;
    onCopyOffsetChange?: (value: CopyOffset | undefined) => void;
    /** What the engine says of whether the copies' drops fit at that gap, for the period estimated from the settings; null while it says nothing */
    copyOffsetNote?: string | null;
}

export function TargetOutputForm({
    recipe,
    itemsPerSecond,
    copies,
    counts,
    machinesMax,
    recipeNames,
    destroyedItemNames = [],
    onRecipeChange,
    onItemsPerSecondChange,
    onCountsChange,
    onCopiesChange,
    copyOffset,
    showCopyOffset = false,
    onCopyOffsetChange,
    copyOffsetNote,
}: TargetOutputFormProps) {
    const shown = copyOffsetShown(copyOffset);
    return (
        // the heading is focused by script when the intro card or a dialog that held the focus goes
        <Paper component="section" variant="outlined" data-build-anchor="target" aria-labelledby={TARGET_OUTPUT_HEADING_ID}
            sx={{ mb: 2, p: 1.5, containerType: 'inline-size', containerName: 'target-output' }}>
            <Box sx={{ display: 'grid', gap: 1.5, alignItems: 'start', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                '@container target-output (min-width: 820px)': { gridTemplateColumns: 'auto minmax(0, 1fr) 160px 200px 110px', alignItems: 'center' } }}>
                <Typography component="h2" variant="subtitle1" id={TARGET_OUTPUT_HEADING_ID} tabIndex={-1}
                    sx={{ fontWeight: 600, gridColumn: '1 / -1', '@container target-output (min-width: 820px)': { gridColumn: 'auto' } }}>Target Output</Typography>
                <ItemSelector
                    // an item destroyed is no recipe's product (scrap is mined): it is chosen from what the machines take in
                    kind={counts === 'destroyed' ? 'item' : 'recipe'}
                    inputId={ELEMENT_IDS.targetRecipe}
                    sx={{ minWidth: 0, gridColumn: '1 / -1', '@container target-output (min-width: 820px)': { gridColumn: 'auto' } }}
                    minWidth={0}
                    dropdownMinWidth={300}
                    size="small"
                    options={counts === 'destroyed' ? destroyedItemNames : recipeNames}
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
                    problem={targetRateLineOf({ itemsPerSecond, copies, max: machinesMax, counts })}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                    <TextField select size="small" fullWidth label={COUNTS_TEXT.label} value={counts}
                        onChange={(event) => onCountsChange(event.target.value as TargetCounts)} sx={{ minWidth: 0 }}>
                        {COUNTS_CHOICES.map(choice => <MenuItem key={choice.value} value={choice.value}>{choice.label}</MenuItem>)}
                    </TextField>
                    <HelpButton label={COUNTS_TEXT.helpLabel}>
                        <Typography variant="body2" sx={{ mb: 1 }}>{COUNTS_TEXT.helpMade}</Typography>
                        <Typography variant="body2">{COUNTS_TEXT.helpDestroyed}</Typography>
                    </HelpButton>
                </Box>
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
            {showCopyOffset && onCopyOffsetChange && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5, mt: 1 }}>
                    <Typography variant="body2" component="span">Next copy stands</Typography>
                    {shown === 'diagonal' ? (
                        <Typography variant="body2" component="span">{`${Math.abs(copyOffset!.x)} tiles ${copyOffset!.x < 0 ? 'west' : 'east'} and ${Math.abs(copyOffset!.y)} tiles ${copyOffset!.y < 0 ? 'north' : 'south'}`}</Typography>
                    ) : (
                        <NumberField
                            id={ELEMENT_IDS.targetCopyOffset}
                            inputAriaLabel="Tiles to the next copy"
                            value={shown.tiles}
                            onValueChange={(val) => onCopyOffsetChange(copyOffsetOf(val ?? null, shown.side))}
                            // no tiles is no gap, which the field shows empty: a step down to 0 would empty it, and a step up from
                            // empty would land on 0 and empty it again
                            min={COPY_OFFSET_MIN_TILES}
                            step={1}
                            sx={{ width: 110 }}
                            size="small"
                        />
                    )}
                    <Typography variant="body2" component="span">tiles</Typography>
                    {shown !== 'diagonal' && (
                        <TextField select size="small" value={shown.side} slotProps={{ htmlInput: { 'aria-label': 'Side of the next copy' } }}
                            onChange={(event) => onCopyOffsetChange(copyOffsetOf(shown.tiles, event.target.value as Side))} sx={{ minWidth: 100 }}>
                            {SIDES.map(side => <MenuItem key={side} value={side}>{side}</MenuItem>)}
                        </TextField>
                    )}
                    <Typography variant="body2" component="span">of this one</Typography>
                    <HelpButton label="About the next copy">
                        <Typography variant="body2" sx={{ mb: 1 }}>Where the next copy of the build stands, so that the drops of all the copies onto a shared belt can be checked. Leave it empty when the copies have belts of their own.</Typography>
                    </HelpButton>
                </Box>
            )}
            {showCopyOffset && onCopyOffsetChange && copyOffsetNote && (
                <Typography variant="body2" color="text.secondary" role="status" data-testid="copy-offset-note" sx={{ mt: 0.5 }}>{copyOffsetNote}</Typography>
            )}
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
