import { SetpointRateField } from './SetpointRateField';
import type { SetpointRate } from 'clock-generator/light';
import { Box, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { refusalOfPickIn, type SetpointOutput, type SetpointReason } from 'clock-generator/light';
import { useGameNames } from '../hooks/useGameNames';
import { setpointRefusalWords } from '../utils/setpointRefusalText';
import { COPY_OFFSET_MIN_TILES, copyOffsetOf, copyOffsetShown, SIDES, type CopyOffset, type Side } from '../utils/copyOffset';
import { HelpButton } from './HelpButton';
import { copiesProblem } from '../utils/copiesProblem';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { TARGET_RECIPE_NAME } from '../utils/a11yLabels';
import { itemsPerSecondHelper } from '../utils/numberText';
import { ELEMENT_IDS } from '../utils/firstProblem';
import { SETPOINT_HEADING_ID } from '../utils/introCard';
import { targetRateLineOf, type MachinesMax } from '../utils/targetRateLimit';
import { COUNTS_CHOICES, COUNTS_TEXT, type TargetCounts } from '../utils/targetCounts';

interface SetpointFormProps {
    recipe: string;
    itemsPerSecond: SetpointRate;
    /** Number of duplicate setups being modeled; may be fractional, such as 5.5, for a partial block */
    copies: number;
    /** What the rate counts: the item made and taken out, or the item brought in and destroyed */
    counts: TargetCounts;
    /** The most the machines making (or destroying) the recipe's item can make, for the problem line under Items per Second; null while unknown */
    machinesMax: MachinesMax | null;
    recipeNames: string[];
    /** The items the build's machines take in, which a target that counts an item destroyed is chosen from */
    destroyedItemNames?: string[];
    /** What a setpoint counts for a recipe and what it offers to choose from (the engine's rule); null for a name that is no recipe the lookups know */
    recipeOutputOf?: (recipe: string) => SetpointOutput | null;
    /** The recipes of the build's machines, in order: a saved setpoint opens with the recipe of the first that makes its item */
    machineRecipes?: readonly string[];
    /** Called with the item the setpoint counts: the output of the chosen recipe, or the output chosen of its several */
    onRecipeChange: (recipe: string) => void;
    onItemsPerSecondChange: (value: SetpointRate) => void;
    onCountsChange: (counts: TargetCounts) => void;
    onCopiesChange: (value: number) => void;
    /** Where the next copy stands from this one, in tiles; undefined while not given */
    copyOffset?: CopyOffset;
    /** Whether to ask for it: the copies drop onto a belt from inserters whose places are known */
    showCopyOffset?: boolean;
    onCopyOffsetChange?: (value: CopyOffset | undefined) => void;
    /** What the engine says of whether the copies' drops fit at that gap, for the window cycle estimated from the settings; null while it says nothing */
    copyOffsetNote?: string | null;
}

export function SetpointForm({
    recipe,
    itemsPerSecond,
    copies,
    counts,
    machinesMax,
    recipeNames,
    destroyedItemNames = [],
    recipeOutputOf = () => null,
    machineRecipes = [],
    onRecipeChange,
    onItemsPerSecondChange,
    onCountsChange,
    onCopiesChange,
    copyOffset,
    showCopyOffset = false,
    onCopyOffsetChange,
    copyOffsetNote,
}: SetpointFormProps) {
    const shown = copyOffsetShown(copyOffset);
    const { itemLabel } = useGameNames();
    // What the user picked, kept while the item it was picked at is still the setpoint's: a recipe that saved no item (refused)
    // and an output that was refused leave the item as it was
    const [pick, setPick] = useState<{ recipe: string; choice: string | null; item: string; reason: SetpointReason | null } | null>(null);
    const made = counts === 'made';
    const live = made && pick !== null && pick.item === recipe ? pick : null;
    const ofMachines = made && live === null ? machineRecipes.find(name => { const output = recipeOutputOf(name); return output?.kind === 'output' && output.item === recipe; }) : undefined;
    const shownRecipe = live?.recipe ?? ofMachines ?? recipe;
    const output = live !== null || ofMachines !== undefined ? recipeOutputOf(shownRecipe) : null;
    const choices = output?.kind === 'output' && output.choices.length > 1 ? output.choices : null;
    const chooseRecipe = (name: string | null) => {
        const picked = name ?? '';
        const found = picked === '' || !made ? null : recipeOutputOf(picked);
        if (found === null) { setPick(null); onRecipeChange(picked); return; }
        if (found.kind === 'none') { setPick({ recipe: picked, choice: null, item: recipe, reason: { code: 'no-countable-output', recipe: picked } }); return; }
        setPick({ recipe: picked, choice: found.item, item: found.item, reason: null });
        onRecipeChange(found.item);
    };
    const chooseOutput = (item: string) => {
        const reason = refusalOfPickIn(item, [shownRecipe], recipeOutputOf);
        setPick({ recipe: shownRecipe, choice: item, item: reason === null ? item : recipe, reason });
        if (reason === null) onRecipeChange(item);
    };
    // a setpoint that holds a refused item (a saved build, a file, a paste) shows the words as a pick would
    const held: SetpointReason | null = made && live === null && ofMachines === undefined
        ? refusalOfPickIn(recipe, machineRecipes, recipeOutputOf)
            ?? (recipeOutputOf(recipe)?.kind === 'none' ? { code: 'no-countable-output', recipe } : null)
        : null;
    const recipeReason = held ?? (live?.reason?.code === 'no-countable-output' ? live.reason : null);
    const outputReason = live?.reason?.code === 'not-counted-yet' ? live.reason : null;
    return (
        // the heading is focused by script when the intro card or a dialog that held the focus goes
        <Paper component="section" variant="outlined" data-build-anchor="target" aria-labelledby={SETPOINT_HEADING_ID}
            sx={{ mb: 2, p: 1.5, containerType: 'inline-size', containerName: 'setpoint' }}>
            <Box sx={{ display: 'grid', gap: 1.5, alignItems: 'start', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                '@container setpoint (min-width: 820px)': { gridTemplateColumns: 'auto minmax(0, 1fr) 168px 200px 110px', alignItems: 'center' } }}>
                <Typography component="h2" variant="subtitle1" id={SETPOINT_HEADING_ID} tabIndex={-1}
                    sx={{ fontWeight: 600, gridColumn: '1 / -1', '@container setpoint (min-width: 820px)': { gridColumn: 'auto' } }}>Setpoint</Typography>
                <ItemSelector
                    // an item destroyed is no recipe's product (scrap is mined): it is chosen from what the machines take in
                    kind={counts === 'destroyed' ? 'item' : 'recipe'}
                    inputId={ELEMENT_IDS.targetRecipe}
                    sx={{ minWidth: 0, gridColumn: '1 / -1', '@container setpoint (min-width: 820px)': { gridColumn: 'auto' } }}
                    minWidth={0}
                    dropdownMinWidth={300}
                    size="small"
                    options={counts === 'destroyed' ? destroyedItemNames : recipeNames}
                    value={shownRecipe || null}
                    onChange={chooseRecipe}
                    errorText={recipeReason ? setpointRefusalWords(recipeReason) : undefined}
                    label="Recipe"
                    placeholder="Search recipes..."
                    required
                    // the label says "Recipe" in every row: say whose it is
                    inputAriaLabel={TARGET_RECIPE_NAME}
                    freeSolo
                />
                <SetpointRateField value={itemsPerSecond} copies={copies} onChange={onItemsPerSecondChange}
                    capacity_problem={targetRateLineOf({ itemsPerSecond, copies, max: machinesMax, counts })} />
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
                {choices && (
                    <TextField select size="small" label="Output" value={live?.choice ?? recipe} onChange={event => chooseOutput(event.target.value)}
                        error={outputReason !== null} helperText={outputReason ? setpointRefusalWords(outputReason) : undefined}
                        sx={{ minWidth: 0, gridColumn: '1 / -1' }}>
                        {choices.map(item => <MenuItem key={item} value={item}>{itemLabel(item)}</MenuItem>)}
                    </TextField>
                )}
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
                    <Typography variant="body2" sx={{ mb: 1 }}>Describe one build in the Build section: its machines, inserters, belts, and chests. Copies is how many identical builds you want to model.</Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>Items per Second is the combined target for all copies. For example, 250 items/s with 5 copies means each build makes 50 items/s.</Typography>
                    <Typography variant="body2">Copies may include a partial build, such as 0.5 or 2.25. You do not need to duplicate the rows for each copy.</Typography>
                </HelpButton>
            </Typography>
        </Paper>
    );
}
