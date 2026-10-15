import { Close, HelpOutline } from '@mui/icons-material';
import { Box, Button, IconButton, Popover, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { POPOVER_MS, SURFACE } from '../theme/tokens';

/** The name of the button that closes the popover */
const HELP_CLOSE = 'Close';

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
                transitionDuration={POPOVER_MS}
                // a click in the popover, or on its backdrop, reaches the row through React's tree: it must not select the clock
                onClick={(event) => event.stopPropagation()}
                slotProps={{ paper: { role: 'dialog', 'aria-label': label, sx: { maxWidth: 360, p: 2, pr: 5 } } }}
            >
                {/* stays in the corner while a long help (the Terms) scrolls; a finger has no Esc */}
                <Box sx={{ position: 'sticky', top: 0, height: 0, display: 'flex', justifyContent: 'flex-end', zIndex: 1 }}>
                    <IconButton
                        size="small"
                        aria-label={HELP_CLOSE}
                        onClick={() => setAnchor(null)}
                        sx={{ mt: -1, mr: -4.5, bgcolor: 'background.paper' }}
                    >
                        <Close fontSize="small" />
                    </IconButton>
                </Box>
                {children}
            </Popover>
        </>
    );
}

/**
 * A console command in a help popover, in a code box with its Copy button. The popover's content goes when it closes,
 * so "Copied" is back to "Copy" the next time it opens.
 */
export function HelpCommand({ command }: { command: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: SURFACE.inset, p: 1 }}>
            <Typography component="code" sx={{ flex: 1, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {command}
            </Typography>
            <Button
                size="small"
                variant="outlined"
                color="inherit"
                onClick={async () => {
                    await navigator.clipboard.writeText(command);
                    setCopied(true);
                }}
            >
                {copied ? 'Copied!' : 'Copy'}
            </Button>
        </Box>
    );
}
