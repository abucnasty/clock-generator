import { Box, Button, TextField, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { craftingCycleAt, type CraftingCycles } from '../utils/craftingCycles';
import { GLOSSARY } from '../utils/glossary';
import { formatNumberText } from '../utils/numberText';
import { HANDS_TEXT, type TargetCounts } from '../utils/targetCounts';

const definition = GLOSSARY.find(entry => entry.id === 'crafting-cycle')!.definition;

export function CraftingCycleNavigator({ cycles, index, periodTicks, swings, counts, onSelect }: {
    cycles: CraftingCycles | null; index: number; periodTicks: number; swings: number; counts?: TargetCounts; onSelect(index: number): void;
}) {
    const cycle = craftingCycleAt(cycles, index);
    const number = (n: number) => formatNumberText(n, { maxDecimals: 3 });
    if (!cycles || !cycle) return <Typography variant="body2" sx={{ mb: 1 }}>This saved result does not include a valid crafting-cycle length. Generate again to explore its planned cycles.</Typography>;
    return <Box component="section" aria-label="Crafting cycle navigation" sx={{ border: 1, borderColor: 'divider', p: 1.5, mb: 1.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Button color="inherit" size="small" startIcon={<ChevronLeft />} disabled={index === 0} onClick={() => onSelect(index - 1)}>Previous cycle</Button>
            <TextField type="number" label="Crafting cycle" size="small" value={index + 1} onChange={event => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 1 && value <= cycles.count) onSelect(value - 1);
            }} slotProps={{ htmlInput: { min: 1, max: cycles.count, step: 1 } }} sx={{ width: 125 }} />
            <Typography variant="body2">of {cycles.count}</Typography>
            <Button color="inherit" size="small" endIcon={<ChevronRight />} disabled={index + 1 === cycles.count} onClick={() => onSelect(index + 1)}>Next cycle</Button>
        </Box>
        <Typography variant="body2" sx={{ mt: 1 }}>
            {number(cycle.start)}–{number(cycle.end)} ticks · {number(cycles.cycleTicks)} ticks per crafting cycle{cycle.partial ? ' · final segment is partial' : ''}.
            {' '}{counts === 'destroyed' ? HANDS_TEXT.navigator(swings, number(swings))
                : `Each output machine has ${number(swings)} total output ${swings === 1 ? 'swing' : 'swings'} per crafting cycle.`}
            {' '}The clock repeats every {number(periodTicks)} ticks ({number(periodTicks / cycles.cycleTicks)} crafting cycles).
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>{definition}</Typography>
        <Typography variant="caption" color="text.secondary" component="p">Row percentages and wake-ups/min describe the whole clock period.</Typography>
    </Box>;
}
