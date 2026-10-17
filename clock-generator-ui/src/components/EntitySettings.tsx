import { Tune } from '@mui/icons-material';
import { Box, IconButton, Portal, Tab, Tabs, Tooltip } from '@mui/material';
import { useId, useState, type ReactNode } from 'react';

export function EntitySettings({ label, summary, children, actionContainerId, first = false, tabs = [] }: {
    label: string;
    actionContainerId: string;
    summary: ReactNode;
    children: ReactNode;
    first?: boolean;
    tabs?: { label: string; content: ReactNode }[];
}) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
    const id = useId();
    const panels = [{ label: 'General', content: children }, ...tabs];
    return <Box sx={{ minWidth: 0, gridColumn: '1 / -1' }}>
        <Box sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{summary}</Box>
        <Portal container={() => document.getElementById(actionContainerId)}>
            <Tooltip title={open ? 'Close settings' : 'Edit settings'}>
                <IconButton aria-label={`Edit settings for ${label}`} aria-expanded={open} aria-controls={`${id}-settings`}
                    data-row-first={first ? '' : undefined} onClick={() => setOpen(!open)}
                    sx={{ color: 'text.secondary', bgcolor: open ? 'action.selected' : undefined }}>
                    <Tune />
                </IconButton>
            </Tooltip>
        </Portal>
        <Box id={`${id}-settings`} hidden={!open} sx={{ mt: 1.5, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
            <Tabs value={active} onChange={(_, next: number) => { setActive(next); setVisited(previous => new Set([...previous, next])); }}
                aria-label={`${label} settings`} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
                {panels.map((panel, index) => <Tab key={panel.label} label={panel.label} id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} sx={{ minHeight: 40 }} />)}
            </Tabs>
            {panels.map((panel, index) => <Box key={panel.label} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={active !== index} sx={{ p: 2, minWidth: 0 }}>
                {visited.has(index) && panel.content}
            </Box>)}
        </Box>
    </Box>;
}
