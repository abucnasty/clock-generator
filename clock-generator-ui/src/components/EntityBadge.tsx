import { Box } from '@mui/material';
import type { ReactNode } from 'react';

/** Entity identity, sized to match the small form controls. */
export function EntityBadge({ id, children }: { id: number; children: ReactNode }) {
    return <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 40, boxSizing: 'border-box', border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'action.hover',
        backgroundImage: 'conic-gradient(from 90deg, transparent 25%, rgba(127,127,127,0.16) 0 50%, transparent 0 75%, rgba(127,127,127,0.16) 0)', backgroundSize: '20px 20px', boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.2)' }}>
        {children}
        <Box component="span" sx={{ position: 'absolute', right: 3, bottom: 1, fontWeight: 700 }}>{id}</Box>
    </Box>;
}
