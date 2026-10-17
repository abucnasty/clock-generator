import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useViewport } from '@xyflow/react';
import { themeTokens } from '../theme/runtimeTokens';
import { tileGridBackground } from '../theme/tileGrid';

/** The tiles stay anchored to the diagram as the user pans and zooms. */
export function FlowTileBackground() {
    const { x, y, zoom } = useViewport();
    const tokens = themeTokens(useTheme());
    return <Box aria-hidden className="react-flow__background" data-flow-tile-grid=""
        sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: -1,
            bgcolor: tokens.surface.inset, ...tileGridBackground(40 * zoom), backgroundPosition: `${x}px ${y}px`,
            '@media (forced-colors: active)': { backgroundImage: 'none', bgcolor: 'Canvas' } }} />;
}
