import { InfoOutlined } from '@mui/icons-material';
import { IconButton, Popover } from '@mui/material';
import { useState, type ReactNode } from 'react';

interface InfoPopoverButtonProps {
    /** What the button is called, and what the popover is called: "How Fixed 4 + 2 is made" */
    label: string;
    children: ReactNode;
}

/**
 * An (i) that opens a short explanation. A button: the keyboard reaches it, Enter or Space opens the popover, Esc closes
 * it and puts the focus back here, and a finger can open it, which a hover tooltip on a bare icon cannot offer.
 */
export function InfoPopoverButton({ label, children }: InfoPopoverButtonProps) {
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
                    // the button sits in a table row that selects its clock when clicked
                    event.stopPropagation();
                    setAnchor(event.currentTarget);
                }}
            >
                <InfoOutlined fontSize="small" color="action" />
            </IconButton>
            <Popover
                open={open}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                // a click in the popover, or on its backdrop, reaches the row through React's tree: it must not select the clock
                onClick={(event) => event.stopPropagation()}
                slotProps={{ paper: { role: 'dialog', 'aria-label': label, sx: { maxWidth: 360, p: 2 } } }}
            >
                {children}
            </Popover>
        </>
    );
}
