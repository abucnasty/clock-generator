import { Box } from '@mui/material';
import type { ReactNode } from 'react';

/** Entity identity, sized to match the small form controls. */
export function EntityBadge({ id, children, size = 'medium' }: { id: number; children: ReactNode; size?: 'small' | 'medium' }) {
    const small = size === 'small';
    return <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: small ? 36 : 52, height: small ? 28 : 40, boxSizing: 'border-box', border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'action.hover',
        backgroundImage: 'conic-gradient(from 90deg, transparent 25%, rgba(127,127,127,0.16) 0 50%, transparent 0 75%, rgba(127,127,127,0.16) 0)', backgroundSize: small ? '14px 14px' : '20px 20px', boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.2)' }}>
        {children}
        <Box component="span" sx={{ position: 'absolute', right: 3, bottom: 1, fontWeight: 700, ...(small && { fontSize: 11, lineHeight: 1, color: '#fff', textShadow: '0 1px 2px #000, 1px 0 1px #000, -1px 0 1px #000' }) }}>{id}</Box>
    </Box>;
}
