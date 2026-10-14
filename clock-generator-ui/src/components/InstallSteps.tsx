import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import { useId, useState } from 'react';
import type { ClockInstallFacts } from '../worker/installFacts';
import { INSTALL_COPY, REQUIRES_FACTORIO, installSteps, wiringRows, wiringTargets } from '../utils/installSteps';

/** Where the steps being folded away is remembered, so a player who knows them is not shown them again */
const COLLAPSED_KEY = 'clock-generator-install-steps-collapsed';
/** From this many rows the wiring list scrolls in its own box */
const WIRING_ROWS_SHOWN = 8;
/** A row of the small table, for the height of the box that shows 8 of them */
const WIRING_ROW_PX = 33;

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
    hasDrills: boolean;
    /** The clocks are for an earlier build: the wiring list would name inserters of a build that has changed */
    stale: boolean;
}

/** Which inserters to wire to which combinator, one row per combinator */
function WiringList({ wiring }: { wiring: number[][] }) {
    const rows = wiringRows(wiring);
    const targets = wiringTargets(wiring);
    const scrolls = rows.length > WIRING_ROWS_SHOWN;
    return (
        <Box
            role="region"
            aria-label={INSTALL_COPY.wiringRegion}
            // a box that scrolls takes the focus, so that it scrolls from the keyboard
            tabIndex={scrolls ? 0 : undefined}
            sx={{
                mt: 1,
                maxHeight: scrolls ? (WIRING_ROWS_SHOWN + 1.5) * WIRING_ROW_PX : undefined,
                overflow: 'auto',
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.default',
            }}
            data-wiring-list
        >
            <Table size="small" stickyHeader={scrolls}>
                <Typography component="caption" variant="body2" sx={{ captionSide: 'top', textAlign: 'left', px: 1, py: 0.5, color: 'text.secondary' }}>
                    {INSTALL_COPY.wiringCaption}
                </Typography>
                <TableHead>
                    <TableRow>
                        <TableCell sx={{ bgcolor: 'background.default' }}>{INSTALL_COPY.wiringCombinatorColumn}</TableCell>
                        <TableCell sx={{ bgcolor: 'background.default' }}>{INSTALL_COPY.wiringInsertersColumn}</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map((row, index) => (
                        <TableRow key={row}>
                            <TableCell>{row}</TableCell>
                            <TableCell>{targets[index]}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Box>
    );
}

/**
 * The numbered steps that put the clock into the game, with the list of which inserters to wire to which combinator.
 * Open unless the player folded it away; while the clocks are for an earlier build, only one line.
 */
export function InstallSteps({ install, hasDrills, stale }: InstallStepsProps) {
    const [expanded, setExpanded] = useState(() => !readCollapsed());
    const summaryId = useId();
    const detailsId = useId();
    const steps = installSteps({ book: install.book, wiring: install.wiring, hasDrills });

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
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1.5 }}>
                    <Typography component="span" variant="subtitle1" sx={{ fontWeight: 600 }}>{INSTALL_COPY.heading}</Typography>
                    <Typography component="span" variant="body2" color="text.secondary">{REQUIRES_FACTORIO}</Typography>
                </Box>
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
                                {step.id === 'wire' && <WiringList wiring={install.wiring} />}
                            </Box>
                        ))}
                    </Box>
                )}
            </AccordionDetails>
        </Accordion>
    );
}
