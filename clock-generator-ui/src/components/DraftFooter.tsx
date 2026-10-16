import { Box, Button, Typography } from '@mui/material';
import { useEffect, useRef, type ReactNode } from 'react';

/** Every Diagram draft shares this measured commit bar, keeping keyboard focus above it. */
export function DraftFooter({ dirty, onCancel, onSave, children }: { dirty: boolean; onCancel: () => void; onSave: () => void; children?: ReactNode }) {
    const barRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const bar = barRef.current;
        const scroller = bar?.closest<HTMLElement>('.MuiDialogContent-root');
        if (!bar || !scroller) return;
        const observer = new ResizeObserver(() => {
            scroller.style.scrollPaddingBottom = `${bar.getBoundingClientRect().height + 8}px`;
        });
        observer.observe(bar);
        return () => { observer.disconnect(); scroller.style.removeProperty('scroll-padding-bottom'); };
    }, []);
    return (
        <Box ref={barRef} sx={{ position: 'sticky', bottom: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1, px: 2, py: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
            {dirty && <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>Unsaved changes</Typography>}
            {children}
            <Button onClick={onCancel} color="inherit">Cancel</Button>
            <Button onClick={onSave} variant="contained" color="secondary" disabled={!dirty}>Save</Button>
        </Box>
    );
}
