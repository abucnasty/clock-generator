import { Fragment, type ReactNode } from 'react';
import {
    Box,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Link,
    Typography,
} from '@mui/material';
import { Close } from '@mui/icons-material';

interface ChangelogDialogProps {
    open: boolean;
    onClose: () => void;
}

interface Release {
    version: string;
    date: string;
    sections: { title: string; items: string[] }[];
}

/** Parses the `## [version] - date` / `### Section` / `- item` structure of CHANGELOG.md */
function parseChangelog(markdown: string): Release[] {
    const releases: Release[] = [];
    for (const line of markdown.split('\n')) {
        const release = line.match(/^## \[(.+?)\](?:\s*-\s*(.+))?/);
        if (release) {
            releases.push({ version: release[1], date: release[2] ?? '', sections: [] });
            continue;
        }
        const current = releases[releases.length - 1];
        if (!current) {
            continue;
        }
        const section = line.match(/^### (.+)/);
        if (section) {
            current.sections.push({ title: section[1], items: [] });
            continue;
        }
        const item = line.match(/^- (.+)/);
        if (item) {
            if (current.sections.length === 0) {
                current.sections.push({ title: '', items: [] });
            }
            current.sections[current.sections.length - 1].items.push(item[1]);
        }
    }
    return releases;
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

const releases = parseChangelog(__CHANGELOG__);

export function ChangelogDialog({ open, onClose }: ChangelogDialogProps) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1 }}>Changelog</Box>
                <IconButton aria-label="Close" onClick={onClose} size="small">
                    <Close />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {releases.map((release) => (
                    <Box key={release.version} sx={{ mb: 3 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Typography variant="h6">v{release.version}</Typography>
                            {release.version === __APP_VERSION__ && <Chip label="current" size="small" color="primary" />}
                            <Typography variant="body2" color="text.secondary">{release.date}</Typography>
                        </Box>
                        {release.sections.map((section, index) => (
                            <Box key={`${section.title}-${index}`} sx={{ mb: 1.5 }}>
                                {section.title && <Typography variant="subtitle2" color="primary">{section.title}</Typography>}
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
            </DialogContent>
        </Dialog>
    );
}
