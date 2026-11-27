import { Close, ContentPaste, ExpandMore } from '@mui/icons-material';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { focusSetpointHeading } from '../utils/introCard';
import {
    INTRO_BUTTONS,
    INTRO_HEADING,
    INTRO_SENTENCE,
    INTRO_STEPS,
} from '../utils/sidecarGuide';
import { Panel } from './Panel';
import { BLUEPRINT_COPY_STEPS, BLUEPRINT_WAY_IN } from '../utils/blueprintPaste';

/** How to copy a blueprint in the game, as a numbered list */
export function BlueprintCopySteps() {
    return (
        <Box component="ol" sx={{ my: 0.5, pl: 3 }}>
            {BLUEPRINT_COPY_STEPS.map((step) => (
                <li key={step}>{step}</li>
            ))}
        </Box>
    );
}

interface IntroCardProps {
    onPaste: () => void;
    onTryExample: () => void;
    onBuildByHand: () => void;
    onDismiss: () => void;
}

/**
 * Above Target Output on a first visit: what the tool does and the ways in, with the full guide on demand.
 * Paste from Factorio is the next step; an example and building by hand are the others.
 */
export function IntroCard({ onPaste, onTryExample, onBuildByHand, onDismiss }: IntroCardProps) {
    const [guideOpen, setGuideOpen] = useState(false);
    const guideId = useId();
    const guideButtonId = useId();
    // when the card goes (hidden, or the build replaced) with the focus in it, the focus moves to the Target Output
    // heading below it instead of falling to the page. Run before the card leaves the page, while the focus is still in it
    const rootRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const root = rootRef.current;
        return () => {
            if (root?.contains(document.activeElement)) {
                focusSetpointHeading();
            }
        };
    }, []);

    return (
        <Panel
            ref={rootRef}
            id="intro-card"
            title={INTRO_HEADING}
            actions={(
                <IconButton size="small" onClick={onDismiss} aria-label={INTRO_BUTTONS.hide} sx={{ minWidth: 32, minHeight: 32 }}>
                    <Close fontSize="small" />
                </IconButton>
            )}
        >
            <Typography variant="body2" sx={{ mb: 1 }}>
                {INTRO_SENTENCE}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button variant="contained" color="secondary" startIcon={<ContentPaste />} onClick={onPaste}>
                    {INTRO_BUTTONS.paste}
                </Button>
                <Button variant="outlined" color="inherit" onClick={onTryExample}>
                    {INTRO_BUTTONS.example}
                </Button>
                <Button variant="text" color="inherit" onClick={onBuildByHand}>
                    {INTRO_BUTTONS.byHand}
                </Button>
            </Box>
            <Button
                id={guideButtonId}
                variant="text"
                color="inherit"
                aria-expanded={guideOpen}
                aria-controls={guideId}
                onClick={() => setGuideOpen(open => !open)}
                endIcon={<ExpandMore sx={{ transform: guideOpen ? 'rotate(180deg)' : 'none' }} />}
                sx={{ mt: 1, ml: -1, textAlign: 'left' }}
            >
                {INTRO_BUTTONS.guide}
            </Button>
            <Box id={guideId} role="region" aria-labelledby={guideButtonId} hidden={!guideOpen}>
                <Typography variant="body2" component="ol" sx={{ mt: 1, mb: 0, pl: 3, '& > li': { mb: 0.75 } }}>
                    <li>
                        {BLUEPRINT_WAY_IN.lead}
                        <BlueprintCopySteps />
                        {BLUEPRINT_WAY_IN.then}
                    </li>
                    <li>{INTRO_STEPS.generate}</li>
                    <li>{INTRO_STEPS.copy}</li>
                </Typography>
            </Box>
        </Panel>
    );
}
