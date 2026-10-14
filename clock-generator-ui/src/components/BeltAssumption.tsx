import { Box, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { useId } from 'react';
import { BELT_COPY, type BeltAnswer } from '../utils/beltQuestion';

interface BeltAssumptionProps {
    answer: BeltAnswer;
    onChange: (answer: BeltAnswer) => void;
}

const OPTIONS: { value: BeltAnswer; label: string; line: string }[] = [
    { value: 'moving', label: BELT_COPY.moving, line: BELT_COPY.movingLine },
    { value: 'standing', label: BELT_COPY.standing, line: BELT_COPY.standingLine },
];

/**
 * The belt question: whether the belts the inserters pick up from move or stand still, which decides whether clocks get
 * belt slack. Each option's name is its visible label; its one line describes it.
 */
export function BeltAssumption({ answer, onChange }: BeltAssumptionProps) {
    const id = useId();
    const labelId = `${id}-label`;
    const lineId = (value: BeltAnswer) => `${id}-${value}-line`;
    return (
        <FormControl sx={{ display: 'block', minWidth: 0 }}>
            <FormLabel id={labelId} sx={{ color: 'text.primary', '&.Mui-focused': { color: 'text.primary' } }}>
                {BELT_COPY.question}
            </FormLabel>
            <RadioGroup
                row
                aria-labelledby={labelId}
                value={answer}
                onChange={(_, value) => onChange(value as BeltAnswer)}
                sx={{ flexWrap: 'wrap', columnGap: 3, rowGap: 1, alignItems: 'flex-start' }}
            >
                {OPTIONS.map(option => (
                    <Box key={option.value} sx={{ flex: '1 1 260px', maxWidth: '48ch', minWidth: 0 }}>
                        <FormControlLabel
                            value={option.value}
                            control={<Radio slotProps={{ input: { 'aria-describedby': lineId(option.value) } }} />}
                            label={option.label}
                            sx={{ mr: 0 }}
                        />
                        <Typography id={lineId(option.value)} variant="caption" component="p" color="text.secondary" sx={{ pl: 4 }}>
                            {option.line}
                        </Typography>
                    </Box>
                ))}
            </RadioGroup>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {BELT_COPY.help}
            </Typography>
        </FormControl>
    );
}
