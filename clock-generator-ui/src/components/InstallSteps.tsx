import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Typography } from '@mui/material';
import { Fragment, useId, useState } from 'react';
import type { ClockInstallFacts } from '../worker/installFacts';
import { WIRING_LIST_NAME } from '../utils/a11yLabels';
import { INSTALL_COPY, installSteps, wiringList, type WiringEnd, type WiringMoves, type WiringRow } from '../utils/installSteps';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { RichText } from './RichText';
import { WakeRowMoves } from './WakeRowMoves';

/** Where the steps being folded away is remembered, so a player who knows them is not shown them again */
const COLLAPSED_KEY = 'clock-generator-install-steps-collapsed';
/** Past this many lines (a combinator for one inserter is one line; one for several, a line more) the wiring list scrolls in its own box */
const WIRING_ROWS_SHOWN = 8;
/** The box's height then: about 8 one-line rows */
const WIRING_BOX_PX = 8 * 30 + 36;

/** The lines of the list: one per inserter or drill, and a line more for a combinator of several, or for the combinator's own line */
const linesOf = (rows: WiringRow[]) => rows.reduce((lines, row) => lines + row.entries.length + (row.line !== undefined || row.entries.length > 1 ? 1 : 0), 0);

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
    /** What an inserter or drill moves and between which ends, by entity id ("inserter:3"); empty when unknown */
    movesOf: (id: string) => WiringMoves;
    /** The clocks are for an earlier build: the wiring list would name inserters of a build that has changed */
    stale: boolean;
    /** The Install context already supplies the disclosure, so all steps stay visible. */
    alwaysOpen?: boolean;
    /** Open the shared wiring reference instead of repeating it in the guide. */
    onShowWiring?: () => void;
}

/** An arrow between two parts of a route; a screen reader hears a comma */
function Arrow() {
    return (
        <>
            <span aria-hidden="true">→</span>
            <Box component="span" sx={VISUALLY_HIDDEN}>, </Box>
        </>
    );
}

/** "Machine 2" and the icon of its recipe in brackets, "Machine 2 (icon)" */
function WiringEndText({ end }: { end: WiringEnd }) {
    return (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <span>{end.label.replace(' ', '\u00a0')}</span>
            {end.recipe !== undefined && (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                    <span aria-hidden="true">(</span>
                    <FactorioIcon name={end.recipe} size={20} titled fallback={<GameName id={end.recipe} kind="recipe" />} />
                    <span aria-hidden="true">)</span>
                </Box>
            )}
        </Box>
    );
}

/**
 * One inserter or drill, as its combinator's description has it: source, the item it moves, then the sink with the recipe
 * of a machine: "Inserter 1 — Belt 1 → [icon] → Machine 2 ([recipe icon])". A drill is its own source: "Drill 1 → [icon] →
 * Machine 2". A screen reader hears "Inserter 1, Belt 1, Iron plate, Machine 2, Iron gear". A run that does not name the
 * ends keeps the earlier line, "Inserter 1 — [icon]: Belt 1 to Machine 1".
 */
function WiringEntryText({ entry }: { entry: WiringRow['entries'][number] }) {
    if (entry.to !== undefined) {
        const items = (
            <Box component="span" sx={{ display: 'inline-flex', gap: 0.5 }}>
                {entry.items.map((item, index) => (
                    <Fragment key={item}>
                        {index > 0 && <Box component="span" sx={VISUALLY_HIDDEN}>, </Box>}
                        <FactorioIcon name={item} size={20} titled fallback={<GameName id={item} />} />
                    </Fragment>
                ))}
            </Box>
        );
        return (
            <Box component="span" data-wiring-moves="" sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 0.75, maxWidth: '100%' }}>
                <span>{entry.label}</span>
                {entry.from !== undefined ? (
                    <>
                        <span aria-hidden="true">—</span>
                        <Box component="span" sx={VISUALLY_HIDDEN}>, </Box>
                        <WiringEndText end={entry.from} />
                    </>
                ) : null}
                {entry.items.length > 0 && <><Arrow />{items}</>}
                <Arrow />
                <WiringEndText end={entry.to} />
            </Box>
        );
    }
    const moves = entry.items.length > 0 || entry.route !== '';
    return (
        <>
            {entry.label}
            {moves && (
                <>
                    <span aria-hidden="true"> — </span>
                    <Box component="span" sx={VISUALLY_HIDDEN}>, </Box>
                    <WakeRowMoves row={entry} />
                </>
            )}
        </>
    );
}

/**
 * One combinator: its first line as the game shows it (what a player reads on the combinator they placed), then the
 * inserters or drills to wire to its output, one line each. A clock with no line for it keeps the earlier form: one
 * line for one inserter, a heading and its inserters for several.
 */
function WiringItem({ row }: { row: WiringRow }) {
    if (row.line === undefined && row.entries.length === 1) {
        return (
            <Box component="li" sx={{ py: 0.5 }} data-wiring-row={row.combinator} data-wiring-entry="">
                <WiringEntryText entry={row.entries[0]} />
            </Box>
        );
    }
    return (
        <Box component="li" sx={{ py: 0.5 }} data-wiring-row={row.combinator}>
            {row.line === undefined ? (
                <>
                    <Box component="span" sx={{ fontWeight: 600 }}>{row.combinator}</Box>
                    <Box component="span" sx={{ color: 'text.secondary' }}> ({INSTALL_COPY.oneCombinator})</Box>
                </>
            ) : (
                <Box component="span" data-wiring-line=""><RichText text={row.line} /></Box>
            )}
            <Box component="ul" sx={{ m: 0, pl: 2.5, ...(row.line === undefined ? {} : { color: 'text.secondary' }) }}>
                {row.entries.map(entry => (
                    <li key={entry.label} data-wiring-entry=""><WiringEntryText entry={entry} /></li>
                ))}
            </Box>
        </Box>
    );
}

/** What to wire to each combinator: what each inserter carries and between which ends */
export function WiringList({ install, movesOf }: Pick<InstallStepsProps, 'install' | 'movesOf'>) {
    const captionId = useId();
    const rows = wiringList(install, movesOf);
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
export function InstallSteps({ install, movesOf, stale, alwaysOpen = false, onShowWiring }: InstallStepsProps) {
    const [expanded, setExpanded] = useState(() => !readCollapsed());
    const summaryId = useId();
    const detailsId = useId();
    const steps = installSteps(install);

    const content = stale ? (
        <Typography variant="body2" data-install-stale>{INSTALL_COPY.stale}</Typography>
    ) : (
        <Box component="ol" sx={{ m: 0, pl: 3, maxWidth: '80ch' }}>
            {steps.map(step => (
                <Box component="li" key={step.id} sx={{ mb: 1.5 }} data-install-step={step.id}>
                    <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>{step.title}</Typography>
                    <Typography variant="body2" component="p" color="text.secondary">{step.detail}</Typography>
                    {(step.id === 'wire' || step.id === 'drills') && (onShowWiring
                        ? <Button size="small" color="inherit" onClick={onShowWiring} sx={{ mt: 0.5 }}>View wiring reference</Button>
                        : <WiringList install={install} movesOf={movesOf} />)}
                </Box>
            ))}
        </Box>
    );
    if (alwaysOpen) {
        return <Box data-install-steps sx={{ mt: 1 }}>{content}</Box>;
    }
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
            slotProps={{ region: { 'aria-labelledby': summaryId } }}
        >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} id={summaryId} aria-controls={detailsId}>
                <Typography component="span" variant="subtitle1" sx={{ fontWeight: 600 }}>{INSTALL_COPY.heading}</Typography>
            </AccordionSummary>
            <AccordionDetails id={detailsId} sx={{ pt: 0 }}>
                {content}
            </AccordionDetails>
        </Accordion>
    );
}
