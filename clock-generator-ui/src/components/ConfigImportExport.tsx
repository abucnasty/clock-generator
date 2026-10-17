import { Check, Download, Upload, ContentPaste, MoreVert, RestartAlt, Science, MenuBook, Link, DarkModeOutlined, LightModeOutlined, BrightnessAutoOutlined } from '@mui/icons-material';
import { Box, Button, Alert, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Checkbox, Typography, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Divider, TextField, useMediaQuery, useTheme } from '@mui/material';
import { useRef, useState, useCallback, useImperativeHandle, type ReactNode, type Ref } from 'react';
import type { Config, SuggestedTarget } from 'clock-generator/browser';
import { Option } from 'clock-generator/light';
import { readConfigFile } from '../hooks/useConfigForm';
import { useDismissMessage, useNotify } from '../hooks/useMessages';
import { useGameNames } from '../hooks/useGameNames';
import { useDisplayPreferences } from '../hooks/useDisplayPreferences';
import type { DisplayScheme } from '../utils/displayPreferences';
import { countOf, describePaste, exampleUndoMessage, UNDO_IMPORT_MESSAGE, UNDO_RESET_MESSAGE } from '../utils/undoSnapshot';
import { BUTTON_NAMES } from '../utils/a11yLabels';
import { looksLikeSidecarExport, readSidecarExport } from '../utils/sidecarExport';
import { INTRO_BUTTONS, invalidExportPrompt, openFileProblem, PASTE_PROMPTS, type PastePrompt } from '../utils/sidecarGuide';
import { NO_TARGET_NOTE, replacesTargetNote, targetRowCaption, targetRowLabel, targetToFill, type TargetValues } from '../utils/pasteTarget';
import type { ExampleBuild } from '../utils/exampleBuilds';
import { focusTargetOutputHeading } from '../utils/introCard';
import type { ConfigFormData } from '../utils/configForm/formData';
import { applyPaste, pastePreview, type ImportSelections, type PasteReferenceWarning } from '../utils/pastePreview';
import { InserterAssumptions } from './InserterAssumptions';
import { entityLabel } from '../utils/entityLabel';
import { buildFileName } from '../utils/buildLibrary';
import { configKeyOf } from '../utils/resultsStaleness';
import { nameWithId } from '../utils/gameNames';
import {
    canShare,
    encodeShareLink,
    SHARE_COPIED_MESSAGE,
    SHARE_FALLBACK_TEXT,
    SHARE_TOO_BIG_MESSAGE,
    SHARE_UNSUPPORTED_MESSAGE,
    shareLinkNotice,
    shareLongMessage,
} from '../utils/shareLink';
import { askEngine } from '../worker/engineClient';
import type { PastedEntities } from '../worker/types';
import { PasteFromFactorioDialog } from './PasteFromFactorioDialog';
import { ExamplesDialog } from './ExamplesDialog';
import { ImportSimplification } from './ImportSimplification';
import { importReduction, type ImportReduction } from '../utils/importReduction';
import { formDataToConfig } from '../utils/configForm/configMapping';

const SAVED_MESSAGE = 'Build saved to a file.';
const TARGET_CAPTION_ID = 'paste-target-caption';
const EXAMPLE_FAILED_MESSAGE = 'Could not load the example. Check your connection and try again.';
const freshImportSelections = (): ImportSelections => ({ target: false, machines: true, drills: true, inserters: true, belts: true, chests: true });
const THEME_CHOICES = [
    { scheme: 'dark', label: 'Theme: Dark', icon: DarkModeOutlined },
    { scheme: 'light', label: 'Theme: Light', icon: LightModeOutlined },
    { scheme: 'system', label: 'Theme: Auto (device)', icon: BrightnessAutoOutlined },
] satisfies { scheme: DisplayScheme; label: string; icon: typeof DarkModeOutlined }[];

/** Describe the destination of this exact preview without suggesting a silent rebind or renumber. */
function crossingText(warning: PasteReferenceWarning): string {
    const imported = warning.direction === 'incoming-to-retained';
    return `${imported ? 'Imported' : 'Retained'} ${entityLabel(warning.ownerType, warning.ownerId)} ${warning.slot}`
        + ` → ${imported ? 'retained' : 'imported'} ${entityLabel(warning.endpointType, warning.endpointId)}`
        + (warning.destinationExists ? '.' : ' (missing from the resulting build).');
}

interface PendingImport extends PastedEntities {
    original?: PendingImport;
    reduction?: ImportReduction;
    repeatedSourceKey?: string;
    originalSelections?: ImportSelections;
    miningProductivityLevel?: number;
    /** The Target Output the paste can fill in, and where it came from; null when it could not tell */
    fill: { values: TargetValues; source: SuggestedTarget['source'] } | null;
}

/** What the intro card starts in here */
export interface BuildEntryHandle {
    /** Reads the clipboard, so it must be called from the click itself */
    pasteFromFactorio: () => void;
    openExamples: () => void;
}

interface ConfigImportExportProps {
    ref?: Ref<BuildEntryHandle>;
    /** Null disables Save build file */
    config: Config | null;
    /** Raw destination counts/references remain available even while the build cannot be exported. */
    currentForm: ConfigFormData;
    /** The form's Target Output, which a paste fills in only when its recipe is empty */
    target: TargetValues;
    onImport: (config: Config) => void;
    /** Commits a selected paste as one form edit, preserving retained raw fields and row identity. */
    onApplyPaste: (form: ConfigFormData) => void;
    onReset: () => void;
    /** Called after Open, Paste, an example or Reset replaced the build, so the clocks and the check of the old one go */
    onBuildReplaced: () => void;
    /** Call just before the build is replaced, so the app can snapshot it for Undo; the message says what happened */
    onUndoable: (message: string) => void;
    /** "Getting started": shows the intro card again */
    onShowIntro: () => void;
    /**
     * The header's Paste is the next step, and so the filled button: a blank build with the intro card closed. With the card
     * shown its own Paste is the filled one; with a build, Generate or Copy is (one filled next step per state)
     */
    pasteIsNextStep: boolean;
    /** The open build's own name, which a share link carries; null when it is named after its target recipe */
    buildName: string | null;
    /** The open build's title, which Save build file names the file after */
    buildTitle: string;
    /**
     * Items of the page's own put in ⋮ after Getting started (Terms, Developer tools): this menu shows them and calls
     * them with the ⋮ button, which a popover they open can hang from. One with `checked` is a check item.
     */
    toolsMenuItems?: ToolsMenuItem[];
    /** Place the entry action and global menu in separate toolbar groups. */
    renderControls?: (paste: ReactNode, menu: ReactNode) => ReactNode;
    onInstall?: () => void;
    onCheckOnly?: () => void;
    checkDisabled?: boolean;
}

/** A share link made when the ⋮ menu opens, so a click can copy it at once; tagged with the build it was made for */
interface PreparedLink {
    tag: string;
    promise: Promise<string>;
    link: string | null;
}

export interface ToolsMenuItem {
    key: string;
    label: string;
    icon: ReactNode;
    /** A setting that is on or off: the item is a menuitemcheckbox, ticked while on */
    checked?: boolean;
    onClick: (menuButton: HTMLElement | null) => void;
}

export function ConfigImportExport({
    ref,
    config,
    currentForm,
    target: currentTarget,
    onImport,
    onApplyPaste,
    onReset,
    onBuildReplaced,
    onUndoable,
    onShowIntro,
    pasteIsNextStep,
    buildName,
    buildTitle,
    toolsMenuItems = [],
    renderControls, onInstall, onCheckOnly, checkDisabled,
}: ConfigImportExportProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    // below 600px the app bar's Paste button says only "Paste", so the title keeps its room
    const theme = useTheme();
    const narrow = useMediaQuery(theme.breakpoints.down('sm'));
    const compactToolbar = useMediaQuery(theme.breakpoints.down('lg'));
    const notify = useNotify();
    const { recipeLabel, itemLabel } = useGameNames();
    const { scheme, setScheme } = useDisplayPreferences();
    const dismiss = useDismissMessage();
    // the last error of opening a build file or loading an example, which goes as soon as the player tries again
    const errorIdRef = useRef<number | null>(null);
    const closeLastError = useCallback(() => {
        if (errorIdRef.current !== null) {
            dismiss(errorIdRef.current);
            errorIdRef.current = null;
        }
    }, [dismiss]);

    // State for the hamburger menu
    const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
    const menuOpen = Boolean(menuAnchorEl);

    // State for the import confirmation modal
    const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
    const [importSelections, setImportSelections] = useState<ImportSelections>(freshImportSelections);

    // Consent belongs to this exact preview. Identity checks invalidate it in the same render as any change.
    const [acknowledged, setAcknowledged] = useState<{
        incoming: PendingImport; current: ConfigFormData; selections: ImportSelections;
    } | null>(null);
    const preview = pendingImport ? pastePreview(currentForm, pendingImport, importSelections) : null;
    const prospectiveInserters = pendingImport && preview?.counts.find(row => row.category === 'inserters')?.replacing ? pendingImport.inserters : currentForm.inserters;
    const prospectiveMachines = pendingImport && preview?.counts.find(row => row.category === 'machines')?.replacing ? pendingImport.machines : currentForm.machines;
    const prospectiveTarget = importSelections.target && pendingImport?.fill ? pendingImport.fill.values : currentTarget;
    const acknowledgedCurrent = acknowledged?.incoming === pendingImport && acknowledged?.current === currentForm
        && acknowledged?.selections === importSelections;
    if (acknowledged && !acknowledgedCurrent) setAcknowledged(null);
    const hasImportWork = (importSelections.target && pendingImport?.fill != null) || preview?.counts.some(row => row.replacing) === true;
    const canImport = hasImportWork && !preview?.geometryProblem && (!preview?.crossings.length || acknowledgedCurrent);

    // Simplification can replace a complete import, never a category the user chose to retain.
    const canSimplify = pendingImport && !pendingImport.reduction && canImport && pendingImport.fill && prospectiveTarget.recipe !== ''
        && preview?.counts.every(row => (row.incoming === 0 || row.replacing) && (row.current === 0 || row.replacing));
    let simplificationConfig: Config | null = null;
    if (canSimplify && pendingImport) {
        const base = formDataToConfig(currentForm);
        simplificationConfig = {
            ...base,
            target_output: prospectiveTarget,
            machines: pendingImport.machines,
            inserters: pendingImport.inserters,
            belts: pendingImport.belts,
            chests: pendingImport.chests,
            ...(pendingImport.drills.length > 0 && { drills: {
                mining_productivity_level: pendingImport.miningProductivityLevel ?? base.drills?.mining_productivity_level ?? 0,
                configs: pendingImport.drills,
            } }),
        };
    }

    const forceFullImport = simplificationConfig !== null && pendingImport?.repeatedSourceKey === JSON.stringify(simplificationConfig);

    // the Paste from Factorio dialog, open when the clipboard could not be used, with why
    const [pasteDialog, setPasteDialog] = useState<{ prompt: PastePrompt | null; id: number; session: number } | null>(null);
    const pasteRequestRef = useRef(0);
    const pasteBusyRef = useRef(false);
    const promptCountRef = useRef(0);
    const showPastePrompt = useCallback((prompt: PastePrompt) => {
        const id = ++promptCountRef.current;
        const session = pasteRequestRef.current;
        setPasteDialog(current => ({ prompt, id, session: current?.session ?? session }));
    }, []);
    const resetPasteFlow = useCallback(() => {
        // A closed or replaced paste must not be reopened by an older clipboard read or engine response.
        pasteRequestRef.current++;
        pasteBusyRef.current = false;
        setPendingImport(null);
        setPasteDialog(null);
        setAcknowledged(null);
        setImportSelections(freshImportSelections());
    }, []);
    // what had the focus when the confirm dialog opened, for it to go back to; see handleConfirmExited
    const confirmOpenerRef = useRef<Element | null>(null);
    const [examplesOpen, setExamplesOpen] = useState(false);

    const handleExport = useCallback(() => {
        if (!config) return;
        const jsonString = JSON.stringify(config, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = buildFileName(buildTitle);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify({ severity: 'success', text: SAVED_MESSAGE });
    }, [config, buildTitle, notify]);

    // the share link, made when the menu opens: the copy then runs inside the click, which a browser asks of it
    const preparedLinkRef = useRef<PreparedLink | null>(null);
    const [fallbackLink, setFallbackLink] = useState<string | null>(null);
    const prepareShareLink = useCallback((): PreparedLink | null => {
        if (!config || !canShare()) return null;
        const tag = `${configKeyOf(config)}\n${buildName ?? ''}`;
        if (preparedLinkRef.current?.tag === tag) return preparedLinkRef.current;
        const prepared: PreparedLink = {
            tag,
            promise: encodeShareLink({ name: buildName, config }, window.location.origin + window.location.pathname),
            link: null,
        };
        prepared.promise.then((link) => { prepared.link = link; }, () => {});
        preparedLinkRef.current = prepared;
        return prepared;
    }, [config, buildName]);

    const handleCopyShareLink = useCallback(() => {
        const prepared = prepareShareLink();
        if (!prepared) {
            notify({ severity: 'error', text: SHARE_UNSUPPORTED_MESSAGE });
            return;
        }
        const copy = (link: string) => {
            const notice = shareLinkNotice(link.length);
            if (notice === 'too-long') {
                notify({ severity: 'error', text: SHARE_TOO_BIG_MESSAGE });
                return;
            }
            const copied = () => notify(notice === 'long'
                ? { severity: 'warning', text: shareLongMessage(link.length) }
                : { severity: 'success', text: SHARE_COPIED_MESSAGE });
            let writing: Promise<void>;
            try {
                writing = navigator.clipboard.writeText(link);
            } catch (error) {
                // no clipboard API: a page not served over https, or an old browser
                writing = Promise.reject(error);
            }
            writing.then(copied, () => setFallbackLink(link));
        };
        if (prepared.link !== null) {
            copy(prepared.link);
        } else {
            prepared.promise.then(copy, (error) => {
                console.error('Share link error:', error);
                notify({ severity: 'error', text: SHARE_UNSUPPORTED_MESSAGE });
            });
        }
    }, [prepareShareLink, notify]);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    /** Replaces the build with the one a build file holds; throws when the text is not one */
    const importConfigText = useCallback(async (text: string, undoMessage: string) => {
        // values out of bounds are kept, for the form to show; only a broken file is rejected
        const parsedConfig = await askEngine({ kind: 'config-file', config: readConfigFile(text) });
        // its Undo message says what replaced the build
        onUndoable(undoMessage);
        onImport(parsedConfig);
        onBuildReplaced();
    }, [onImport, onBuildReplaced, onUndoable]);

    /**
     * Reads an export of the Sidecar mod and opens the confirm dialog for it. Returns why it could not, for the Paste
     * from Factorio dialog to say, or null once the confirm dialog is open.
     */
    const startPaste = useCallback(async (text: string, request = ++pasteRequestRef.current): Promise<PastePrompt | null> => {
        if (request !== pasteRequestRef.current) return null;
        const read = readSidecarExport(text);
        if (read.kind === 'problem') {
            return PASTE_PROMPTS[read.problem];
        }
        let validated: PastedEntities;
        try {
            // each list checked against its schema
            validated = await askEngine({
                kind: 'pasted-entities',
                machines: read.machines,
                drills: read.drills,
                inserters: read.inserters,
                belts: read.belts,
                chests: read.chests,
                sidecar_version: read.sidecarVersion,
                suggested_target: read.suggestedTarget,
            });
        } catch (error) {
            if (request !== pasteRequestRef.current) return null;
            console.error('Paste from Factorio error:', error);
            return invalidExportPrompt(error instanceof Error ? error.message : 'Unknown error');
        }
        if (request !== pasteRequestRef.current) return null;
        const suggestion = Option.toNullable(validated.suggested_target);
        const fill = suggestion ? { values: targetToFill(suggestion), source: suggestion.source } : null;
        confirmOpenerRef.current = document.activeElement;
        setPendingImport({ ...validated, miningProductivityLevel: read.miningProductivityLevel, fill });
        // everything there is, except a target the player has already set; the first exports had machines only
        setImportSelections({
            target: fill !== null && currentTarget.recipe === '',
            machines: validated.machines.length > 0,
            drills: !read.legacy && validated.drills.length > 0,
            inserters: !read.legacy && validated.inserters.length > 0,
            belts: !read.legacy && validated.belts.length > 0,
            chests: !read.legacy && validated.chests.length > 0,
        });
        return null;
    }, [currentTarget.recipe]);

    const handleFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const input = event.target;
            const file = input.files?.[0];
            if (!file) return;
            closeLastError();

            try {
                const content = await file.text();
                if (looksLikeSidecarExport(content)) {
                    // an export of the mod saved to a file goes to the paste
                    const prompt = await startPaste(content);
                    if (prompt) {
                        showPastePrompt(prompt);
                    }
                } else {
                    await importConfigText(content, UNDO_IMPORT_MESSAGE);
                }
            } catch (error) {
                console.error('Open build file error:', error);
                errorIdRef.current = notify({ severity: 'error', text: openFileProblem(error) });
            }

            // Reset the input so the same file can be opened again
            input.value = '';
        },
        [closeLastError, startPaste, importConfigText, notify, showPastePrompt]
    );

    // the clipboard is read in the click itself: a browser refuses a read after an await or a timer
    const handlePasteFromFactorio = useCallback(() => {
        closeLastError();
        resetPasteFlow();
        const request = pasteRequestRef.current;
        let reading: Promise<string>;
        try {
            reading = navigator.clipboard.readText();
        } catch (error) {
            // no clipboard API: a page not served over https, or an old browser
            reading = Promise.reject(error);
        }
        reading.then(
            async (text) => {
                if (request !== pasteRequestRef.current) return;
                const prompt = await startPaste(text, request);
                if (request === pasteRequestRef.current && prompt) showPastePrompt(prompt);
            },
            () => { if (request === pasteRequestRef.current) showPastePrompt(PASTE_PROMPTS.unreadable); },
        );
    }, [closeLastError, startPaste, showPastePrompt, resetPasteFlow]);

    // a paste into the dialog's box, or Continue; one at a time
    const handlePasteSubmit = useCallback(async (text: string) => {
        if (pasteBusyRef.current) return;
        pasteBusyRef.current = true;
        const request = ++pasteRequestRef.current;
        const prompt = await startPaste(text, request);
        if (request !== pasteRequestRef.current) return;
        pasteBusyRef.current = false;
        if (prompt) {
            showPastePrompt(prompt);
        } else {
            setPasteDialog(null);
        }
    }, [startPaste, showPastePrompt]);

    const handleClosePasteDialog = resetPasteFlow;

    const handlePickExample = useCallback(async (example: ExampleBuild) => {
        setExamplesOpen(false);
        closeLastError();
        try {
            const response = await fetch(`/examples/${example.file}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            await importConfigText(await response.text(), exampleUndoMessage(example, recipeLabel));
        } catch (error) {
            console.error('Example error:', error);
            errorIdRef.current = notify({ severity: 'error', text: EXAMPLE_FAILED_MESSAGE });
        }
    }, [closeLastError, importConfigText, notify, recipeLabel]);

    const openExamples = useCallback(() => setExamplesOpen(true), []);
    const handleCloseExamples = useCallback(() => setExamplesOpen(false), []);

    useImperativeHandle(ref, () => ({ pasteFromFactorio: handlePasteFromFactorio, openExamples }), [handlePasteFromFactorio, openExamples]);

    const handleConfirmImport = useCallback(() => {
        if (!pendingImport) return;
        const currentPreview = pastePreview(currentForm, pendingImport, importSelections);
        const hasWork = (importSelections.target && pendingImport.fill !== null) || currentPreview.counts.some(row => row.replacing);
        if (!hasWork || currentPreview.geometryProblem || (currentPreview.crossings.length > 0 && !acknowledgedCurrent)) return;

        const fill = importSelections.target ? pendingImport.fill : null;
        const parts = currentPreview.counts.filter(row => row.replacing)
            .map(row => countOf(row.incoming, row.category.slice(0, -1), row.category));
        if (fill !== null) parts.unshift('Target Output');
        const next = applyPaste(currentForm, pendingImport, importSelections, fill?.values, pendingImport.miningProductivityLevel);

        resetPasteFlow();

        // one Undo for the whole paste, taken before any of it is applied; its message says what was imported
        onUndoable(describePaste(parts));
        onApplyPaste(next);
        onBuildReplaced();
    }, [pendingImport, importSelections, currentForm, acknowledgedCurrent, onApplyPaste, onBuildReplaced, onUndoable, resetPasteFlow]);

    const handleCancelImport = resetPasteFlow;

    // the dialog puts the focus back itself: on its opener, unless an import took that off the page (the intro card's
    // Paste button, or the paste box), then on the Target Output heading rather than the page's body
    const handleConfirmExited = useCallback(() => {
        const opener = confirmOpenerRef.current;
        confirmOpenerRef.current = null;
        if (opener instanceof HTMLElement && opener.isConnected) {
            opener.focus();
        } else {
            focusTargetOutputHeading();
        }
    }, []);

    const handleSelectionChange = useCallback((key: keyof ImportSelections) => {
        setImportSelections(prev => ({
            ...prev,
            [key]: !prev[key],
        }));
    }, []);

    const handleMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
        setMenuAnchorEl(event.currentTarget);
        prepareShareLink();
    }, [prepareShareLink]);

    const handleMenuClose = useCallback(() => {
        setMenuAnchorEl(null);
    }, []);

    // Also anchors the help/tool actions opened from More options.
    const menuButtonRef = useRef<HTMLButtonElement>(null);

    // the file picker and the download are only allowed from the click itself: no await or timer before them
    const handleMenuImport = useCallback(() => {
        handleMenuClose();
        handleImportClick();
    }, [handleMenuClose, handleImportClick]);

    const handleMenuExport = useCallback(() => {
        handleMenuClose();
        handleExport();
    }, [handleMenuClose, handleExport]);

    const handleMenuShare = useCallback(() => {
        handleMenuClose();
        handleCopyShareLink();
    }, [handleMenuClose, handleCopyShareLink]);

    const handleMenuExamples = useCallback(() => {
        handleMenuClose();
        openExamples();
    }, [handleMenuClose, openExamples]);

    const handleMenuGettingStarted = useCallback(() => {
        handleMenuClose();
        onShowIntro();
    }, [handleMenuClose, onShowIntro]);

    const handleMenuReset = useCallback(() => {
        handleMenuClose();
        onUndoable(UNDO_RESET_MESSAGE);
        onReset();
        onBuildReplaced();
    }, [handleMenuClose, onReset, onBuildReplaced, onUndoable]);

    const pasteButton = <>
        {/* the way in: below 600px it says only "Paste", and keeps its full name */}
        <Button
            onClick={handlePasteFromFactorio}
            variant={pasteIsNextStep ? 'contained' : 'outlined'}
            color={pasteIsNextStep ? 'secondary' : 'inherit'}
            size="small"
            startIcon={narrow ? undefined : <ContentPaste />}
            aria-label={narrow ? INTRO_BUTTONS.paste : undefined}
            sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
            {narrow ? 'Paste' : INTRO_BUTTONS.paste}
        </Button>
    </>;
    const menuButton = <>
        {/* the tooltip stays in the header, so its text is inside the banner landmark */}
        <Tooltip title="More options" slotProps={{ popper: { disablePortal: true } }}>
            <IconButton
                ref={menuButtonRef}
                onClick={handleMenuOpen}
                size="small"
                color="inherit"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
            >
                <MoreVert />
            </IconButton>
        </Tooltip>
    </>;

    return (
        <>
            {renderControls ? renderControls(pasteButton, menuButton) : (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>{pasteButton}{menuButton}</Box>
            )}
            <Menu
                anchorEl={menuAnchorEl}
                open={menuOpen}
                onClose={handleMenuClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
                // The sticky header keeps the opener in place without locking page scrolling.
                disableScrollLock
                slotProps={{
                    paper: { role: 'region', 'aria-label': BUTTON_NAMES.moreOptions },
                    list: { 'aria-label': BUTTON_NAMES.moreOptions },
                }}
            >
                {compactToolbar && onCheckOnly && <MenuItem disabled={checkDisabled}
                    onClick={() => { handleMenuClose(); onCheckOnly(); }}>
                    <ListItemIcon><Check fontSize="small" /></ListItemIcon>
                    <ListItemText>Check only</ListItemText>
                </MenuItem>}
                {compactToolbar && onCheckOnly && <Divider />}
                <MenuItem onClick={handleMenuImport}>
                    <ListItemIcon>
                        <Upload fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Open build file…</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleMenuExport} disabled={!config}>
                    <ListItemIcon>
                        <Download fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Save build file</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleMenuShare} disabled={!config}>
                    <ListItemIcon>
                        <Link fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Copy share link</ListItemText>
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleMenuExamples}>
                    <ListItemIcon>
                        <Science fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Try an example…</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleMenuGettingStarted}>
                    <ListItemIcon>
                        <MenuBook fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Getting started</ListItemText>
                </MenuItem>
                {onInstall && <MenuItem onClick={() => { handleMenuClose(); onInstall(); }}>
                    <ListItemIcon><MenuBook fontSize="small" /></ListItemIcon>
                    <ListItemText>Install guide</ListItemText>
                </MenuItem>}
                {/* one by one, not in a Fragment: the Menu reads its children for the keyboard */}
                {toolsMenuItems.map(item => (
                    <MenuItem
                        key={item.key}
                        role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                        aria-checked={item.checked}
                        onClick={() => {
                            handleMenuClose();
                            item.onClick(menuButtonRef.current);
                        }}
                    >
                        <ListItemIcon>{item.icon}</ListItemIcon>
                        <ListItemText>{item.label}</ListItemText>
                        {item.checked && <Check fontSize="small" aria-hidden sx={{ ml: 2 }} />}
                    </MenuItem>
                ))}
                <Divider />
                {THEME_CHOICES.map(choice => (
                    <MenuItem
                        key={choice.scheme}
                        role="menuitemradio"
                        aria-checked={scheme === choice.scheme}
                        onClick={() => {
                            setScheme(choice.scheme);
                            handleMenuClose();
                        }}
                    >
                        <ListItemIcon><choice.icon fontSize="small" /></ListItemIcon>
                        <ListItemText>{choice.label}</ListItemText>
                        {scheme === choice.scheme && <Check fontSize="small" aria-hidden sx={{ ml: 2 }} />}
                    </MenuItem>
                ))}
                <Divider />
                {/* in the error text red (TEXT.error), 4.5:1 on the menu when hovered or focused: it throws the build away (Undo brings it back) */}
                <MenuItem onClick={handleMenuReset} sx={{ color: 'error.light' }}>
                    <ListItemIcon sx={{ color: 'inherit' }}>
                        <RestartAlt fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Reset build</ListItemText>
                </MenuItem>
            </Menu>

            <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />

            {/* Import Confirmation Dialog */}
            <Dialog
                open={pendingImport !== null}
                onClose={handleCancelImport}
                maxWidth="sm"
                fullWidth
                disableRestoreFocus
                slotProps={{ transition: { onExited: handleConfirmExited } }}
            >
                <DialogTitle>Confirm Import from Factorio</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Choose what to import. Selected parts replace those in your current build; unselected parts stay as they are.
                    </Typography>
                    
                    {pendingImport?.guidance && Option.match(pendingImport.guidance, {
                        none: () => null,
                        some: (message) => <Alert severity="warning" sx={{ mb: 2 }}>{message}</Alert>,
                    })}

                    {pendingImport && <ImportSimplification config={simplificationConfig} applied={pendingImport.reduction}
                        onRepeated={sourceKey => {
                            if (simplificationConfig && sourceKey === JSON.stringify(simplificationConfig) && pendingImport.repeatedSourceKey !== sourceKey)
                                setPendingImport(current => current === pendingImport ? { ...current, repeatedSourceKey: sourceKey } : current);
                        }}
                        onRestore={() => {
                            if (pendingImport.original) setPendingImport(pendingImport.original);
                            if (pendingImport.originalSelections) setImportSelections(pendingImport.originalSelections);
                        }}
                        onSimplify={plan => {
                            if (!simplificationConfig || plan.sourceConfigKey !== JSON.stringify(simplificationConfig)) return;
                            const candidate = plan.candidate;
                            setPendingImport({
                                ...pendingImport,
                                original: pendingImport,
                                originalSelections: importSelections,
                                reduction: importReduction(simplificationConfig, candidate),
                                machines: candidate.machines,
                                inserters: candidate.inserters,
                                belts: candidate.belts,
                                chests: candidate.chests ?? [],
                                drills: candidate.drills?.configs ?? [],
                                fill: { values: candidate.target_output, source: pendingImport.fill!.source },
                            });
                            // The explicit simplify action also accepts its displayed Copies change.
                            setImportSelections(current => ({ ...current, target: true }));
                        }} />}
                    {pendingImport && !pendingImport.reduction && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {preview?.geometryProblem && <Alert severity="error">{preview.geometryProblem}</Alert>}
                            {pendingImport.fill ? (
                                <Box>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={importSelections.target}
                                                onChange={() => handleSelectionChange('target')}
                                                slotProps={{ input: { 'aria-describedby': TARGET_CAPTION_ID } }}
                                            />
                                        }
                                        label={targetRowLabel(pendingImport.fill.values, recipeLabel)}
                                    />
                                    <Typography id={TARGET_CAPTION_ID} variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                                        {targetRowCaption(pendingImport.fill.source)}
                                        {currentTarget.recipe !== '' && ` ${replacesTargetNote(currentTarget, recipeLabel)}`}
                                    </Typography>
                                </Box>
                            ) : (
                                currentTarget.recipe === '' && (
                                    <Typography variant="body2" color="text.secondary">
                                        {NO_TARGET_NOTE}
                                    </Typography>
                                )
                            )}
                            {preview?.counts.map(row => {
                                const title = row.category[0].toUpperCase() + row.category.slice(1);
                                const consequence = row.replacing
                                    ? `${row.current} in your build → ${row.incoming} after import.`
                                    : row.incoming === 0 ? row.current === 0 ? 'None in this export.' : `None in this export. Your ${row.current} stay unchanged.`
                                        : `Not selected. Keep the ${row.current} in your build.`;
                                return (
                                    <Box key={row.category} data-paste-category={row.category}>
                                        <FormControlLabel
                                            control={<Checkbox checked={importSelections[row.category]}
                                                onChange={() => handleSelectionChange(row.category)} disabled={row.incoming === 0}
                                                slotProps={{ input: { 'aria-describedby': `paste-${row.category}-counts` } }} />}
                                            label={`${title} (${row.incoming})${row.category === 'drills' && pendingImport.miningProductivityLevel !== undefined ? ` - Mining Productivity ${pendingImport.miningProductivityLevel}` : ''}`}
                                        />
                                        <Typography id={`paste-${row.category}-counts`} variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                                            {consequence}
                                        </Typography>
                                    </Box>
                                );
                            })}
                            {!!preview?.crossings.length && (
                                <>
                                    <Alert severity="warning" role="region" aria-label="Cross-category references">
                                        <Typography variant="body2">These parts will be combined using their entity numbers. A matching number can refer to a different entity.</Typography>
                                        <Box component="ul" sx={{ pl: 2.5, mb: 0 }}>
                                            {preview.crossings.map(warning => (
                                                <li key={`${warning.ownerType}-${warning.ownerId}-${warning.slot}`}>
                                                    {crossingText(warning)}
                                                </li>
                                            ))}
                                        </Box>
                                    </Alert>
                                    <FormControlLabel
                                        control={<Checkbox checked={acknowledgedCurrent} onChange={(_, checked) => setAcknowledged(checked ? {
                                            incoming: pendingImport, current: currentForm, selections: importSelections,
                                        } : null)} />}
                                        label="I understand these parts will be combined using their entity numbers."
                                    />
                                </>
                            )}
                            <Box component="details" data-import-assumptions sx={{ mt: 1 }}>
                                <Typography component="summary" variant="body2" sx={{ cursor: 'pointer', fontWeight: 600 }}>Import details and defaults</Typography>
                                <Typography variant="body2">{preview?.counts.find(row => row.category === 'inserters')?.replacing ? 'Incoming' : 'Retained'} inserters; {preview?.counts.find(row => row.category === 'machines')?.replacing ? 'incoming' : 'retained'} machines. Target and Copies {importSelections.target && pendingImport.fill ? 'come from this export' : 'stay as entered'} ({prospectiveTarget.copies} {prospectiveTarget.copies === 1 ? 'copy' : 'copies'}). The current belt-movement setting is retained.</Typography>
                                <InserterAssumptions inserters={prospectiveInserters} />
                                <Box sx={{ mt: 1 }}>
                                    <InserterAssumptions inserters={prospectiveInserters} detailed />
                                    {prospectiveInserters.flatMap((inserter, i) => inserter.sink.type === 'belt' && inserter.sink.drop
                                        ? [<Typography key={`drop-${i}`} variant="body2">Inserter {inserter.id ?? i + 1}: imported drop on Belt {inserter.sink.id}, lane {inserter.sink.drop.lane}, position {inserter.sink.drop.position} (read-only).</Typography>] : [])}
                                    {prospectiveMachines.flatMap(machine => machine.fuel === undefined ? [] : [<Typography key={`fuel-${machine.id}`} variant="body2" title={nameWithId(itemLabel(machine.fuel), machine.fuel)}>Machine {machine.id}: imported fuel {itemLabel(machine.fuel)} (read-only).</Typography>])}
                                    {currentForm.overrides && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Retained run overrides: {JSON.stringify(currentForm.overrides)}.</Typography>}
                                </Box>
                            </Box>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelImport} color="inherit">Cancel</Button>
                    <Button
                        id="confirm-factorio-import"
                        onClick={handleConfirmImport}
                        variant={forceFullImport ? 'outlined' : 'contained'}
                        color={forceFullImport ? 'inherit' : 'secondary'}
                        disabled={!canImport}
                    >
                        {pendingImport?.reduction ? 'Import simpler build' : forceFullImport ? 'Force import full pasted build' : 'Import Selected'}
                    </Button>
                </DialogActions>
            </Dialog>

            {pasteDialog && (
                <PasteFromFactorioDialog
                    key={pasteDialog.session}
                    prompt={pasteDialog.prompt}
                    promptId={pasteDialog.id}
                    onSubmit={handlePasteSubmit}
                    onClose={handleClosePasteDialog}
                />
            )}
            {examplesOpen && <ExamplesDialog onPick={handlePickExample} onClose={handleCloseExamples} />}

            {/* the browser did not let the page copy: the link to copy by hand */}
            <Dialog open={fallbackLink !== null} onClose={() => setFallbackLink(null)} maxWidth="sm" fullWidth aria-describedby="share-link-fallback-text">
                <DialogTitle>Share link</DialogTitle>
                <DialogContent>
                    <Typography id="share-link-fallback-text" variant="body2" sx={{ mb: 1 }}>
                        {SHARE_FALLBACK_TEXT}
                    </Typography>
                    <TextField
                        value={fallbackLink ?? ''}
                        label="Share link"
                        fullWidth
                        autoFocus
                        onFocus={(event) => event.target.select()}
                        slotProps={{ htmlInput: { readOnly: true } }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setFallbackLink(null)} color="inherit">Close</Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
