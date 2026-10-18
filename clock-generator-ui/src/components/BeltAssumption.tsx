import { Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { BELT_COPY, type BeltAnswer } from '../utils/beltQuestion';
import { HelpButton } from './HelpButton';

interface BeltAssumptionProps {
    answer: BeltAnswer;
    onChange: (answer: BeltAnswer) => void;
}

/** The pickup assumption stays visible; its explanation is available on demand. */
export function BeltAssumption({ answer, onChange }: BeltAssumptionProps) {
    return <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">Input belts</Typography>
        <ToggleButtonGroup exclusive size="small" value={answer} aria-label={BELT_COPY.question}
            onChange={(_, value) => { if (value === 'moving' || value === 'backed_up') onChange(value); }}>
            <ToggleButton value="moving" aria-label={BELT_COPY.moving}>Moving</ToggleButton>
            <ToggleButton value="backed_up" aria-label={BELT_COPY.backedUp}>{BELT_COPY.backedUp}</ToggleButton>
        </ToggleButtonGroup>
        <HelpButton label="About input belt movement">
            <Typography variant="body2" sx={{ mb: 1 }}><strong>{BELT_COPY.moving}:</strong> {BELT_COPY.movingLine}</Typography>
            <Typography variant="body2" sx={{ mb: 1 }}><strong>{BELT_COPY.backedUp}:</strong> {BELT_COPY.backedUpLine}</Typography>
            <Typography variant="body2">{BELT_COPY.help}</Typography>
        </HelpButton>
    </Box>;
}
