import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import type { TargetType } from 'clock-generator/light';
import { useEffect, useRef, useState } from 'react';
import type { RuleSet } from '../hooks/useConfigForm';
import { BUTTON_NAMES, SELECT_NAMES } from '../utils/a11yLabels';
import { wholeTicksOf } from '../utils/enableControlDraft';
import { PROBLEM_TEXT } from '../utils/ruleProblems';
import {
    defaultAmount,
    isDefaultRuleSet,
    replacedCount,
    templateRule,
    templatesFor,
    type RuleTemplate,
} from '../utils/ruleTemplates';
import { ItemSelector } from './ItemSelector';

type EndType = typeof TargetType[keyof typeof TargetType];

/** The template step's words */
const STEP_COPY = {
    heading: (name: string) => `Template: ${name}`,
    item: 'Item',
    amount: 'Switch on at (items)',
    amountProblem: 'Enter a whole number, 1 or more.',
    replaces: (count: number, latch: boolean) =>
        `This replaces your ${count} ${count === 1 ? 'condition' : 'conditions'}${latch ? ' and the latch' : ''}.`,
} as const;

interface QuickTemplateSelectProps {
    sourceType: EndType;
    sinkType: EndType;
    /** The items the inserter moves, the first of which the item picker starts on */
    movedItems: string[];
    /** The items of the inserter's two ends, which the item picker offers */
    availableItems: string[];
    stackSize?: number;
    /** The rule set and latch a template would replace */
    ruleSet: RuleSet;
    latchEnabled: boolean;
    /** The prefix of the form's field ids */
    idPrefix: string;
    /** Called on Replace, with the template's rule and its name */
    onApply: (ruleSet: RuleSet, release: RuleSet | undefined, templateName: string) => void;
}

/**
 * The templates that fit the inserter's two ends. Choosing one opens a step under the list that asks for what the
 * template needs and says what it replaces; nothing changes until Replace conditions.
 */
export function QuickTemplateSelect({
    sourceType,
    sinkType,
    movedItems,
    availableItems,
    stackSize,
    ruleSet,
    latchEnabled,
    idPrefix,
    onApply,
}: QuickTemplateSelectProps) {
    const templates = templatesFor(sourceType, sinkType);
    const [chosen, setChosen] = useState<RuleTemplate | null>(null);
    const [item, setItem] = useState('');
    const [amount, setAmount] = useState('');
    const [tried, setTried] = useState(false);
    // the Select's handle, whose focus() focuses the list button
    const selectRef = useRef<HTMLInputElement>(null);
    const replaceRef = useRef<HTMLButtonElement>(null);
    // where the focus goes after the render that shows (or hides) the step
    const focusAfterRender = useRef<'step' | 'select' | null>(null);

    const itemId = `${idPrefix}-template-item`;
    const amountId = `${idPrefix}-template-amount`;
    const headingId = `${idPrefix}-template-heading`;

    const amountNumber = wholeTicksOf(amount);
    const itemProblem = chosen?.needsItem && !item ? PROBLEM_TEXT.pickItem : undefined;
    const amountProblem = chosen?.needsAmount && (amountNumber === null || amountNumber < 1) ? STEP_COPY.amountProblem : undefined;

    useEffect(() => {
        const target = focusAfterRender.current;
        if (target === null) return;
        focusAfterRender.current = null;
        if (target === 'select') {
            selectRef.current?.focus();
        } else if (chosen) {
            const first = chosen.needsItem ? itemId : chosen.needsAmount ? amountId : null;
            if (first) document.getElementById(first)?.focus();
            else replaceRef.current?.focus();
        }
    });

    if (templates.length === 0) return null;

    const choose = (id: string) => {
        const template = templates.find((t) => t.id === id);
        if (!template) return;
        setChosen(template);
        setItem(movedItems.find((moved) => availableItems.includes(moved)) ?? '');
        setAmount(`${defaultAmount(stackSize)}`);
        setTried(false);
        focusAfterRender.current = 'step';
    };

    const cancel = () => {
        setChosen(null);
        focusAfterRender.current = 'select';
    };

    const replace = () => {
        if (!chosen) return;
        if (itemProblem || amountProblem) {
            setTried(true);
            document.getElementById(itemProblem ? itemId : amountId)?.focus();
            return;
        }
        const rule = templateRule(chosen.id, { item, amount: amountNumber ?? 0 });
        setChosen(null);
        onApply(rule.ruleSet, rule.release, chosen.name);
    };

    const untouched = isDefaultRuleSet(ruleSet) && !latchEnabled;

    return (
        <Box sx={{ mb: 2 }}>
            <FormControl size="small" fullWidth>
                <InputLabel shrink>Quick templates</InputLabel>
                <Select
                    inputRef={selectRef}
                    inputProps={{ 'aria-label': SELECT_NAMES.quickTemplates }}
                    value=""
                    label="Quick templates"
                    onChange={(e) => choose(e.target.value)}
                    displayEmpty
                    notched
                    renderValue={() => (
                        <Typography variant="body2" color="text.secondary">
                            Select a template to apply...
                        </Typography>
                    )}
                >
                    {templates.map((template) => (
                        <MenuItem key={template.id} value={template.id}>
                            <Box sx={{ whiteSpace: 'normal' }}>
                                <Typography variant="body2">{template.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {template.description}
                                </Typography>
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {chosen && (
                <Box
                    role="group"
                    aria-labelledby={headingId}
                    data-template-step=""
                    sx={{ mt: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
                >
                    <Typography id={headingId} variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
                        {STEP_COPY.heading(chosen.name)}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        {chosen.needsItem && (
                            <ItemSelector
                                value={item || null}
                                options={availableItems}
                                onChange={(value) => setItem(value ?? '')}
                                label={STEP_COPY.item}
                                inputId={itemId}
                                minWidth={220}
                                errorText={tried ? itemProblem : undefined}
                            />
                        )}
                        {chosen.needsAmount && (
                            <TextField
                                id={amountId}
                                label={STEP_COPY.amount}
                                type="number"
                                size="small"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                error={tried && amountProblem !== undefined}
                                helperText={tried ? amountProblem : undefined}
                                sx={{ width: 180 }}
                                slotProps={{ htmlInput: { min: 1, inputMode: 'numeric' } }}
                            />
                        )}
                    </Box>
                    {!untouched && (
                        <Typography variant="body2" sx={{ mt: 1.5 }}>
                            {STEP_COPY.replaces(replacedCount(ruleSet), latchEnabled)}
                        </Typography>
                    )}
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1.5 }}>
                        <Button onClick={cancel} color="inherit">Cancel</Button>
                        <Button ref={replaceRef} onClick={replace} variant="contained" color="secondary">
                            {untouched ? BUTTON_NAMES.useTemplate : BUTTON_NAMES.replaceConditions}
                        </Button>
                    </Box>
                </Box>
            )}
        </Box>
    );
}
