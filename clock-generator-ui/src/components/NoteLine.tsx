import { InfoOutlined, WarningAmber } from '@mui/icons-material';
import { Box, Button, ButtonBase, Tooltip, Typography, type DialogProps } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { entityLabel, type LabelKind } from '../utils/entityLabel';
import { AppDialog } from './AppDialog';
import { EntityBadge } from './EntityBadge';
import { FactorioIcon } from './FactorioIcon';
import { WithQuality } from './QualityBadge';

/** What the mark before a line looks like: a caution mark, or an information mark for `info` */
type NoteMark ='warning' | 'info' | 'error';

/**
 * A note as one line: its mark, what it is, the entities it is about as chips, and Details, which opens a window with the
 * rest. The Build check's advisories and the notes on the selected clock are each one of these.
 */
export function NoteLine({ mark, markLabel, title, chips, details, maxWidth = 'sm', children }: {
    mark: NoteMark;
    /** What the mark says to a screen reader */
    markLabel: string;
    title: string;
    /** The entities the note is about, after its title */
    chips?: ReactNode;
    /** The label of the button that opens the window */
    details: string;
    maxWidth?: DialogProps['maxWidth'];
    /** The window's content: the rest of the note */
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const Mark = mark === 'info' ? InfoOutlined : WarningAmber;
    return <Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 1 }}>
            <Mark sx={{ color: `${mark}.main` }} titleAccess={markLabel} />
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{title}</Typography>
            {chips}
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" color="inherit" variant="outlined" onClick={() => setOpen(true)}>{details}</Button>
        </Box>
        <AppDialog open={open} onClose={() => setOpen(false)} title={title} closeButton maxWidth={maxWidth}>
            {children}
        </AppDialog>
    </Box>;
}

/** The entities of a line as the rows show them: icon and number; each a button to its row where there is a step to it */
export function NoteChips({ label, kind, ids, icon, onClick }: {
    label: string; kind: LabelKind; ids: readonly number[]; icon: (id: number) => ReactNode; onClick?: (id: number) => void;
}) {
    return <Box component="ul" aria-label={label} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, m: 0, p: 0, listStyle: 'none' }}>
        {ids.map(id => {
            const name = entityLabel(kind, id);
            const badge = <EntityBadge id={id} size="small"><Box component="span" aria-hidden sx={{ display: 'inline-flex' }}>{icon(id)}</Box></EntityBadge>;
            return <Box component="li" key={id} sx={{ display: 'flex' }}>
                {onClick
                    ? <Tooltip title={name}>
                        <ButtonBase aria-label={`Review ${name.toLowerCase()}`} onClick={() => onClick(id)}
                            sx={{ borderRadius: 0.5, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 } }}>{badge}</ButtonBase>
                    </Tooltip>
                    : <Box component="span" title={name}>{badge}</Box>}
            </Box>;
        })}
    </Box>;
}

/** The words of a window, each part with its label: why, what it can cost, what to do; or what, why and the explanation */
export function NoteFacts({ rows }: { rows: [string, string][] }) {
    return <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '9.5rem 1fr' }, columnGap: 2, rowGap: { xs: 0.25, sm: 1 } }}>
        {rows.map(([label, text]) => <Box key={label} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="overline" color="text.secondary" sx={{ lineHeight: 1.6, mt: { xs: 1, sm: 0 } }}>{label}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>{text}</Typography>
        </Box>)}
    </Box>;
}

/** An inserter's icon with its quality, as its row shows it; a legendary stack inserter where the row is not known */
export function InserterChipIcon({ value }: { value: { prototype?: string; quality?: string } | undefined }) {
    return <WithQuality quality={value?.quality ?? 'legendary'} size={20}>
        <FactorioIcon name={value?.prototype ?? 'stack-inserter'} size={20} alt="" />
    </WithQuality>;
}
