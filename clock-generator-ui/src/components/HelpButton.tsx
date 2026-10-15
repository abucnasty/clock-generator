import { HelpOutline } from '@mui/icons-material';
import { IconButton, Popover } from '@mui/material';
import { useState, type ReactNode } from 'react';

/** How long the popover takes to open or close */
const POPOVER_MS = 200;

interface HelpButtonProps {
    /** What the button is called, and what the popover is called: "About Fixed 4 + 2" */
    label: string;
    children: ReactNode;
}

/**
 * The site's one help control: a grey "?" that opens a short explanation. A button: the keyboard reaches it, Enter or
 * Space opens the popover, Esc closes it and puts the focus back here, and a finger can open it, which a hover tooltip
 * on a bare icon cannot offer. Grey, so that it is not taken for a selection (orange) or a status (blue or green).
 */
export function HelpButton({ label, children }: HelpButtonProps) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const open = anchor !== null;

    return (
        <>
            <IconButton
                size="small"
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={(event) => {
                    // the button can sit in a table row that selects its clock when clicked
                    event.stopPropagation();
                    setAnchor(event.currentTarget);
                }}
                sx={{ width: 30, height: 30, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
            >
                <HelpOutline fontSize="small" />
            </IconButton>
            <Popover
                open={open}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                // a fixed, short grow: a long help (the Terms) would otherwise take most of half a second to go
                transitionDuration={POPOVER_MS}
                // a click in the popover, or on its backdrop, reaches the row through React's tree: it must not select the clock
                onClick={(event) => event.stopPropagation()}
                slotProps={{ paper: { role: 'dialog', 'aria-label': label, sx: { maxWidth: 360, p: 2 } } }}
            >
                {children}
            </Popover>
        </>
    );
}
