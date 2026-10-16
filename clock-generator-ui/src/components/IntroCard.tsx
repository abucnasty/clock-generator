import { Close, ContentPaste } from '@mui/icons-material';
import { Box, Button, IconButton, Link, Typography } from '@mui/material';
import { useLayoutEffect, useRef } from 'react';
import { focusTargetOutputHeading } from '../utils/introCard';
import {
    INTRO_BUTTONS,
    INTRO_HEADING,
    INTRO_SENTENCE,
    INTRO_STEPS,
    NEW_TAB_CUE,
    SIDECAR_COPY_STEPS,
    SIDECAR_MOD_NAME,
    SIDECAR_MOD_URL,
    SIDECAR_NEEDS,
} from '../utils/sidecarGuide';
import { Panel } from './Panel';

/** The link to the Sidecar mod's page, which opens in a new tab and says so */
export function SidecarModLink() {
    return (
        // padded to a target of 24px or more (WCAG 2.5.8); still inline, so it wraps with the sentence
        <Link href={SIDECAR_MOD_URL} target="_blank" rel="noopener noreferrer" underline="always" sx={{ py: '2px' }}>
            {SIDECAR_MOD_NAME} mod {NEW_TAB_CUE}
        </Link>
    );
}

/** The Sidecar mod's copy steps, as a numbered list */
export function SidecarCopySteps() {
    return (
        <Box component="ol" sx={{ my: 0.5, pl: 3 }}>
            {SIDECAR_COPY_STEPS.map((step) => (
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
 * Above Target Output on a first visit: what the tool does, the three steps from a build in Factorio to a clock in it,
 * and the ways in. Paste from Factorio is the next step; an example and building by hand are the others.
 */
export function IntroCard({ onPaste, onTryExample, onBuildByHand, onDismiss }: IntroCardProps) {
    // when the card goes (hidden, or the build replaced) with the focus in it, the focus moves to the Target Output
    // heading below it instead of falling to the page. Run before the card leaves the page, while the focus is still in it
    const rootRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const root = rootRef.current;
        return () => {
            if (root?.contains(document.activeElement)) {
                focusTargetOutputHeading();
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
            <Typography variant="body2" component="ol" sx={{ my: 0, pl: 3, '& > li': { mb: 0.75 } }}>
                <li>
                    {INTRO_STEPS.getBuildIn}
                    <SidecarCopySteps />
                    {INTRO_STEPS.getBuildInLast}{' '}
                    Get the <SidecarModLink />. {SIDECAR_NEEDS}
                </li>
                <li>{INTRO_STEPS.generate}</li>
                <li>{INTRO_STEPS.copy}</li>
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
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
        </Panel>
    );
}
