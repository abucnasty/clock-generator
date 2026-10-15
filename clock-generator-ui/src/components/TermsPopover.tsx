import { Close } from '@mui/icons-material';
import { Box, IconButton, Popover, Typography } from '@mui/material';
import { useId } from 'react';
import { POPOVER_MS } from '../theme/tokens';
import { glossaryWithFocus, type GlossaryEntry, type GlossaryId } from '../utils/glossary';

const TERMS_COPY = {
    heading: 'Terms',
    close: 'Close terms',
    related: 'Related terms',
    all: 'All terms',
    provisional: '(provisional)',
    expert: '(expert)',
};

function Entries({ entries }: { entries: GlossaryEntry[] }) {
    return (
        <Box component="dl" sx={{ m: 0 }}>
            {entries.map(entry => (
                <Box key={entry.id} sx={{ mb: 1 }}>
                    <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
                        {entry.term}
                        {entry.provisional && ` ${TERMS_COPY.provisional}`}
                        {entry.expert && ` ${TERMS_COPY.expert}`}
                    </Typography>
                    <Typography component="dd" variant="body2" color="text.secondary" sx={{ m: 0 }}>
                        {entry.definition}
                    </Typography>
                </Box>
            ))}
        </Box>
    );
}

/**
 * The glossary as a list of terms and what they mean: the `focus` terms first under "Related terms", then the others
 * under "All terms". For inside a popover that is named already (a help button's).
 */
export function TermsList({ focus = [] }: { focus?: readonly GlossaryId[] }) {
    const { related, rest } = glossaryWithFocus(focus);
    if (related.length === 0) {
        return <Entries entries={rest} />;
    }
    return (
        <>
            <Typography component="h3" variant="subtitle2" sx={{ mb: 0.5 }}>{TERMS_COPY.related}</Typography>
            <Entries entries={related} />
            <Typography component="h3" variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>{TERMS_COPY.all}</Typography>
            <Entries entries={rest} />
        </>
    );
}

interface TermsPopoverProps {
    /** What it opens by; null while closed */
    anchorEl: HTMLElement | null;
    onClose: () => void;
}

/**
 * Every term of the UI and what it means (⋮ > Terms). A dialog: the focus moves in, Esc closes it, and the focus goes
 * back to the button it opened by.
 */
export function TermsPopover({ anchorEl, onClose }: TermsPopoverProps) {
    const headingId = useId();
    return (
        <Popover
            open={anchorEl !== null}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            transitionDuration={POPOVER_MS}
            slotProps={{
                paper: {
                    role: 'dialog',
                    'aria-labelledby': headingId,
                    sx: { width: 480, maxWidth: 'calc(100vw - 32px)', p: 2, pt: 0 },
                },
            }}
        >
            {/* the heading and its Close stay in view while the list scrolls; a finger has no Esc */}
            <Box sx={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pt: 2, pb: 1, bgcolor: 'background.paper' }}>
                <Typography id={headingId} component="h2" variant="h6">{TERMS_COPY.heading}</Typography>
                <IconButton size="small" aria-label={TERMS_COPY.close} onClick={onClose}>
                    <Close fontSize="small" />
                </IconButton>
            </Box>
            <TermsList />
        </Popover>
    );
}
