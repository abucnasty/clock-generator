import { Check, ContentCopy } from '@mui/icons-material';
import { Alert, Box, Button, Tab, Tabs, Typography } from '@mui/material';
import { useId, useLayoutEffect, useMemo, useState } from 'react';
import type { ClockAlternativeView } from '../worker/types';
import { beltCellText, clockTechnicalName, wakeUpsText } from '../utils/clockSummary';
import { INSTALL_COPY, needsNoClock, REQUIRES_FACTORIO, type WiringMoves } from '../utils/installSteps';
import { rateWarningOf } from '../utils/rateWarning';
import type { GeneratedFor } from '../utils/resultsStaleness';
import { tabProps } from '../utils/tabIds';
import { buildWakeWindowRows } from '../utils/wakeWindows';
import { AppDialog } from './AppDialog';
import { Disclosure } from './Disclosure';
import { BlueprintOutput } from './BlueprintOutput';
import { InstallSteps, WiringList } from './InstallSteps';
import { TabBody } from './TabBody';
import { HANDS_TEXT } from '../utils/targetCounts';

/** On-demand help shared by the toolbar and fullscreen workspace. Closing keeps the last reference tab. */
export function InstallClockDialog({ open, onClose, selected, blueprintString, staleFor, copyLabel, copied, onCopy }: {
    open: boolean;
    onClose: () => void;
    selected: ClockAlternativeView;
    blueprintString: string | null;
    staleFor: GeneratedFor | null;
    copyLabel: string;
    copied: boolean;
    onCopy: () => void;
}) {
    const id = useId();
    const [tab, setTab] = useState<'guide' | 'wiring'>('guide');
    const [modalRoot, setModalRoot] = useState<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        if (!open || !modalRoot) return;
        // The persistent workspace Modal keeps its own aria-hidden state. Make the page (including
        // that workspace) inert while this portal is on top, then restore its fullscreen state.
        const background = Array.from(modalRoot.parentElement?.children ?? [])
            .filter((element): element is HTMLElement => element !== modalRoot && element instanceof HTMLElement)
            .map(element => ({ element, inert: element.inert }));
        for (const { element } of background) element.inert = true;
        return () => { for (const { element, inert } of background) element.inert = inert; };
    }, [open, modalRoot]);
    const moves = useMemo(() => new Map<string, WiringMoves>(open ? buildWakeWindowRows(selected).map(row => [row.id, { items: row.items, route: row.route }]) : []), [open, selected]);
    const movesOf = (entity: string) => moves.get(entity) ?? { items: [], route: '' };
    const warning = rateWarningOf(selected);
    return <AppDialog ref={setModalRoot} open={open} onClose={onClose} maxWidth="md" dividers title="Install in Factorio" cancel="Close"
        actions={blueprintString && <Button variant="contained" color={staleFor || warning ? 'warning' : 'secondary'} onClick={onCopy} startIcon={copied ? <Check /> : <ContentCopy />}>
            {copied ? 'Copied' : copyLabel}
        </Button>}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{selected.counts === 'destroyed' ? HANDS_TEXT.clock(selected.terminalSwingCount) : `${selected.terminalSwingCount} ${selected.terminalSwingCount === 1 ? 'swing' : 'swings'}`} · {wakeUpsText(selected).value.replace(' a minute', ' wake-ups/min')}{selected.beltLabel && ` · ${beltCellText(selected.beltLabel)}`}</Typography>
        <Typography variant="caption" color="text.secondary" component="p">{clockTechnicalName(selected)} · {REQUIRES_FACTORIO}</Typography>
        {warning && <Alert severity="warning" sx={{ mt: 1 }}>{warning}</Alert>}
        <Tabs value={tab} onChange={(_, value: 'guide' | 'wiring') => setTab(value)} aria-label="Installation help" sx={{ mt: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label="Guide" value="guide" {...tabProps(id, 'guide')} />
            <Tab label="Wiring reference" value="wiring" {...tabProps(id, 'wiring')} />
        </Tabs>
        <TabBody prefix={id} tab="guide" shown={tab === 'guide'}>
            <InstallSteps install={selected.install} movesOf={movesOf} stale={staleFor !== null} alwaysOpen onShowWiring={() => setTab('wiring')} />
        </TabBody>
        <TabBody prefix={id} tab="wiring" shown={tab === 'wiring'}>
            {staleFor ? <Typography variant="body2">{INSTALL_COPY.stale}</Typography>
                : needsNoClock(selected.install) ? <Typography variant="body2">{INSTALL_COPY.none.detail}</Typography>
                : <WiringList install={selected.install} movesOf={movesOf} />}
        </TabBody>
        <Disclosure summary="Advanced · Blueprint string" sx={{ mt: 2 }}>
            <Box sx={{ mt: 1 }}><BlueprintOutput blueprintString={blueprintString} staleFor={staleFor} copied={copied} onCopy={onCopy} /></Box>
        </Disclosure>
    </AppDialog>;
}
