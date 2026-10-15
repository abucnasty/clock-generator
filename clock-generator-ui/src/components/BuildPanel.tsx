import { AccountTree, List } from '@mui/icons-material';
import { Chip, ToggleButton, ToggleButtonGroup } from '@mui/material';
import type { ReactNode } from 'react';
import { Panel } from './Panel';

export type BuildView = 'list' | 'diagram';

interface BuildPanelProps {
    view: BuildView;
    onViewChange: (view: BuildView) => void;
    children: ReactNode;
}

/**
 * The build, in one card: its machines, belts and chests, inserters and drills as sections, with the List/Diagram
 * toggle in the card's title bar, the place of a card's own actions.
 */
export function BuildPanel({ view, onViewChange, children }: BuildPanelProps) {
    return (
        <Panel
            title="Build"
            id="build"
            actions={(
                <ToggleButtonGroup
                    value={view}
                    exclusive
                    onChange={(_, value: BuildView | null) => { if (value) onViewChange(value); }}
                    size="small"
                    aria-label="How the build is shown"
                >
                    <ToggleButton value="list" aria-label="List view">
                        <List fontSize="small" sx={{ mr: 0.5 }} />
                        List
                    </ToggleButton>
                    <ToggleButton value="diagram" aria-label="Diagram view">
                        <AccountTree fontSize="small" sx={{ mr: 0.5 }} />
                        Diagram
                        {/* in the button's own colour, which is black on the selected orange */}
                        <Chip label="beta" size="small" variant="outlined" sx={{ ml: 0.75, color: 'inherit', borderColor: 'currentColor' }} />
                    </ToggleButton>
                </ToggleButtonGroup>
            )}
        >
            {children}
        </Panel>
    );
}
