import { ControlButton } from '@xyflow/react';
import { CenterFocusStrong } from '@mui/icons-material';

/** Run one fit using node and result-card bounds, without queuing the node-only default fit. */
export function FlowFitButton({ onFit }: { onFit: () => void }) {
    return <ControlButton className="react-flow__controls-fitview" title="Fit View" aria-label="Fit View" onClick={onFit}>
        <CenterFocusStrong />
    </ControlButton>;
}
