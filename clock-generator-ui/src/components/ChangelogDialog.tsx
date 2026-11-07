import { Fragment, type ReactNode } from 'react';
import { Box, Chip, Link, Typography } from '@mui/material';
import { AppDialog } from './AppDialog';
import { parseChangelog, releasesWithEntries } from '../utils/changelog';

interface ChangelogDialogProps {
    open: boolean;
    onClose: () => void;
}

/** Renders `code` and [links](https://...) */
function renderInline(text: string): ReactNode[] {
    return text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
        const code = part.match(/^`([^`]+)`$/);
        if (code) {
            return <Box key={index} component="code" sx={{ px: 0.5, bgcolor: 'action.hover', fontSize: '0.85em' }}>{code[1]}</Box>;
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link && /^https?:\/\//.test(link[2])) {
            return <Link key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{renderInline(link[1])}</Link>;
        }
        return <Fragment key={index}>{part}</Fragment>;
    });
}

const releases = releasesWithEntries(parseChangelog(__CHANGELOG__));

export function ChangelogDialog({ open, onClose }: ChangelogDialogProps) {
    return (
        <AppDialog open={open} onClose={onClose} maxWidth="md" scroll="paper" dividers closeButton title="Changelog">
            {releases.map((release) => (
                <Box key={release.version} sx={{ mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="h6" component="h3">v{release.version}</Typography>
                        {release.version === __APP_VERSION__ && <Chip label="current" size="small" variant="outlined" />}
                        <Typography variant="body2" color="text.secondary">{release.date}</Typography>
                    </Box>
                    {release.sections.map((section, index) => (
                        <Box key={`${section.title}-${index}`} sx={{ mb: 1.5 }}>
                            {section.title && <Typography variant="subtitle2">{section.title}</Typography>}
                            <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 3 }}>
                                {section.items.map((item, itemIndex) => (
                                    <Typography key={itemIndex} component="li" variant="body2" sx={{ mb: 0.5 }}>
                                        {renderInline(item)}
                                    </Typography>
                                ))}
                            </Box>
                        </Box>
                    ))}
                </Box>
            ))}
        </AppDialog>
    );
}
