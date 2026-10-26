import { Tune } from '@mui/icons-material';
import { Box, IconButton, Portal, Tab, Tabs, Tooltip } from '@mui/material';
import { useEffect, useId, useState, type ReactNode } from 'react';

export function EntitySettings({ label, summary, children, actionContainerId, first = false, tabs = [], request }: {
    label: string;
    actionContainerId: string;
    summary: ReactNode | ((openTab: (label: string) => void) => ReactNode);
    children: ReactNode;
    first?: boolean;
    tabs?: { label: string; content: ReactNode }[];
    /** A new request reveals a tab before an external navigation moves focus into its fields. */
    request?: { tab: string };
}) {
    const panels = [{ label: 'General', content: children }, ...tabs];
    const requestedIndex = Math.max(0, panels.findIndex(panel => panel.label === request?.tab));
    const [open, setOpen] = useState(!!request);
    const [opened, setOpened] = useState(!!request);
    const [active, setActive] = useState(request ? requestedIndex : 0);
    const [visited, setVisited] = useState<Set<number>>(() => new Set([0, ...(request ? [requestedIndex] : [])]));
    const [lastRequest, setLastRequest] = useState(request);
    const [focusRevision, setFocusRevision] = useState(0);
    const id = useId();
    const openTab = (label: string) => {
        const index = panels.findIndex(panel => panel.label === label);
        if (index < 0) return;
        setOpened(true);
        setOpen(true);
        setActive(index);
        setVisited(previous => new Set([...previous, index]));
        setFocusRevision(previous => previous + 1);
    };
    useEffect(() => {
        if (!focusRevision) return;
        const tab = document.getElementById(`${id}-tab-${active}`);
        tab?.focus({ preventScroll: true });
        tab?.scrollIntoView({ block: 'center' });
    }, [focusRevision, id, active]);
    if (lastRequest !== request) {
        setLastRequest(request);
        if (request) {
            setOpened(true);
            setOpen(true);
            setActive(requestedIndex);
            setVisited(previous => new Set([...previous, requestedIndex]));
        }
    }
    return <Box sx={{ minWidth: 0, gridColumn: '1 / -1' }}>
        <Box sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{typeof summary === 'function' ? summary(openTab) : summary}</Box>
        <Portal container={() => document.getElementById(actionContainerId)}>
            <Tooltip title={open ? 'Close entity details' : 'Entity details'}>
                <IconButton aria-label={`Entity details for ${label}`} aria-expanded={open} aria-controls={`${id}-settings`}
                    data-row-first={first ? '' : undefined} onClick={() => { setOpened(true); setOpen(!open); }}
                    sx={{ color: 'text.secondary', bgcolor: open ? 'action.selected' : undefined }}>
                    <Tune />
                </IconButton>
            </Tooltip>
        </Portal>
        <Box id={`${id}-settings`} hidden={!open} sx={{ mt: 1.5, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
            {/* a single panel needs no tab bar */}
            {opened && panels.length === 1 && <Box role="region" aria-label={`${label} entity details`} sx={{ p: 2, minWidth: 0 }}>{children}</Box>}
            {opened && panels.length > 1 && <>
                <Tabs value={active} onChange={(_, next: number) => { setActive(next); setVisited(previous => new Set([...previous, next])); }}
                    aria-label={`${label} entity details`} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
                    {panels.map((panel, index) => <Tab key={panel.label} label={panel.label} id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} sx={{ minHeight: 40, '&.Mui-selected': { color: 'text.primary' } }} />)}
                </Tabs>
                {panels.map((panel, index) => <Box key={panel.label} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={active !== index} sx={{ p: 2, minWidth: 0 }}>
                    {visited.has(index) && panel.content}
                </Box>)}
            </>}
        </Box>
    </Box>;
}
