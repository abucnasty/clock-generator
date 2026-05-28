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
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragIndicator } from '@mui/icons-material';
import { Box, Chip } from '@mui/material';

interface SortableListProps {
    /** Current entity IDs in display order — used as sortable item keys. */
    itemIds: number[];
    /** Called with the old and new array indices after a drag. */
    onReorder: (fromIndex: number, toIndex: number) => void;
    children: React.ReactNode;
}

/** Wraps a list of SortableItem children with @dnd-kit context. */
export function SortableList({ itemIds, onReorder, children }: SortableListProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const fromIndex = itemIds.indexOf(active.id as number);
        const toIndex = itemIds.indexOf(over.id as number);
        if (fromIndex !== -1 && toIndex !== -1) {
            onReorder(fromIndex, toIndex);
        }
    }

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                {children}
            </SortableContext>
        </DndContext>
    );
}

interface SortableItemProps {
    /** The entity's current numeric ID — used as the sortable key and displayed in the chip. */
    id: number;
    /** Render prop: receives the composed drag-handle+ID element to place inside the row. */
    children: (dragHandle: React.ReactNode) => React.ReactNode;
}

/** Wraps a single row with sortable drag behaviour and injects a drag handle. */
export function SortableItem({ id, children }: SortableItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

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
                label={`#${id}`}
                size="small"
                sx={{ minWidth: 38, fontSize: '0.7rem', height: 22, pointerEvents: 'none' }}
            />
        </Box>
    );

    return (
        <div ref={setNodeRef} style={style}>
            {children(dragHandle)}
        </div>
    );
}
