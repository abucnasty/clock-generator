import { TextField } from '@mui/material';
import { useState } from 'react';
import { exactRateUnits, fraction, rateText, RATE_PRECISION_ERROR, type SetpointRate } from 'clock-generator/light';
import { copiesProblem } from '../utils/copiesProblem';
import { ELEMENT_IDS } from '../utils/firstProblem';
import { NUMBER_FIELD_INPUT_FORMAT } from '../utils/numberText';

const format = new Intl.NumberFormat(undefined, NUMBER_FIELD_INPUT_FORMAT);
const decimal = format.formatToParts(0.5).find(part => part.type === 'decimal')?.value ?? '.';
const digits = Array.from({ length: 10 }, (_, index) => format.format(index));
const numeric_digits = new Map(digits.map((digit, index) => [digit, String(index)]));
for (const system of ['０１２３４５６７８９', '٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹', '零一二三四五六七八九']) {
    [...system].forEach((digit, index) => numeric_digits.set(digit, String(index)));
}
numeric_digits.set('〇', '0');

/** Accept the numeral systems and punctuation of the numeric field before checking the complete token. */
function numericToken(text: string): string {
    const token = [...text].map(digit => numeric_digits.get(digit) ?? digit).join('')
        .replace(/\p{Cf}/gu, '').replace(/[−－‒–—﹣]/g, '-').replace(/[＋﹢]/g, '+')
        .replace(/[٫．]/g, '.').replace(decimal, '.');
    // Strip Arabic or fullwidth grouping only from a complete token with consistent three-digit groups.
    if (/^[+-]?\d{1,3}([٬，])\d{3}(?:\1\d{3})*(?:\.\d*)?$/.test(token)) {
        return token.replace(/[٬，]/g, '');
    }
    return token;
}
type ReadRate = { value: SetpointRate } | { error: string };

function operand(text: string, name: string): number | string {
    const trimmed = text.trim().replace(/^0+(?=\d)/, '');
    if (!trimmed) return `Enter a ${name.toLowerCase()}.`;
    if (!/^\d+$/.test(trimmed)) return `${name} must be a whole number.`;
    if (trimmed === '0') return `${name} must be more than 0.`;
    if (trimmed.length > 16 || !Number.isSafeInteger(Number(trimmed))) return `${name} is too large.`;
    return Number(trimmed);
}

function readRate(text: string): ReadRate {
    const normalized = digits.reduce((s, digit, index) => s.split(digit).join(String(index)), text.trim());
    const parts = normalized.split('/');
    if (parts.length > 2) return { error: 'Use one slash, as in 16/7.' };
    if (parts.length === 2) {
        const n = operand(parts[0], 'Numerator'), d = operand(parts[1], 'Denominator');
        if (typeof n === 'string') return { error: n };
        if (typeof d === 'string') return { error: d };
        const reduced = fraction(n, d);
        return { value: { numerator: reduced.getNumerator, denominator: reduced.getDenominator } };
    }
    const token = numericToken(normalized);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return { error: 'Enter a whole number, decimal or fraction.' };
    const value = Number(token);
    if (!Number.isFinite(value)) return { error: 'Enter a finite rate.' };
    return value > 0 ? { value } : { error: 'Rate must be more than 0.' };
}

/** The draft stays in the field. The form holds its parsed value or its existing incomplete value, zero. */
export function SetpointRateField({ value, copies, onChange, capacity_problem }: {
    value: SetpointRate; copies: number; onChange: (value: SetpointRate) => void; capacity_problem: string | null;
}) {
    const [draft, setDraft] = useState<{ text: string; key: string; committed: boolean } | null>(null);
    const current = draft?.key === rateText(value) ? draft : null;
    const text = current?.text ?? (typeof value === 'number' ? format.format(value) : rateText(value));
    const parsed = readRate(text);
    let problem = (!current || current.committed) && 'error' in parsed ? parsed.error : null;
    if (typeof value !== 'number' && !copiesProblem(copies)) {
        try { exactRateUnits(value, copies); } catch { problem = RATE_PRECISION_ERROR; }
    }
    problem ??= capacity_problem;
    const update = (next: string, commit: boolean) => {
        const result = readRate(next);
        const rate = 'value' in result ? result.value : 0;
        setDraft({ key: rateText(rate), text: commit && typeof rate !== 'number' ? rateText(rate) : next, committed: commit });
        onChange(rate);
    };
    return <TextField id={ELEMENT_IDS.targetRate} label="Items per Second" size="small" value={text} required
        error={Boolean(problem)} helperText={problem ?? 'e.g. 2, 2.5 or 16/7'} sx={{ minWidth: 0 }}
        slotProps={{ htmlInput: { inputMode: 'text', autoComplete: 'off', spellCheck: false, 'aria-label': 'Items per Second' } }}
        onChange={event => update(event.target.value, false)} onBlur={() => { if (current) update(text, true); }}
        onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); update(text, true); }
        }} />;
}
