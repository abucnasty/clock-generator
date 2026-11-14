import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { tabIds } from '../utils/tabIds';

/**
 * A tab's panel, kept mounted so it keeps its filters and scroll position while another tab is shown. `focusable`: the page
 * can move the focus to it by script (a link that opens the tab)
 */
export function TabBody({ prefix, tab, shown, focusable = false, children }: { prefix: string; tab: string; shown: boolean; focusable?: boolean; children: ReactNode }) {
    const ids = tabIds(prefix, tab);
    return (
        <Box
            role="tabpanel"
            id={ids.panel}
            aria-labelledby={ids.tab}
            hidden={!shown}
            tabIndex={focusable ? -1 : undefined}
            sx={{ display: shown ? 'block' : 'none', pt: 2 }}
        >
            {children}
        </Box>
    );
}
