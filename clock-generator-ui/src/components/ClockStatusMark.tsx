import { Cancel, CheckCircle, Warning } from '@mui/icons-material';
import type { ClockStatus } from '../utils/clockSummary';

/**
 * The mark beside the words of a clock's status, or in their place where the words are read out: never the colour
 * alone. Error has the red of a failed check.
 */
export function ClockStatusMark({ kind }: { kind: ClockStatus['kind'] }) {
    switch (kind) {
        case 'stable':
            return <CheckCircle fontSize="small" aria-hidden sx={{ color: 'secondary.light' }} data-status-mark={kind} />;
        case 'start-dependent':
        case 'no-recovery':
            return <Warning fontSize="small" aria-hidden sx={{ color: 'warning.main' }} data-status-mark={kind} />;
        default:
            return <Cancel fontSize="small" aria-hidden sx={{ color: 'error.light' }} data-status-mark={kind} />;
    }
}
