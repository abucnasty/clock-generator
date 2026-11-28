import { canonicalRate, configFormatProblem, withConfigFormat } from 'clock-generator/light';
import { Check, Download, Upload, ContentPaste, MoreVert, RestartAlt, Science, MenuBook, Link, DarkModeOutlined, LightModeOutlined, BrightnessAutoOutlined, Tune } from '@mui/icons-material';
import { Box, Button, Alert, Tooltip, FormControlLabel, Checkbox, Typography, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Divider, TextField, useMediaQuery, useTheme } from '@mui/material';
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
import { isBuildFile } from '../utils/sidecarExport';
import { INTRO_BUTTONS, openFileProblem, PASTE_PROMPTS, type PastePrompt } from '../utils/sidecarGuide';
import { maximumTargetNote, NO_TARGET_NOTE, replacesTargetNote, targetRowCaption, targetRowLabel, targetToFill, type TargetValues } from '../utils/pasteTarget';
import type { ExampleBuild } from '../utils/exampleBuilds';
import { focusSetpointHeading } from '../utils/introCard';
import type { ConfigFormData } from '../utils/configForm/formData';
import { applyPaste, pastePreview, type ImportSelections, type PasteReferenceWarning } from '../utils/pastePreview';
import { InserterDetails } from './InserterDetails';
import { Disclosure } from './Disclosure';
import { chestTypesText } from '../utils/pasteText';
import { entityLabel, nameInSentence } from '../utils/entityLabel';
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
import { refusedConfigOf, type PastedEntities } from '../worker/types';
import { AppDialog } from './AppDialog';
import { RefusedConfigDialog, type RefusedKind } from './RefusedConfigDialog';
import { PasteFromFactorioDialog } from './PasteFromFactorioDialog';
import { ExamplesDialog } from './ExamplesDialog';
import { ImportSimplification } from './ImportSimplification';
import { importReduction, type ImportReduction } from '../utils/importReduction';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { PickupGeometrySummary } from './PickupGeometrySummary';
import { BlueprintImportPanel, BlueprintMachineValues, BlueprintNotes, BlueprintSetpointRow, type MachineOverrides } from './BlueprintImportPanel';
import { BLUEPRINT_FAILED_PROMPT, BLUEPRINT_PROMPTS, isJsonText } from '../utils/blueprintPaste';
import { openProfileStore, TEMPLATES } from '../utils/researchProfiles';
import { pageStorage, researchChoiceOf } from '../utils/researchLine';
import type { ImportInputs } from 'clock-generator/browser';
import type { PastedBlueprint } from '../worker/types';

const SAVED_MESSAGE = 'Build saved to a file.';
const TARGET_CAPTION_ID = 'paste-target-caption';
const TARGET_MAXIMUM_ID = 'paste-target-maximum';
const EXAMPLE_FAILED_MESSAGE = 'Could not load the example. Check your connection and try again.';
const freshImportSelections = (): ImportSelections => ({ target: false, machines: true, drills: true, inserters: true, belts: true, chests: true });

/**
 * A pasted blueprint while the confirm dialog is open: the text, what the user chose and typed, and the import's last
 * answer for them. The import is asked again after each answer and each change of the profile, the setpoint item or copies.
 */
interface BlueprintSession {
    text: string;
    answers: Readonly<Record<string, string>>;
    profileId: string;
    setpoint: TargetValues;
    overrides: MachineOverrides;
    /** The setpoint is the import's suggestion, which follows each answer, until the user types one */
    suggested: boolean;
    pasted: PastedBlueprint;
    /** The last ask failed: the dialog says so and imports nothing */
    failed: boolean;
}
const THEME_CHOICES = [
    { scheme: 'dark', label: 'Theme: Dark', icon: DarkModeOutlined },
    { scheme: 'light', label: 'Theme: Light', icon: LightModeOutlined },
    { scheme: 'system', label: 'Theme: Auto (device)', icon: BrightnessAutoOutlined },
] satisfies { scheme: DisplayScheme; label: string; icon: typeof DarkModeOutlined }[];

/** JSON that parses and is not a build file: an export of the Sidecar mod, which the site no longer reads */
function isSidecarExportText(text: string): boolean {
    try {
        return !isBuildFile(JSON.parse(text));
    } catch {
        return false;
    }
}

/** Describe the destination of this exact preview without suggesting a silent rebind or renumber. */
function crossingText(warning: PasteReferenceWarning): string {
    const imported = warning.direction === 'incoming-to-retained';
    return `${imported ? 'Imported' : 'Retained'} ${entityLabel(warning.ownerType, warning.ownerId)} ${warning.slot}`
        + ` → ${imported ? 'retained' : 'imported'} ${entityLabel(warning.endpointType, warning.endpointId)}`
        + (warning.destinationExists ? '.' : ' (missing from the resulting build).');
}

interface PendingImport extends PastedEntities {
    /** Set for a pasted blueprint */
    blueprint?: BlueprintSession;
    original?: PendingImport;
    reduction?: ImportReduction;
    repeatedSourceKey?: string;
    originalSelections?: ImportSelections;
    /** The Target Output the paste can fill in, and where it came from; null when it could not tell */
    fill: { values: TargetValues; source: SuggestedTarget['source']; beltLimit?: SuggestedTarget['belt_limit'];
        buildLimit?: SuggestedTarget['build_limit'] } | null;
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
    onImport: (config: Config, prototypeSource?: 'sample') => void;
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
    /** Opens the research profiles; the menu shows its item only when this is given */
    onOpenResearchProfiles?: () => void;
    /** The items a question of a pasted blueprint and its setpoint can name */
    itemNames?: string[];
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
    renderControls, onInstall, onCheckOnly, checkDisabled, onOpenResearchProfiles, itemNames = [],
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
    // the last ask of a pasted blueprint is out: the preview still holds the answer of the ask before it
    const [blueprintAskOut, setBlueprintAskOut] = useState(false);
    // the panel of a pasted blueprint shows the layout once a question was asked, so the dialog is wider then
    const blueprintAsked = pendingImport?.blueprint !== undefined && !pendingImport.reduction
        && (pendingImport.blueprint.pasted.questions.length > 0 || Object.keys(pendingImport.blueprint.answers).length > 0);
    // a pasted blueprint imports nothing while a question is open, after its last ask failed, or while its last ask is out
    const blueprintOpen = pendingImport?.blueprint !== undefined && (pendingImport.blueprint.pasted.questions.length > 0 || pendingImport.blueprint.failed || blueprintAskOut);
    const canImport = hasImportWork && !blueprintOpen && !preview?.geometryProblem && (!preview?.crossings.length || acknowledgedCurrent);

    // Simplification can replace a complete import, never a category the user chose to retain.
    const canSimplify = pendingImport && !pendingImport.reduction && canImport && pendingImport.fill && prospectiveTarget.item !== ''
        && preview?.counts.every(row => (row.incoming === 0 || row.replacing) && (row.current === 0 || row.replacing));
    let simplificationConfig: Config | null = null;
    if (canSimplify && pendingImport) {
        const base = formDataToConfig(currentForm);
        simplificationConfig = {
            ...base,
            setpoint: prospectiveTarget,
            machines: pendingImport.machines,
            inserters: pendingImport.inserters,
            belts: pendingImport.belts,
            chests: pendingImport.chests,
            ...(pendingImport.drills.length > 0 && { drills: { configs: pendingImport.drills } }),
        };
    }

    const forceFullImport = simplificationConfig !== null && pendingImport?.repeatedSourceKey === JSON.stringify(canonicalRate(simplificationConfig));

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
        setBlueprintAskOut(false);
        setPasteDialog(null);
        setAcknowledged(null);
        setImportSelections(freshImportSelections());
    }, []);
    // what had the focus when the confirm dialog opened, for it to go back to; see handleConfirmExited
    const confirmOpenerRef = useRef<Element | null>(null);
    const [examplesOpen, setExamplesOpen] = useState(false);

    const handleExport = useCallback(() => {
        if (!config) return;
        const jsonString = JSON.stringify(withConfigFormat(canonicalRate(config)), null, 2);
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

    // a file, paste or example whose configuration the site does not read: the message, with Paste a blueprint
    const [refused, setRefused] = useState<RefusedKind | null>(null);
    const closeRefused = useCallback(() => setRefused(null), []);

    /** Replaces the build with the one a build file holds; throws when the text is not one; refuses one of another format */
    const importConfigText = useCallback(async (text: string, undoMessage: string, prototypeSource?: 'sample') => {
        // values out of bounds are kept, for the form to show; only a broken file is rejected
        let parsedConfig: Config;
        try {
            parsedConfig = await askEngine({ kind: 'config-file', config: readConfigFile(text) });
        } catch (error) {
            const refusal = refusedConfigOf(error);
            if (refusal === null) throw error;
            setRefused(refusal);
            return;
        }
        // its Undo message says what replaced the build
        onUndoable(undoMessage);
        onImport(parsedConfig, prototypeSource);
        onBuildReplaced();
    }, [onImport, onBuildReplaced, onUndoable]);

    // the research profiles, for the chooser of a pasted blueprint; the choice is remembered
    const [profileStore] = useState(() => openProfileStore(pageStorage));
    const blueprintAskRef = useRef(0);
    const askBlueprint = useCallback((session: Pick<BlueprintSession, 'text' | 'answers' | 'profileId' | 'setpoint'>) => {
        const entry = profileStore.find(session.profileId) ?? profileStore.find(TEMPLATES[0].id)!;
        const research: ImportInputs['research'] = researchChoiceOf(entry);
        return askEngine({ kind: 'pasted-blueprint', text: session.text, inputs: {
            research, answers: session.answers, setpoint: { ...(session.setpoint.item !== '' && { item: session.setpoint.item }), copies: session.setpoint.copies },
        } });
    }, [profileStore]);

    /** What the confirm dialog shows of a pasted blueprint: its lists, with the values the user typed over */
    const pendingOf = useCallback((session: BlueprintSession): PendingImport => {
        const { pasted } = session;
        const numberOf = new Map(pasted.entities.flatMap(entity => entity.row?.list === 'machines' ? [[entity.row.id, entity.entity_number] as const] : []));
        const machines = pasted.machines.map(machine => {
            const typed = session.overrides[numberOf.get(machine.id) ?? -1];
            return typed ? { ...machine, ...typed } : machine;
        });
        const suggestion = Option.toNullable(pasted.suggested_target);
        const values: TargetValues = { ...session.setpoint, ...(pasted.copy_offset !== null && { copy_offset: { ...pasted.copy_offset } }) };
        return {
            ...pasted, machines, blueprint: session,
            fill: session.setpoint.item === '' ? null : { values, source: suggestion?.source ?? 'inferred',
                ...(suggestion?.belt_limit !== undefined && { beltLimit: suggestion.belt_limit }),
                ...(suggestion?.build_limit !== undefined && { buildLimit: suggestion.build_limit }) },
        };
    }, []);

    /**
     * Asks the import for the session's inputs. While the setpoint is the import's suggestion (the user's build had none and
     * the user typed none), it follows the suggestion, which an answer can change, and the import is asked once more with
     * its item, which can settle a drill's ore.
     */
    const settle = useCallback(async (session: Omit<BlueprintSession, 'pasted' | 'failed'>): Promise<{ session: Omit<BlueprintSession, 'pasted' | 'failed'>; answer: Awaited<ReturnType<typeof askBlueprint>> }> => {
        const answer = await askBlueprint(session);
        if (answer.kind !== 'build' || !session.suggested) return { session, answer };
        const suggestion = Option.toNullable(answer.suggested_target);
        if (suggestion === null) return { session, answer };
        const filled = targetToFill(suggestion);
        const setpoint = { item: filled.item, items_per_second: filled.items_per_second, copies: session.setpoint.copies };
        const moved = { ...session, setpoint };
        return setpoint.item === session.setpoint.item ? { session: moved, answer } : { session: moved, answer: await askBlueprint(moved) };
    }, [askBlueprint]);

    /** Reads a pasted blueprint through the import and opens the confirm dialog for it, or says why it could not */
    const startBlueprintPaste = useCallback(async (text: string, request: number): Promise<PastePrompt | null> => {
        // the profiles as the profiles dialog left them
        profileStore.reload();
        const lastUsed = profileStore.snapshot().lastUsed;
        const profileId = lastUsed !== null && profileStore.find(lastUsed) ? lastUsed : TEMPLATES[0].id;
        const suggested = currentTarget.item === '';
        const asked = { text, answers: {}, profileId, overrides: {}, suggested,
            setpoint: { item: currentTarget.item, items_per_second: currentTarget.items_per_second, copies: currentTarget.copies } };
        const ask = ++blueprintAskRef.current;
        let settled: Awaited<ReturnType<typeof settle>>;
        try {
            settled = await settle(asked);
        } catch (error) {
            if (request !== pasteRequestRef.current) return null;
            console.error('Blueprint paste error:', error);
            return BLUEPRINT_FAILED_PROMPT;
        }
        if (request !== pasteRequestRef.current || ask !== blueprintAskRef.current) return null;
        const { answer } = settled;
        if (answer.kind === 'problem') return BLUEPRINT_PROMPTS[answer.problem];
        confirmOpenerRef.current = document.activeElement;
        setBlueprintAskOut(false);
        setPendingImport(pendingOf({ ...settled.session, pasted: answer, failed: false }));
        // everything there is; the setpoint only where the user's build has none
        setImportSelections({ target: suggested, machines: true, drills: true, inserters: true, belts: true, chests: true });
        return null;
    }, [settle, currentTarget, pendingOf, profileStore]);

    /** A change in the dialog of a pasted blueprint; the import is asked again where the change can move what it gives */
    const changeBlueprint = useCallback((change: Partial<Pick<BlueprintSession, 'answers' | 'profileId' | 'setpoint' | 'overrides'>>) => {
        const current = pendingImport?.blueprint;
        if (!current) return;
        // a setpoint the user typed is theirs: it no longer follows the suggestion
        const next: BlueprintSession = { ...current, ...change, ...(change.setpoint && { suggested: false }) };
        if (change.setpoint) setImportSelections(selections => selections.target ? selections : { ...selections, target: true });
        const asks = change.answers !== undefined || change.profileId !== undefined
            || (change.setpoint !== undefined && (change.setpoint.item !== current.setpoint.item || change.setpoint.copies !== current.setpoint.copies));
        setPendingImport(pendingOf(next));
        if (!asks) return;
        const ask = ++blueprintAskRef.current;
        const request = pasteRequestRef.current;
        setBlueprintAskOut(true);
        // what the user changed since the ask started (a rate, an override) is in the live session, not in the one the ask began with
        const keepTyped = (answered: BlueprintSession) => (previous: PendingImport | null): PendingImport => {
            const live = previous?.blueprint;
            if (!live) return pendingOf(answered);
            // the rate follows the suggestion only while the live setpoint still does
            const rate = live.suggested ? answered.setpoint.items_per_second : live.setpoint.items_per_second;
            return pendingOf({ ...answered, overrides: live.overrides, suggested: live.suggested, setpoint: { ...answered.setpoint, items_per_second: rate } });
        };
        const failed = (previous: PendingImport | null): PendingImport => pendingOf({ ...(previous?.blueprint ?? next), failed: true });
        settle(next).then(({ session, answer }) => {
            if (ask !== blueprintAskRef.current || request !== pasteRequestRef.current) return;
            setBlueprintAskOut(false);
            setPendingImport(answer.kind === 'build' ? keepTyped({ ...session, pasted: answer, failed: false }) : failed);
        }, error => {
            if (ask !== blueprintAskRef.current || request !== pasteRequestRef.current) return;
            console.error('Blueprint paste error:', error);
            setBlueprintAskOut(false);
            setPendingImport(failed);
        });
    }, [pendingImport, pendingOf, settle]);

    /**
     * Reads a paste and opens the confirm dialog for it: a blueprint goes through the import; JSON is a build file, to open
     * with Open, or an export of the Sidecar mod, which gets its message. Returns why it could not, for the Paste from
     * Factorio dialog to say, or null once the confirm dialog or a message is open.
     */
    const startPaste = useCallback(async (text: string, request = ++pasteRequestRef.current): Promise<PastePrompt | null> => {
        if (request !== pasteRequestRef.current) return null;
        if (text.trim() === '') return PASTE_PROMPTS.empty;
        if (!isJsonText(text)) return startBlueprintPaste(text.trim(), request);
        // a build file of another format is refused here as when it is opened; one of this format is opened with Open
        let value: unknown;
        try {
            value = JSON.parse(text);
        } catch {
            value = undefined;
        }
        const format = isBuildFile(value) ? configFormatProblem(value) : null;
        if (format !== null) {
            setRefused(format);
            return null;
        }
        // a build file of this format is opened with Open; any other JSON is an export of the Sidecar mod, no longer read
        if (value === undefined) return PASTE_PROMPTS['not-json'];
        if (isBuildFile(value)) return PASTE_PROMPTS['build-file'];
        setRefused('sidecar');
        return null;
    }, [startBlueprintPaste]);

    const handleFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const input = event.target;
            const file = input.files?.[0];
            if (!file) return;
            closeLastError();

            try {
                const content = await file.text();
                if (!isJsonText(content)) {
                    // a blueprint saved to a file goes to the paste
                    const prompt = await startPaste(content);
                    if (prompt) {
                        showPastePrompt(prompt);
                    }
                } else if (isSidecarExportText(content)) {
                    setRefused('sidecar');
                } else {
                    await importConfigText(content, UNDO_IMPORT_MESSAGE);
                }
            } catch (error) {
                console.error('Open configuration file error:', error);
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
            await importConfigText(await response.text(), exampleUndoMessage(example, recipeLabel), 'sample');
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
        if (fill !== null) parts.unshift('Setpoint');
        const blueprint = pendingImport.blueprint;
        if (blueprint && (blueprint.pasted.questions.length > 0 || blueprint.failed || blueprintAskOut)) return;
        const next = applyPaste(currentForm, pendingImport, importSelections, fill?.values,
            blueprint ? { research: blueprint.pasted.research, copy_offset: blueprint.pasted.copy_offset } : undefined);

        resetPasteFlow();

        // one Undo for the whole paste, taken before any of it is applied; its message says what was imported
        onUndoable(describePaste(parts));
        onApplyPaste(next);
        onBuildReplaced();
    }, [pendingImport, importSelections, currentForm, acknowledgedCurrent, blueprintAskOut, onApplyPaste, onBuildReplaced, onUndoable, resetPasteFlow]);

    const handleCancelImport = resetPasteFlow;

    // the dialog puts the focus back itself: on its opener, unless an import took that off the page (the intro card's
    // Paste button, or the paste box), then on the Target Output heading rather than the page's body
    const handleConfirmExited = useCallback(() => {
        const opener = confirmOpenerRef.current;
        confirmOpenerRef.current = null;
        if (opener instanceof HTMLElement && opener.isConnected) {
            opener.focus();
        } else {
            focusSetpointHeading();
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

    const handleMenuResearchProfiles = useCallback(() => {
        handleMenuClose();
        onOpenResearchProfiles?.();
    }, [handleMenuClose, onOpenResearchProfiles]);

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
                    <ListItemText>Open configuration file…</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleMenuExport} disabled={!config}>
                    <ListItemIcon>
                        <Download fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Save configuration file</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleMenuShare} disabled={!config}>
                    <ListItemIcon>
                        <Link fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Copy share link</ListItemText>
                </MenuItem>
                {onOpenResearchProfiles && <MenuItem onClick={handleMenuResearchProfiles}>
                    <ListItemIcon>
                        <Tune fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Research profiles…</ListItemText>
                </MenuItem>}
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
                    <ListItemText>Reset configuration</ListItemText>
                </MenuItem>
            </Menu>

            <input
                ref={fileInputRef}
                type="file"
                accept=".json,.txt,application/json,text/plain"
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />

            {/* Import Confirmation Dialog */}
            <AppDialog open={pendingImport !== null} maxWidth={blueprintAsked ? 'md' : undefined} onClose={handleCancelImport} title="Confirm Import from Factorio" disableRestoreFocus onExited={handleConfirmExited}
                cancel="Cancel" actions={<Button
                    id="confirm-factorio-import"
                    onClick={handleConfirmImport}
                    variant={forceFullImport ? 'outlined' : 'contained'}
                    color={forceFullImport ? 'inherit' : 'secondary'}
                    disabled={!canImport}
                >
                    {pendingImport?.reduction ? 'Import simpler build' : forceFullImport ? 'Force import full pasted build' : 'Import Selected'}
                </Button>}>
                <Typography variant="body2" sx={{ mb: 2 }}>
                    Choose what to import. Selected parts replace those in your current build; unselected parts stay as they are.
                </Typography>
                
                {pendingImport?.guidance && Option.match(
                    () => null,
                    (message: string) => <Alert severity="warning" sx={{ mb: 2 }}>{message}</Alert>,
                )(pendingImport.guidance)}

                {pendingImport && <ImportSimplification config={simplificationConfig} applied={pendingImport.reduction}
                    onRepeated={sourceKey => {
                        if (simplificationConfig && sourceKey === JSON.stringify(canonicalRate(simplificationConfig)) && pendingImport.repeatedSourceKey !== sourceKey)
                            setPendingImport(current => current === pendingImport ? { ...current, repeatedSourceKey: sourceKey } : current);
                    }}
                    onRestore={() => {
                        if (pendingImport.original) setPendingImport(pendingImport.original);
                        if (pendingImport.originalSelections) setImportSelections(pendingImport.originalSelections);
                    }}
                    onSimplify={plan => {
                        if (!simplificationConfig || plan.sourceConfigKey !== JSON.stringify(canonicalRate(simplificationConfig))) return;
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
                            fill: { ...pendingImport.fill!, values: candidate.setpoint },
                        });
                        // The explicit simplify action also accepts its displayed Copies change.
                        setImportSelections(current => ({ ...current, target: true }));
                    }} />}
                {pendingImport?.blueprint?.failed && <Alert severity="error" sx={{ mb: 2 }}>{BLUEPRINT_FAILED_PROMPT.text}</Alert>}
                {pendingImport?.blueprint && !pendingImport.reduction && (
                    <BlueprintImportPanel pasted={pendingImport.blueprint.pasted}
                        profiles={profileStore.entries()} profileId={pendingImport.blueprint.profileId}
                        onProfileChange={id => { profileStore.select(id); changeBlueprint({ profileId: id }); }}
                        answers={pendingImport.blueprint.answers}
                        onAnswer={(key, value) => changeBlueprint({ answers: { ...pendingImport.blueprint!.answers, [key]: value } })}
                        itemNames={itemNames} />
                )}
                {pendingImport && !pendingImport.reduction && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <PickupGeometrySummary build={{ inserters: prospectiveInserters }} backedUp={null} />
                        {preview?.geometryProblem && <Alert severity="error">{preview.geometryProblem}</Alert>}
                        {pendingImport.fill || pendingImport.blueprint ? (
                            <Box>
                                {pendingImport.blueprint
                                    ? <BlueprintSetpointRow setpoint={pendingImport.blueprint.setpoint} onSetpointChange={setpoint => changeBlueprint({ setpoint })} itemNames={itemNames}
                                        checked={importSelections.target} onToggle={() => handleSelectionChange('target')}
                                        describedBy={pendingImport.fill ? (maximumTargetNote(pendingImport.fill.source) ? `${TARGET_CAPTION_ID} ${TARGET_MAXIMUM_ID}` : TARGET_CAPTION_ID) : undefined} />
                                    : pendingImport.fill && <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={importSelections.target}
                                                onChange={() => handleSelectionChange('target')}
                                                slotProps={{ input: { 'aria-describedby': maximumTargetNote(pendingImport.fill.source) ? `${TARGET_CAPTION_ID} ${TARGET_MAXIMUM_ID}` : TARGET_CAPTION_ID } }}
                                            />
                                        }
                                        label={targetRowLabel(pendingImport.fill.values, recipeLabel)}
                                    />}
                                {pendingImport.fill && <>
                                    <Typography id={TARGET_CAPTION_ID} variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                                        {targetRowCaption(pendingImport.fill.source, pendingImport.fill.beltLimit, pendingImport.fill.buildLimit)}
                                        {currentTarget.item !== '' && ` ${replacesTargetNote(currentTarget, recipeLabel)}`}
                                    </Typography>
                                    {maximumTargetNote(pendingImport.fill.source) && <Typography id={TARGET_MAXIMUM_ID} variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                                        {maximumTargetNote(pendingImport.fill.source)}
                                    </Typography>}
                                </>}
                                {!pendingImport.fill && currentTarget.item === '' && <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                                    {NO_TARGET_NOTE}
                                </Typography>}
                            </Box>
                        ) : (
                            currentTarget.item === '' && (
                                <Typography variant="body2" color="text.secondary">
                                    {NO_TARGET_NOTE}
                                </Typography>
                            )
                        )}
                        {preview?.counts.map(row => {
                            const title = row.category[0].toUpperCase() + row.category.slice(1);
                            const counted = row.replacing
                                ? `${row.current} in your build → ${row.incoming} after import.`
                                : row.incoming === 0 ? row.current === 0 ? 'None in this export.' : `None in this export. Your ${row.current} stay unchanged.`
                                    : `Not selected. Keep the ${row.current} in your build.`;
                            // the chests are named by what they are: a car and an infinity chest are both "chests" here
                            const consequence = row.category === 'chests' && row.incoming > 0 ? `${chestTypesText(pendingImport.chests)}. ${counted}` : counted;
                            return (
                                <Box key={row.category} data-paste-category={row.category}>
                                    <FormControlLabel
                                        control={<Checkbox checked={importSelections[row.category]}
                                            onChange={() => handleSelectionChange(row.category)} disabled={row.incoming === 0}
                                            slotProps={{ input: { 'aria-describedby': `paste-${row.category}-counts` } }} />}
                                        label={`${title} (${row.incoming})`}
                                    />
                                    <Typography id={`paste-${row.category}-counts`} variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                                        {consequence}
                                    </Typography>
                                    {row.category === 'machines' && row.replacing && pendingImport.blueprint
                                        && <BlueprintMachineValues pasted={pendingImport.blueprint.pasted} machines={pendingImport.machines}
                                            onOverride={(number, field, value) => changeBlueprint({ overrides: { ...pendingImport.blueprint!.overrides,
                                                [number]: { ...pendingImport.blueprint!.overrides[number], [field]: value } } })} />}
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
                        <Disclosure summary="Import details" data-import-assumptions="" sx={{ mt: 1 }}>
                            <Box sx={{ mt: 1 }}>
                                <InserterDetails inserters={prospectiveInserters} />
                                {prospectiveInserters.flatMap((inserter, i) => inserter.sink.type === 'belt' && inserter.sink.drop
                                    ? [<Typography key={`drop-${i}`} variant="body2">Inserter {inserter.id ?? i + 1}: imported drop on Belt {inserter.sink.id}, lane {inserter.sink.drop.lane}, position {inserter.sink.drop.position} (read-only).</Typography>] : [])}
                                {prospectiveMachines.flatMap(machine => machine.fuel === undefined ? [] : [<Typography key={`fuel-${machine.id}`} variant="body2" title={nameWithId(itemLabel(machine.fuel), machine.fuel)}>Machine {machine.id}: imported fuel {nameInSentence(itemLabel(machine.fuel))} (read-only).</Typography>])}
                                {currentForm.overrides && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Retained run overrides: {JSON.stringify(currentForm.overrides)}.</Typography>}
                            </Box>
                        </Disclosure>
                        {pendingImport.blueprint && <BlueprintNotes pasted={pendingImport.blueprint.pasted} />}
                    </Box>
                )}
            </AppDialog>

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
            <RefusedConfigDialog kind={refused} onPaste={handlePasteFromFactorio} onClose={closeRefused} />

            {/* the browser did not let the page copy: the link to copy by hand */}
            <AppDialog open={fallbackLink !== null} onClose={() => setFallbackLink(null)} title="Share link" describedBy="share-link-fallback-text" cancel="Close">
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
            </AppDialog>
        </>
    );
}
