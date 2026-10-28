import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode, SyntheticEvent } from 'react';

interface DisclosureProps {
    /** What the folded part is, always shown: "Fuel events" */
    summary: ReactNode;
    children: ReactNode;
    /** Controlled: the caller keeps it open across renders */
    open?: boolean;
    onToggle?: (open: boolean) => void;
    sx?: SxProps<Theme>;
    /** For whoever needs to find it: a capture script, a test */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/** Detail that most readers skip: a line that unfolds what is under it, the browser's own details and summary */
export function Disclosure({ summary, children, open, onToggle, sx, ...data }: DisclosureProps) {
    return <Box component="details" open={open} {...data} sx={sx}
        onToggle={onToggle && ((event: SyntheticEvent<HTMLDetailsElement>) => {
            const next = event.currentTarget.open;
            if (next !== open) onToggle(next);
        })}>
        <Typography component="summary" variant="body2" sx={{ cursor: 'pointer', py: 0.5 }}>{summary}</Typography>
        {children}
    </Box>;
}
