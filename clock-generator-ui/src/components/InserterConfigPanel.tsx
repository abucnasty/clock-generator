import { effectiveInserterStackSize } from '../utils/inserterMetadata';
import {
    Box,
    Chip,
    Tab,
    Tabs,
    Typography,
} from '@mui/material';
import { EnableControlMode } from 'clock-generator/light';
import { useId, useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAnnounce } from '../hooks/useMessages';
import { blockedSummaryOf } from '../utils/ruleProblems';
import type {
    BeltFormData,
    ChestFormData,
    InserterFormData,
    MachineFormData,
} from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { describeEnableRule } from '../utils/enableRuleLabel';
import { entityLabel } from '../utils/entityLabel';
import { inferInserterItems, itemsAround } from '../utils/inferInserterItems';
import { InserterEditor } from './InserterEditor';
import { DraftFooter } from './DraftFooter';
import { changedConfigFields } from '../utils/inserterDraft';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { EnableControlFormContent, type CopyFromOption, type EnableControlFormState } from './EnableControlModal';

// ---- Panel props ----

interface InserterConfigPanelProps {
    inserter: InserterFormData;
    entityIndex: number;
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    itemNames: string[];
    getRecipeInfo: (name: string) => RecipeInfo | null;
    /** Called once, on Save, with the changed fields */
    onUpdate: (index: number, updates: Partial<InserterFormData>) => void;
    /** Closes the dialog the panel is in: after Save, and on Cancel */
    onClose: () => void;
    /** Cancel asks the parent to discard a dirty draft. */
    onCancel?: () => void;
    /** Told whether either tab has unsaved changes; pass a stable function (a state setter) */
    onDirtyChange?: (dirty: boolean) => void;
}

// ---- Tab label with the unsaved mark ----

/** The tab's text, then "•" when it holds unsaved edits; the tab's name says so in words ("Overrides, unsaved changes") */
function TabLabel({ text, unsaved }: { text: string; unsaved: boolean }) {
    if (!unsaved) return <span>{text}</span>;
    // the whole name in one hidden span: next to the visible text, Chrome would put a space before its comma
    return (
        <span>
            <span aria-hidden>
                {text}
                <Box component="span" sx={{ ml: 0.5 }}>•</Box>
            </span>
            <Box component="span" sx={VISUALLY_HIDDEN}>{text}, unsaved changes</Box>
        </span>
    );
}

// ---- Exported panel ----

/**
 * The diagram's inserter editor: a Config tab and an Overrides (rule) tab that make one form. Both edit a draft, which
 * reaches the config only on Save; Cancel drops it. Both tabs stay mounted, so switching between them loses nothing.
 */
export function InserterConfigPanel({
    inserter,
    entityIndex,
    machines,
    inserters,
    belts,
    chests,
    itemNames,
    getRecipeInfo,
    onUpdate,
    onClose,
    onCancel,
    onDirtyChange,
}: InserterConfigPanelProps) {
    const id = useId();
    const [activeTab, setActiveTab] = useState(0);
    const [draft, setDraft] = useState(inserter);
    const announce = useAnnounce();
    // whether Save was pressed while the rule had problems: the bar says why until they are fixed
    const [saveRefused, setSaveRefused] = useState(false);
    // raised on each refused Save, so that the rule form shows every problem
    const [revealProblems, setRevealProblems] = useState(0);
    const [rule, setRule] = useState<EnableControlFormState>({ override: inserter.overrides?.enable_control, changed: false, problems: [] });

    // the tab's chip shows the saved rule, in the words of the List row's chip
    const currentOverride = inserter.overrides?.enable_control;
    const savedRule = describeEnableRule(currentOverride, { forcedAlways: inserter._forced_always });

    const availableItems = useMemo(() => itemsAround(draft, machines, belts, chests, getRecipeInfo), [draft, machines, belts, chests, getRecipeInfo]);

    // the items the inserter moves: its filters, else what the game would pick; a template's item picker starts on them
    const movedItems = useMemo<string[]>(() => {
        const filters = draft.filters?.filter(Boolean) ?? [];
        return filters.length > 0 ? filters : inferInserterItems(draft, machines, belts, chests, getRecipeInfo);
    }, [draft, machines, belts, chests, getRecipeInfo]);

    const copyFromOptions = useMemo<CopyFromOption[]>(() => {
        return inserters
            .filter(ins =>
                ins.id !== inserter.id &&
                ins.overrides?.enable_control?.mode &&
                ins.overrides.enable_control.mode !== EnableControlMode.AUTO,
            )
            .map(ins => ({
                label: entityLabel('inserter', ins.id),
                override: ins.overrides!.enable_control!,
            }));
    }, [inserter.id, inserters]);

    const changedFields = useMemo(() => changedConfigFields(draft, inserter), [draft, inserter]);
    const configDirty = Object.keys(changedFields).length > 0;
    const dirty = rule.changed || configDirty;

    // a layout effect, like the rule form's, so that an Esc right after an edit already asks
    useLayoutEffect(() => {
        onDirtyChange?.(dirty);
        return () => onDirtyChange?.(false);
    }, [dirty, onDirtyChange]);

    const handleDraftUpdate = (updates: Partial<InserterFormData>) => {
        setDraft(d => ({ ...d, ...updates }));
    };

    // one update with what changed; the overrides only when the rule did, so an untouched rule (a forced ALWAYS
    // included) stays as it is
    const handleSave = () => {
        // a rule with problems is not saved: the Enable rule tab shows, its first problem takes the focus, and the bar
        // and the polite region say why
        if (rule.problems.length > 0) {
            flushSync(() => {
                setActiveTab(1);
                setSaveRefused(true);
                setRevealProblems((n) => n + 1);
            });
            document.getElementById(rule.problems[0].fieldId)?.focus();
            announce(blockedSummaryOf(rule.problems));
            return;
        }
        const updates: Partial<InserterFormData> = { ...changedFields };
        if (rule.changed) {
            updates.overrides = { ...inserter.overrides, enable_control: rule.override };
        }
        onUpdate(entityIndex, updates);
        onClose();
    };

    return (
        <Box>
            <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
            >
                {/* a tab with unsaved edits is marked "•" (its chip still shows the saved rule) */}
                <Tab
                    label={<TabLabel text="Config" unsaved={configDirty} />}
                    id={`${id}-tab-0`}
                    aria-controls={`${id}-tabpanel-0`}
                />
                <Tab
                    label={<TabLabel text="Enable rule" unsaved={rule.changed} />}
                    id={`${id}-tab-1`}
                    aria-controls={`${id}-tabpanel-1`}
                    iconPosition="end"
                    icon={
                        savedRule.quiet
                            ? undefined
                            : <Chip label={savedRule.chip} title={savedRule.summary} size="small" color="primary" sx={{ fontSize: '0.7rem' }} />
                    }
                />
            </Tabs>

            {/* both tabs stay mounted, so a draft on one survives a visit to the other */}
            <Box role="tabpanel" id={`${id}-tabpanel-0`} aria-labelledby={`${id}-tab-0`} hidden={activeTab !== 0} sx={{ p: 2 }}>
                <InserterEditor
                    value={draft}
                    label={entityLabel('inserter', inserter.id)}
                    layout="stacked"
                    machines={machines}
                    belts={belts}
                    chests={chests}
                    itemNames={itemNames}
                    getRecipeInfo={getRecipeInfo}
                    onChange={handleDraftUpdate}
                />
            </Box>
            <Box role="tabpanel" id={`${id}-tabpanel-1`} aria-labelledby={`${id}-tab-1`} hidden={activeTab !== 1} sx={{ p: 2 }}>
                <EnableControlFormContent
                    entityType="inserter"
                    entityId={inserter.id}
                    stackSize={effectiveInserterStackSize(draft)}
                    movedItems={movedItems}
                    currentOverride={currentOverride}
                    onDraftChange={setRule}
                    hideActions
                    sourceType={draft.source.type}
                    sinkType={draft.sink.type}
                    availableItems={availableItems}
                    copyFromOptions={copyFromOptions}
                    revealProblems={revealProblems}
                />
            </Box>

            <DraftFooter dirty={dirty} onCancel={onCancel ?? onClose} onSave={handleSave}>
                {saveRefused && rule.problems.length > 0 && (
                    <Typography variant="body2" color="error" sx={{ mr: 1 }} data-rule-blocked="">
                        {blockedSummaryOf(rule.problems)}
                    </Typography>
                )}
            </DraftFooter>
        </Box>
    );
}
