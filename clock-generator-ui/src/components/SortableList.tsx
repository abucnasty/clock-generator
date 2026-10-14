import { useState } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    arrayMove,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragIndicator } from '@mui/icons-material';
import { Box, Chip } from '@mui/material';

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
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    // Local ordered copy — updated synchronously on drag end so dnd-kit can
    // complete its drop animation before the parent re-renders with reassigned IDs.
    const [localItemKeys, setLocalItemKeys] = useState(itemKeys);
    const [prevItemKeys, setPrevItemKeys] = useState(itemKeys);

    // Sync when items are added or removed (the UUID set changes), while rendering
    // rather than in an effect, so the stale order is never committed.
    // After a plain reorder the parent's UUID set is identical to our local
    // set (stable keys move with their entities), so no spurious sync occurs.
    if (itemKeys !== prevItemKeys) {
        setPrevItemKeys(itemKeys);
        const localSet = new Set(localItemKeys);
        const same = localItemKeys.length === itemKeys.length && itemKeys.every((k) => localSet.has(k));
        if (!same) setLocalItemKeys(itemKeys);
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
    /** Render prop: receives the composed drag-handle+ID element to place inside the row. */
    children: (dragHandle: React.ReactNode) => React.ReactNode;
}

/** Wraps a single row with sortable drag behaviour and injects a drag handle. */
export function SortableItem({ stableKey, label, children }: SortableItemProps) {
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

    const dragHandle = (
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
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    color: 'text.disabled',
                    cursor: 'grab',
                    touchAction: 'none',
                    '&:active': { cursor: 'grabbing' },
                    '&:hover': { color: 'text.secondary' },
                }}
            >
                <DragIndicator fontSize="small" />
            </Box>
            <Chip
                label={label}
                size="small"
                sx={{ fontSize: '0.7rem', height: 22, pointerEvents: 'none' }}
            />
        </Box>
    );

    return (
        <div ref={setNodeRef} style={style}>
            {children(dragHandle)}
        </div>
    );
}
