import { Close, ContentPaste } from '@mui/icons-material';
import { Box, Button, IconButton, Link, Paper, Typography } from '@mui/material';
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

const HEADING_ID = 'intro-card-heading';

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
    return (
        <Paper component="section" aria-labelledby={HEADING_ID} sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Typography id={HEADING_ID} variant="h6" component="h2" sx={{ flex: 1 }}>
                    {INTRO_HEADING}
                </Typography>
                <IconButton size="small" onClick={onDismiss} aria-label={INTRO_BUTTONS.hide} sx={{ minWidth: 32, minHeight: 32 }}>
                    <Close fontSize="small" />
                </IconButton>
            </Box>
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
        </Paper>
    );
}
