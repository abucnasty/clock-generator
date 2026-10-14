import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Typography } from '@mui/material';
import { useId, useState } from 'react';
import type { ClockInstallFacts } from '../worker/installFacts';
import { WIRING_LIST_NAME } from '../utils/a11yLabels';
import { INSTALL_COPY, installSteps, wiringList, type WiringRow } from '../utils/installSteps';

/** Where the steps being folded away is remembered, so a player who knows them is not shown them again */
const COLLAPSED_KEY = 'clock-generator-install-steps-collapsed';
/** Past this many lines (a combinator for one inserter is one line; one for several, a line more) the wiring list scrolls in its own box */
const WIRING_ROWS_SHOWN = 8;
/** The box's height then: about 8 one-line rows */
const WIRING_BOX_PX = 8 * 30 + 36;

/** The lines of the list: one per inserter or drill, and a heading line for a combinator of several */
const linesOf = (rows: WiringRow[]) => rows.reduce((lines, row) => lines + row.entries.length + (row.entries.length > 1 ? 1 : 0), 0);

function readCollapsed(): boolean {
    try {
        return window.localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
        return false;
    }
}

function writeCollapsed(collapsed: boolean) {
    try {
        if (collapsed) {
            window.localStorage.setItem(COLLAPSED_KEY, 'true');
        } else {
            window.localStorage.removeItem(COLLAPSED_KEY);
        }
    } catch {
        // the page works without it: the steps open again next time
    }
}

interface InstallStepsProps {
    install: ClockInstallFacts;
    /** What an inserter or drill carries and between which ends, by entity id ("inserter:3"); empty when unknown */
    detailOf: (id: string) => string;
    /** The clocks are for an earlier build: the wiring list would name inserters of a build that has changed */
    stale: boolean;
}

/** One combinator: what it is called, then what to wire to its output (one line when it serves one inserter) */
function WiringItem({ row }: { row: WiringRow }) {
    if (row.entries.length === 1) {
        return <Box component="li" sx={{ py: 0.5 }} data-wiring-row={row.combinator}>{row.entries[0]}</Box>;
    }
    return (
        <Box component="li" sx={{ py: 0.5 }} data-wiring-row={row.combinator}>
            <Box component="span" sx={{ fontWeight: 600 }}>{row.combinator}</Box>
            <Box component="span" sx={{ color: 'text.secondary' }}> ({INSTALL_COPY.oneCombinator})</Box>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {row.entries.map(entry => <li key={entry}>{entry}</li>)}
            </Box>
        </Box>
    );
}

/** What to wire to each combinator: what each inserter carries and between which ends */
function WiringList({ install, detailOf }: Pick<InstallStepsProps, 'install' | 'detailOf'>) {
    const captionId = useId();
    const rows = wiringList(install, detailOf);
    const scrolls = linesOf(rows) > WIRING_ROWS_SHOWN;
    return (
        <Box
            role="region"
            aria-label={WIRING_LIST_NAME}
            // a box that scrolls takes the focus, so that it scrolls from the keyboard
            tabIndex={scrolls ? 0 : undefined}
            sx={{
                mt: 1,
                px: 1.5,
                py: 1,
                maxHeight: scrolls ? WIRING_BOX_PX : undefined,
                overflow: 'auto',
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.default',
            }}
            data-wiring-list
        >
            <Typography id={captionId} variant="body2" color="text.secondary" data-wiring-caption>{INSTALL_COPY.wiringCaption}</Typography>
            <Typography
                component="ul"
                variant="body2"
                aria-labelledby={captionId}
                sx={{ m: 0, mt: 0.5, pl: 2.5, overflowWrap: 'anywhere' }}
            >
                {rows.map(row => <WiringItem key={row.combinator} row={row} />)}
            </Typography>
        </Box>
    );
}

/**
 * The numbered steps that put the clock into the game, with the list of what to wire to each combinator. Open unless
 * the player folded it away; while the clocks are for an earlier build, only one line.
 */
export function InstallSteps({ install, detailOf, stale }: InstallStepsProps) {
    const [expanded, setExpanded] = useState(() => !readCollapsed());
    const summaryId = useId();
    const detailsId = useId();
    const steps = installSteps(install);

    return (
        <Accordion
            expanded={expanded}
            onChange={(_, open) => {
                setExpanded(open);
                writeCollapsed(!open);
            }}
            disableGutters
            variant="outlined"
            sx={{ mt: 2, bgcolor: 'background.paper' }}
            data-install-steps
        >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} id={summaryId} aria-controls={detailsId}>
                <Typography component="span" variant="subtitle1" sx={{ fontWeight: 600 }}>{INSTALL_COPY.heading}</Typography>
            </AccordionSummary>
            <AccordionDetails id={detailsId} sx={{ pt: 0 }}>
                {stale ? (
                    <Typography variant="body2" data-install-stale>{INSTALL_COPY.stale}</Typography>
                ) : (
                    <Box component="ol" sx={{ m: 0, pl: 3, maxWidth: '80ch' }}>
                        {steps.map(step => (
                            <Box component="li" key={step.id} sx={{ mb: 1.5 }} data-install-step={step.id}>
                                <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>{step.title}</Typography>
                                <Typography variant="body2" component="p" color="text.secondary">{step.detail}</Typography>
                                {(step.id === 'wire' || step.id === 'drills') && <WiringList install={install} detailOf={detailOf} />}
                            </Box>
                        ))}
                    </Box>
                )}
            </AccordionDetails>
        </Accordion>
    );
}
