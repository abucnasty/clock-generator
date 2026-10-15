import { Box, Paper, Typography, type SxProps, type Theme } from '@mui/material';
import { useId, type ReactNode } from 'react';
import { SURFACE } from '../theme/tokens';
import { HelpButton } from './HelpButton';

interface PanelProps {
    title: string;
    /** The heading's level: 2 for a card of the page, 3 for a card inside a section, 4 for a card inside that */
    level?: 2 | 3 | 4;
    /** The heading's id is `${id}-title`; one is made up when not given */
    id?: string;
    /** A "?" after the title that opens this */
    help?: { label: string; content: ReactNode };
    /** At the right of the title bar */
    actions?: ReactNode;
    children: ReactNode;
    sx?: SxProps<Theme>;
    /** For whoever needs to find the card: a capture script, a test */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * A card in the game's look: a title bar (a lighter band with the heading, its help and the card's actions), over the
 * dark body. A section of the page, named by its heading.
 */
export function Panel({ title, level = 2, id, help, actions, children, sx, ...data }: PanelProps) {
    const madeUpId = useId();
    const titleId = `${id ?? madeUpId}-title`;
    return (
        <Paper
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
                <Typography id={titleId} component={`h${level}`} variant={level === 2 ? 'h6' : level === 3 ? 'subtitle1' : 'subtitle2'} sx={{ fontWeight: 600 }}>
                    {title}
                </Typography>
                {help && <HelpButton label={help.label}>{help.content}</HelpButton>}
                {actions && <Box sx={{ ml: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>{actions}</Box>}
            </Box>
            <Box sx={{ p: 2 }}>{children}</Box>
        </Paper>
    );
}
