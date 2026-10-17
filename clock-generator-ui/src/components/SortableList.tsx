import { useMemo, useState } from 'react';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragIndicator } from '@mui/icons-material';
import { Box, Chip } from '@mui/material';
import type { Announcements } from '@dnd-kit/core';

const SILENT: Announcements = {
    onDragStart: () => undefined, onDragOver: () => undefined, onDragEnd: () => undefined, onDragCancel: () => undefined,
};

interface SortableListProps {
    /** Stable UUID keys for each item, in current order. */
    itemKeys: string[];
    /** Called with the old and new array indices after a drag. */
    onReorder: (fromIndex: number, toIndex: number) => void;
    children: React.ReactNode;
}

/** Wraps a list of SortableItem children with @dnd-kit context. */
export function SortableList({ itemKeys, onReorder, children }: SortableListProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
    );

    // Local ordered copy — updated synchronously on drag end so dnd-kit can
    // complete its drop animation before the parent re-renders with reassigned IDs.
    const [localItemKeys, setLocalItemKeys] = useState(itemKeys);
    const [prevItemKeys, setPrevItemKeys] = useState(itemKeys);

    // Moves and Undo also change the order from outside. Never commit stale sortable positions.
    if (itemKeys !== prevItemKeys) {
        setPrevItemKeys(itemKeys);
        if (itemKeys.length !== localItemKeys.length || itemKeys.some((key, i) => key !== localItemKeys[i])) setLocalItemKeys(itemKeys);
    }

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const fromIndex = localItemKeys.indexOf(active.id as string);
        const toIndex = localItemKeys.indexOf(over.id as string);
        if (fromIndex !== -1 && toIndex !== -1) {
            setLocalItemKeys(arrayMove(localItemKeys, fromIndex, toIndex));
            onReorder(fromIndex, toIndex);
        }
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{ announcements: SILENT, restoreFocus: false }}
        >
            <SortableContext items={localItemKeys} strategy={verticalListSortingStrategy}>
                {children}
            </SortableContext>
        </DndContext>
    );
}

interface SortableItemProps {
    /** Stable UUID — used as the dnd-kit sortable ID. */
    stableKey: string;
    /** The entity's name shown in the row's chip, e.g. "Inserter 3". */
    label: string;
    displayLabel?: React.ReactNode;
    /** Render prop: receives the composed drag-handle+ID element to place inside the row. */
    children: (dragHandle: React.ReactNode) => React.ReactNode;
}

/** Wraps a single row with sortable drag behaviour and injects a drag handle. */
export function SortableItem({ stableKey, label, displayLabel, children }: SortableItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: stableKey });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: 'relative',
        zIndex: isDragging ? 1 : undefined,
    };

    const dragHandle = useMemo(() => (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                flexShrink: 0,
            }}
        >
            <Box
                {...attributes}
                {...listeners}
                tabIndex={-1}
                aria-hidden="true"
                data-row-drag=""
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // a target of at least 24px, so a finger or a pointer can find it (WCAG 2.5.8)
                    width: 28,
                    height: 28,
                    color: 'text.secondary',
                    cursor: 'grab',
                    touchAction: 'none',
                    '&:active': { cursor: 'grabbing' },
                    '&:hover': { color: 'text.primary' },
                }}
            >
                <DragIndicator fontSize="small" />
            </Box>
            {/* at least as wide as "Inserter 99", so the rows of a card line up */}
            <Chip
                label={displayLabel ?? label}
                aria-label={label}
                title={label}
                size="small"
                sx={{ minWidth: displayLabel ? 52 : 72, height: displayLabel ? 40 : undefined, bgcolor: displayLabel ? 'transparent' : undefined, '& .MuiChip-label': displayLabel ? { px: 0 } : undefined, fontSize: '0.7rem', pointerEvents: 'none' }}
            />
        </Box>
    ), [attributes, listeners, label, displayLabel]);
    // Sortable context updates positions for the whole list; unchanged row contents can stay as they are.
    const content = useMemo(() => children(dragHandle), [children, dragHandle]);

    return (
        <div ref={setNodeRef} style={style} data-row-key={stableKey}>
            {content}
        </div>
    );
}
