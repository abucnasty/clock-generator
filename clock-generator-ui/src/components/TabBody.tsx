import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { tabIds } from '../utils/tabIds';

/** A tab's panel, kept mounted so it keeps its filters and scroll position while another tab is shown */
export function TabBody({ prefix, tab, shown, children }: { prefix: string; tab: string; shown: boolean; children: ReactNode }) {
    const ids = tabIds(prefix, tab);
    return (
        <Box
            role="tabpanel"
            id={ids.panel}
            aria-labelledby={ids.tab}
            hidden={!shown}
            sx={{ display: shown ? 'block' : 'none', pt: 2 }}
        >
            {children}
        </Box>
    );
}
