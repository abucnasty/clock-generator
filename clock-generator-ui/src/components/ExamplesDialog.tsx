import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { EXAMPLE_MANIFEST_URL, exampleSummary, exampleTitle, readExampleManifest, type ExampleBuild } from '../utils/exampleBuilds';
import { FactorioIcon } from './FactorioIcon';
import { useGameNames } from '../hooks/useGameNames';

const TITLE_ID = 'examples-dialog-title';
const INTRO = 'Pick a sample build to see how the tool works. It replaces your current build; Undo brings it back.';
const UNAVAILABLE = 'Examples are not available right now.';

interface ExamplesDialogProps {
    onPick: (example: ExampleBuild) => void;
    onClose: () => void;
}

/**
 * "Try an example": the sample builds, one per science pack, read from the list the copy script writes. Open while
 * mounted, so each opening reads the list again.
 */
export function ExamplesDialog({ onPick, onClose }: ExamplesDialogProps) {
    const { recipeLabel } = useGameNames();
    // null while the list loads
    const [examples, setExamples] = useState<ExampleBuild[] | null>(null);

    useEffect(() => {
        let current = true;
        fetch(EXAMPLE_MANIFEST_URL)
            .then((response) => (response.ok ? response.text() : ''))
            .catch(() => '')
            .then((text) => {
                if (!current) {
                    return;
                }
                const list = readExampleManifest(text);
                if (list.length === 0) {
                    console.warn(`No example builds at ${EXAMPLE_MANIFEST_URL}: run \`node scripts/copy-factorio-data.mjs\` in clock-generator-ui.`);
                }
                setExamples(list);
            });
        return () => {
            current = false;
        };
    }, []);

    return (
        <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby={TITLE_ID}>
            <DialogTitle id={TITLE_ID}>Try an example</DialogTitle>
            <DialogContent>
                <Typography variant="body2" sx={{ mb: 1 }}>
                    {INTRO}
                </Typography>
                {examples === null ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress aria-label="Loading the examples" />
                    </Box>
                ) : examples.length === 0 ? (
                    <Typography variant="body2" sx={{ py: 2 }}>
                        {UNAVAILABLE}
                    </Typography>
                ) : (
                    <List dense disablePadding>
                        {examples.map((example) => (
                            <ListItemButton key={example.id} onClick={() => onPick(example)}>
                                <ListItemIcon sx={{ minWidth: 40 }}>
                                    <FactorioIcon name={example.recipe} size={28} alt="" />
                                </ListItemIcon>
                                {/* the space keeps the title and the summary two words apart in the row's text, as in its name */}
                                <ListItemText primary={`${exampleTitle(example, recipeLabel)} `} secondary={exampleSummary(example)} />
                            </ListItemButton>
                        ))}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
            </DialogActions>
        </Dialog>
    );
}
