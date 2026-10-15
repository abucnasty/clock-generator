import { Box, Paper, Typography, type SxProps, type Theme } from '@mui/material';
import { useId, type ReactNode, type Ref } from 'react';
import { CONTROL, SURFACE } from '../theme/tokens';
import { HelpButton } from './HelpButton';

interface PanelProps {
    title: string;
    /** The heading's level: 2 for a card of the page, 3 for a card inside a section, 4 for a card inside that */
    level?: 2 | 3 | 4;
    /** The heading's id is `${id}-title`; one is made up when not given */
    id?: string;
    /**
     * For a heading the page moves the focus to (as to Target Output when the intro card goes): its id instead, and
     * focusable by script only
     */
    focusableTitleId?: string;
    /** A "?" after the title that opens this */
    help?: { label: string; content: ReactNode };
    /** At the right of the title bar */
    actions?: ReactNode;
    children: ReactNode;
    sx?: SxProps<Theme>;
    ref?: Ref<HTMLElement>;
    /** For whoever needs to find the card: a capture script, a test */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * A card in the game's look: a title bar (a lighter band with the heading, its help and the card's actions), over the
 * dark body. A section of the page, named by its heading.
 */
export function Panel({ title, level = 2, id, focusableTitleId, help, actions, children, sx, ref, ...data }: PanelProps) {
    const madeUpId = useId();
    const titleId = focusableTitleId ?? `${id ?? madeUpId}-title`;
    return (
        <Paper
            ref={ref as Ref<HTMLDivElement> | undefined}
            variant="outlined"
            component="section"
            aria-labelledby={titleId}
            sx={[{ mb: 2 }, ...(Array.isArray(sx) ? sx : [sx])]}
            {...data}
        >
            <Box
                component="header"
                sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: 1,
                    minHeight: 40,
                    px: 2,
                    py: 0.5,
                    bgcolor: SURFACE.titleBar,
                    borderBottom: `1px solid ${SURFACE.inset}`,
                }}
            >
                {/* the level is set: the theme makes a subtitle a paragraph */}
                <Typography
                    id={titleId}
                    tabIndex={focusableTitleId ? -1 : undefined}
                    component={`h${level}`}
                    variant={level === 2 ? 'h6' : level === 3 ? 'subtitle1' : 'subtitle2'}
                    sx={{ fontWeight: 600 }}
                >
                    {title}
                </Typography>
                {help && <HelpButton label={help.label}>{help.content}</HelpButton>}
                {actions && <Box sx={{ ml: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>{actions}</Box>}
            </Box>
            <Box sx={{ p: 2 }}>{children}</Box>
        </Paper>
    );
}

interface PanelSectionProps {
    title: string;
    /** 3 for a section of a card, 4 for a part of a section */
    level: 3 | 4;
    /** A "?" after the title that opens this */
    help?: { label: string; content: ReactNode };
    /** At the right of the heading */
    actions?: ReactNode;
    children?: ReactNode;
    sx?: SxProps<Theme>;
    ref?: Ref<HTMLElement>;
    /** For whoever needs to find the section: a capture script, a test */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * A section inside a card: a bold heading, then the help and the section's actions, then its rows. A section (h3) has a
 * rule under its heading; a part of one (h4) is smaller, grey and has none, so the two read apart and their rules do not
 * stack. No band of its own, so the card's title bar stays the one band. A section of the page, named by its heading.
 */
export function PanelSection({ title, level, help, actions, children, sx, ref, ...data }: PanelSectionProps) {
    const titleId = `${useId()}-title`;
    const part = level === 4;
    return (
        <Box
            ref={ref}
            component="section"
            aria-labelledby={titleId}
            sx={[{ mb: part ? 2 : 3, '&:last-child': { mb: 0 } }, ...(Array.isArray(sx) ? sx : [sx])]}
            {...data}
        >
            <Box
                sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: 1,
                    minHeight: part ? 32 : 40,
                    mb: part ? 1 : 1.5,
                    borderBottom: part ? 'none' : `1px solid ${CONTROL.edge}`,
                }}
            >
                {/* the level is set: the theme makes a subtitle a paragraph */}
                <Typography
                    id={titleId}
                    component={`h${level}`}
                    variant={part ? 'subtitle2' : 'subtitle1'}
                    sx={part ? { fontWeight: 600, color: 'text.secondary' } : { fontWeight: 700, fontSize: '1.0625rem' }}
                >
                    {title}
                </Typography>
                {help && <HelpButton label={help.label}>{help.content}</HelpButton>}
                {actions && <Box sx={{ ml: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>{actions}</Box>}
            </Box>
            {children}
        </Box>
    );
}
