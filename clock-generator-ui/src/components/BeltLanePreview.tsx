import { Box } from '@mui/material';
import type { BeltFormData } from '../hooks/useConfigForm';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';

const FRAMES: Record<string, number> = { 'transport-belt': 16, 'fast-transport-belt': 32, 'express-transport-belt': 32, 'turbo-transport-belt': 64 };

/** A static eastbound tile: the two item rows are placed on the actual game belt surface. */
export function BeltLanePreview({ belt }: { belt: BeltFormData }) {
    const { itemLabel } = useGameNames();
    const description = belt.lanes.map((lane, index) => `Lane ${index + 1}: ${lane.ingredient ? itemLabel(lane.ingredient) : 'empty'}, stack ${lane.stack_size}`).join('; ');
    return <Box component="span" role="img" aria-label={description} sx={{ position: 'relative', display: 'inline-block', width: 44, height: 39.6, overflow: 'hidden' }}>
        <Box sx={{ width: 160, height: 144, position: 'relative', transform: 'scale(0.275)', transformOrigin: 'top left' }}>
            <Box aria-hidden sx={{ position: 'absolute', width: 256, height: 256, left: -48, top: -56,
                backgroundImage: `url(/images/belt-preview/${belt.type}.png)`, backgroundSize: `${(FRAMES[belt.type] ?? 16) * 256}px 5120px`, backgroundPosition: '0 0', imageRendering: 'pixelated' }} />
            {[0, 1].map(laneIndex => {
                const lane = belt.lanes[laneIndex];
                if (!lane?.ingredient) return null;
                return [0, 1, 2, 3].map(position => <Box key={`${laneIndex}-${position}`} sx={{ position: 'absolute', left: 17 + position * 30, top: laneIndex === 0 ? 33 : 76, width: 36, height: 36, zIndex: laneIndex + 1 }}>
                    {Array.from({ length: Math.min(4, Math.max(1, lane.stack_size)) }, (_, stackIndex) => <Box key={stackIndex} aria-hidden sx={{ position: 'absolute', left: 0, bottom: stackIndex * 4, display: 'flex', filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.65))' }}>
                        <FactorioIcon name={lane.ingredient} size={36} alt="" />
                    </Box>)}
                </Box>);
            })}
        </Box>
    </Box>;
}
