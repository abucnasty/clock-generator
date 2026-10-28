import { Delete } from '@mui/icons-material';
import { Box, IconButton, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import { themeTokens } from '../theme/runtimeTokens';
import { settingsSlotId, type LabelKind } from '../utils/entityLabel';
import { EntityBadge } from './EntityBadge';
import { RowActionsMenu } from './RowActionsMenu';
import { SortableItem } from './SortableList';

interface EntityRowProps {
    kind: LabelKind;
    row: { id: number; _uuid: string };
    /** The row's name, "Belt 2" */
    label: string;
    /** The picture in the row's chip, over its id; `chip` replaces the whole chip (a machine's opens a picker) */
    icon?: ReactNode;
    chip?: ReactNode;
    /** What the chip's picture stands for, on hover */
    chipTitle?: string;
    sx?: SxProps<Theme>;
    /** The row, given its drag handle: an `EntityRowTop` and what goes under it */
    children: (dragHandle: ReactNode) => ReactNode;
    /** For whoever needs to find the row: a test, the selection of Bulk edit */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * One entity of a build's section: a card that can be dragged to reorder, named for a screen reader, and found by
 * `#entity-<kind>-<id>`. Its width is a container, so that its fields can go under its name on a narrow screen.
 */
export function EntityRow({ kind, row, label, icon, chip, chipTitle, sx, children, ...data }: EntityRowProps) {
    return <SortableItem stableKey={row._uuid} label={label} displayTitle={chipTitle}
        displayLabel={chip ?? (icon && <EntityBadge id={row.id}>{icon}</EntityBadge>)}>
        {dragHandle => <Box id={`entity-${kind}-${row.id}`} role="group" aria-label={label} {...data} sx={[{
            mb: 1,
            p: 1.5,
            minWidth: 0,
            // the top line, then what goes under it, evenly apart
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            rowGap: 1.5,
            containerType: 'inline-size',
            containerName: `${kind}-row`,
            bgcolor: (theme: Theme) => themeTokens(theme).surface.row,
        }, ...(Array.isArray(sx) ? sx : [sx])]}>
            {children(dragHandle)}
        </Box>}
    </SortableItem>;
}

/**
 * A row's top line: its drag handle and chip, its main fields, its actions. Narrower than `stackBelow` pixels, the
 * fields go on a line of their own under the other two; without it they stay in line.
 */
export function EntityRowTop({ dragHandle, actions, stackBelow, children }: {
    dragHandle: ReactNode; actions: ReactNode; stackBelow?: number; children: ReactNode;
}) {
    const stacked = stackBelow === undefined ? {} : { [`@container (max-width: ${stackBelow}px)`]: { gridColumn: '1 / -1', gridRow: 2 } };
    return <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gap: 1.5,
        alignItems: 'center',
        ...(stackBelow !== undefined && { [`@container (max-width: ${stackBelow}px)`]: { gridTemplateColumns: 'minmax(0, 1fr) auto' } }),
    }}>
        <Box sx={{ gridColumn: 1, gridRow: 1 }}>{dragHandle}</Box>
        <Box sx={{ minWidth: 0, gridColumn: 2, gridRow: 1, ...stacked }}>{children}</Box>
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, gridColumn: 3, gridRow: 1,
            ...(stackBelow !== undefined && { [`@container (max-width: ${stackBelow}px)`]: { gridColumn: 2 } }) }}>
            {actions}
        </Box>
    </Box>;
}

/**
 * A row's actions: its Entity details button (when it has details), the menu with Duplicate and the moves, and
 * Delete, which a section's focus handling finds by `data-row-delete`.
 */
export function EntityRowActions({ kind, id, label, details = true, index, count, onReorder, onDuplicate, onDelete, canDelete = true }: {
    kind: LabelKind; id: number; label: string;
    /** Whether the row has an Entity details button */
    details?: boolean;
    index: number; count: number;
    /** Without it, the menu has no moves: the row has buttons of its own for them */
    onReorder?: (from: number, to: number) => void;
    onDuplicate: (index: number) => void;
    onDelete: (index: number) => void;
    canDelete?: boolean;
}) {
    return <>
        {details && <Box id={settingsSlotId(kind, id)} sx={{ display: 'flex' }} />}
        <RowActionsMenu label={label} onDuplicate={() => onDuplicate(index)} showReorder={onReorder !== undefined}
            onMoveUp={onReorder && index > 0 ? () => onReorder(index, index - 1) : undefined}
            onMoveDown={onReorder && index < count - 1 ? () => onReorder(index, index + 1) : undefined} />
        <IconButton onClick={() => onDelete(index)} color="error" disabled={!canDelete} aria-label={`Delete ${label}`} data-row-delete="">
            <Delete />
        </IconButton>
    </>;
}
