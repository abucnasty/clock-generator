import { useEffect, useRef } from 'react';
import { Box, IconButton, Paper, Popper, Typography } from '@mui/material';
import { Close } from '@mui/icons-material';
import { useGameNames } from '../hooks/useGameNames';
import { ANOTHER_ITEM } from '../utils/blueprintPaste';
import { entityLabel } from '../utils/entityLabel';
import type { LaneEditor, LaneEditorBelt, LaneEditorLane } from '../utils/layoutLanes';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';

interface LayoutLanePopoverProps {
    beltId: number;
    belt: LaneEditorBelt;
    editor: LaneEditor;
    /** The element of the belt's tile the popover stands beside */
    anchor: SVGGElement;
    /** Changes whenever the picture pans or zooms, so that the popover follows its tile */
    followed: unknown;
    onClose(): void;
}

function LaneEditorRow({ beltId, lane, marked, editor }: { beltId: number; lane: LaneEditorLane; marked: boolean; editor: LaneEditor }) {
    const { itemLabel } = useGameNames();
    const { candidates } = lane;
    return (
        <Box data-lane-editor={lane.id} data-marked={marked ? '' : undefined}
            sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1, p: 0.5, borderRadius: 1, border: '2px solid', borderColor: marked ? 'secondary.main' : 'transparent' }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>Lane {lane.id} ({lane.side} of travel)</Typography>
            {candidates === null ? (
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    {lane.item && <FactorioIcon name={lane.item} size={20} alt="" />}
                    <Typography variant="body2">{lane.item ? itemLabel(lane.item) : 'No item'}</Typography>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center', flexWrap: 'wrap' }}>
                    {candidates.slice(0, 8).map(item => (
                        <IconButton key={item} size="small" aria-label={`${itemLabel(item)} for lane ${lane.id}`} aria-pressed={lane.item === item}
                            onClick={() => editor.onEdit(beltId, lane.id, item)} sx={lane.item === item ? { outline: '2px solid', outlineColor: 'secondary.main' } : undefined}>
                            <FactorioIcon name={item} size={20} alt="" />
                        </IconButton>
                    ))}
                    <ItemSelector label={ANOTHER_ITEM} inputAriaLabel={`${ANOTHER_ITEM} for lane ${lane.id}`} value={lane.item} size="small" minWidth={170}
                        options={[...new Set([...candidates, ...editor.itemNames])]} onChange={value => { if (value !== null) editor.onEdit(beltId, lane.id, value); }} />
                </Box>
            )}
        </Box>
    );
}

/**
 * The editor of the selected belt: its lanes, each with the items to pick from, beside the belt's tile. It stays in the
 * place of the view (no portal), so that a dialog around the view keeps its focus inside the editor.
 */
export function LayoutLanePopover({ beltId, belt, editor, anchor, followed, onClose }: LayoutLanePopoverProps) {
    const popper = useRef<{ update(): unknown } | null>(null);
    useEffect(() => { void popper.current?.update(); }, [followed, anchor]);
    return (
        <Popper open anchorEl={anchor} placement="right-start" disablePortal popperRef={instance => { popper.current = instance; }} popperOptions={{ strategy: 'fixed' }} sx={{ zIndex: 2 }}>
            <Paper elevation={8} role="group" aria-label={`Lanes of ${entityLabel('belt', beltId)}`} sx={{ p: 1.5, width: 330, ml: 1, border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="subtitle2">{entityLabel('belt', beltId)}</Typography>
                    <IconButton size="small" aria-label={`Close the lanes of ${entityLabel('belt', beltId)}`} onClick={onClose}><Close fontSize="small" /></IconButton>
                </Box>
                {belt.lanes.map(lane => <LaneEditorRow key={lane.id} beltId={beltId} lane={lane} marked={editor.markedLane === lane.id} editor={editor} />)}
            </Paper>
        </Popper>
    );
}
