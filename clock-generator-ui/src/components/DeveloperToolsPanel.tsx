import type { DebugSteps, LogMessage } from 'clock-generator/browser';
import { DebugPanel } from './DebugPanel';
import { Panel } from './Panel';

interface DeveloperToolsPanelProps {
    logs: LogMessage[];
    debugSteps: DebugSteps;
    onDebugStepsChange: (steps: DebugSteps) => void;
    streamLogs: boolean;
    onStreamLogsChange: (stream: boolean) => void;
    onClearLogs: () => void;
}

/** Logging controls remain opt-in; useful clock timelines live in the normal Results workspace. */
export function DeveloperToolsPanel(props: DeveloperToolsPanelProps) {
    return <Panel title="Developer logs" sx={{ mt: 2, mb: 0 }} data-developer-tools="" data-build-anchor="developer">
        <DebugPanel {...props} />
    </Panel>;
}
