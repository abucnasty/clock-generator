import { Star } from '@mui/icons-material';
import { Chip } from '@mui/material';
import { RECOMMENDED_COPY } from '../utils/recommendedClock';

/**
 * "Recommended", on the clock the selection rule picks. Grey with a star: orange marks the selected clock, and a
 * recommended clock that is not the selected one must not look selected too
 */
export function RecommendedChip({ isGenerating, ...data }: { isGenerating: boolean; [dataAttribute: `data-${string}`]: string | undefined }) {
    return (
        <Chip
            size="small"
            variant="outlined"
            icon={<Star />}
            label={isGenerating ? RECOMMENDED_COPY.chipWhileGenerating : RECOMMENDED_COPY.chip}
            sx={{ color: 'text.primary', '& .MuiChip-icon': { color: 'text.primary' } }}
            {...data}
        />
    );
}
