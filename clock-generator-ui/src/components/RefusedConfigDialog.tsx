import { Button } from '@mui/material';
import type { ConfigFormatProblem } from 'clock-generator/light';
import { AppDialog } from './AppDialog';

/** Why an opened file, a paste or a share link is not read: its format, or it is an export of the Sidecar mod */
export type RefusedKind = ConfigFormatProblem | 'sidecar';

const MESSAGES: Record<RefusedKind, { title: string; lines: string[] }> = {
    old: {
        title: 'This configuration is no longer supported',
        lines: [
            'It was made by a version of the clock generator before 0.33.0. The clock generator is in beta, and 0.33.0 changed the configuration.',
            'To make it again: copy your build as a blueprint in Factorio and paste it here.',
        ],
    },
    sidecar: {
        title: 'Sidecar exports are no longer supported',
        lines: [
            'The Clock Generator Sidecar mod is deprecated, and this site no longer reads its exports. You do not need the mod.',
            'Copy your build as a blueprint in Factorio and paste it here.',
        ],
    },
    newer: {
        title: 'This configuration was made by a newer version of the site',
        lines: ['Reload the page, then open it again. Or copy your build as a blueprint in Factorio and paste it here.'],
    },
};

interface RefusedConfigDialogProps {
    /** Null closes it */
    kind: RefusedKind | null;
    /** Paste a blueprint: the page's paste, which reads the clipboard first */
    onPaste: () => void;
    onClose: () => void;
}

/** What the page says in place of a configuration it does not read, with the way on: paste a blueprint */
export function RefusedConfigDialog({ kind, onPaste, onClose }: RefusedConfigDialogProps) {
    const message = MESSAGES[kind ?? 'old'];
    return (
        <AppDialog
            open={kind !== null}
            onClose={onClose}
            title={message.title}
            description={message.lines.join(' ')}
            cancel="Close"
            actions={<Button variant="contained" onClick={() => { onClose(); onPaste(); }}>Paste a blueprint</Button>}
        />
    );
}
