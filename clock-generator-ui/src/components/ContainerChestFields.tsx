import { Add, Delete } from '@mui/icons-material';
import { Box, Button, FormControl, IconButton, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import { ChestType } from 'clock-generator/light';
import type { ReactNode } from 'react';
import {
    QUALITIES, isRocketSilo,
    type ChestFormData, type ContainerChestFormData, type ItemCountFormData, type QualityName, type RocketSiloFormData,
    type SlotContainerFormData, type SlotContentFormData, type SlotFilterFormData,
} from '../utils/configForm/formData';
import { entityLabel } from '../utils/entityLabel';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';

interface Props {
    chest: ContainerChestFormData;
    itemNames: string[];
    onChange: (update: Partial<ChestFormData>) => void;
    dialog?: boolean;
}

/** The settings worth keeping visible while the editor is closed. */
export function ContainerChestSummary({ chest }: { chest: ContainerChestFormData }) {
    const qualityLabel = (value: QualityName | undefined) => QUALITIES.find(quality => quality.value === (value ?? 'normal'))!.label;
    const contents = (chest.contents ?? []).filter(row => row.item.trim() !== '');
    const items = contents.reduce((total, row) => total + row.count, 0);
    const stock = items === 0 ? 'Starts empty' : `Starts with ${items} ${items === 1 ? 'item' : 'items'}`;
    const details = isRocketSilo(chest)
        ? [`Speed ${chest.crafting_speed ?? 1}×`, `Productivity ${chest.productivity ?? 0}%`, `${qualityLabel(chest.recipe_quality)} recipe`, stock]
        : [
            ...(chest.type === ChestType.CARGO_WAGON ? [`${qualityLabel(chest.quality)} quality`] : []),
            `${(chest.slot_filters ?? []).filter(row => row.item.trim() !== '').length} filtered slots`,
            stock,
        ];
    return <Typography variant="caption">{details.join(' · ')}</Typography>;
}

/**
 * The settings of a car, a tank, a cargo wagon or a rocket silo: a wagon's quality, the slot filters and starting
 * contents of a car, a tank or a wagon, and a silo's recipe quality, crafting speed, productivity and starting contents.
 * What is wrong with a value (a slot past the last, more than a stack) is the generator's to say, on Check.
 */
export function ContainerChestFields({ chest, itemNames, onChange, dialog = false }: Props) {
    const name = entityLabel('chest', chest.id);
    const fieldSx = dialog ? { flex: '1 1 160px', minWidth: 0 } : { minWidth: 0, flex: '1 1 140px' };
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0, width: '100%', flexBasis: '100%' }}>
        {isRocketSilo(chest) ? <SiloFields chest={chest} itemNames={itemNames} onChange={onChange} name={name} fieldSx={fieldSx} />
            : <SlotFields chest={chest} itemNames={itemNames} onChange={onChange} name={name} fieldSx={fieldSx} />}
    </Box>;
}

function QualityField({ label, value, onChange, ariaLabel, sx }: {
    label: string; value: QualityName | undefined; onChange: (value: QualityName) => void; ariaLabel: string; sx: object;
}) {
    return <FormControl size="small" sx={sx}>
        <InputLabel>{label}</InputLabel>
        <Select value={value ?? 'normal'} label={label} onChange={event => onChange(event.target.value as QualityName)}
            inputProps={{ 'aria-label': ariaLabel }}>
            {QUALITIES.map(quality => <MenuItem key={quality.value} value={quality.value}>{quality.label}</MenuItem>)}
        </Select>
    </FormControl>;
}

function SlotFields({ chest, itemNames, onChange, name, fieldSx }: {
    chest: SlotContainerFormData; itemNames: string[]; onChange: Props['onChange']; name: string; fieldSx: object;
}) {
    const filters = chest.slot_filters ?? [];
    const contents = chest.contents ?? [];
    const nextSlot = (taken: { slot: number }[]) => Math.max(0, ...taken.map(row => row.slot)) + 1;
    const setFilters = (rows: SlotFilterFormData[]) => onChange({ slot_filters: rows } as Partial<ChestFormData>);
    const setContents = (rows: SlotContentFormData[]) => onChange({ contents: rows } as Partial<ChestFormData>);
    return <>
        {chest.type === ChestType.CARGO_WAGON && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            <QualityField label="Quality" value={chest.quality} ariaLabel={`Quality, ${name}`} sx={fieldSx}
                onChange={quality => onChange({ quality } as Partial<ChestFormData>)} />
        </Box>}
        <RowList title="Filtered slots" note="A filtered slot takes only its item; the other slots take any item. Slots count from 1."
            addLabel="Add filtered slot" onAdd={() => setFilters([...filters, { slot: nextSlot(filters), item: '' }])}>
            {filters.map((row, index) => <Row key={index} removeLabel={`Remove filtered slot ${index + 1}, ${name}`}
                onRemove={() => setFilters(filters.filter((_, i) => i !== index))}>
                <NumberField label="Slot" value={row.slot} min={1} step={1} size="small" sx={{ width: 96, flexShrink: 0 }}
                    onValueChange={value => setFilters(filters.map((it, i) => i === index ? { ...it, slot: value ?? 1 } : it))} />
                <ItemSelector value={row.item || null} options={itemNames} label="Item" inputAriaLabel={`Item of filtered slot ${index + 1}, ${name}`}
                    onChange={value => setFilters(filters.map((it, i) => i === index ? { ...it, item: value ?? '' } : it))}
                    sx={{ flex: '1 1 180px', minWidth: 0 }} minWidth={0} />
            </Row>)}
        </RowList>
        <RowList title="Contents" note="What each slot holds when the build starts, at most a stack."
            addLabel="Add contents" onAdd={() => setContents([...contents, { slot: nextSlot(contents), item: '', count: 1 }])}>
            {contents.map((row, index) => <Row key={index} removeLabel={`Remove contents ${index + 1}, ${name}`}
                onRemove={() => setContents(contents.filter((_, i) => i !== index))}>
                <NumberField label="Slot" value={row.slot} min={1} step={1} size="small" sx={{ width: 96, flexShrink: 0 }}
                    onValueChange={value => setContents(contents.map((it, i) => i === index ? { ...it, slot: value ?? 1 } : it))} />
                <ItemSelector value={row.item || null} options={itemNames} label="Item" inputAriaLabel={`Item of contents ${index + 1}, ${name}`}
                    onChange={value => setContents(contents.map((it, i) => i === index ? { ...it, item: value ?? '' } : it))}
                    sx={{ flex: '1 1 180px', minWidth: 0 }} minWidth={0} />
                <NumberField label="Count" value={row.count} min={1} step={1} size="small" sx={{ width: 110, flexShrink: 0 }}
                    onValueChange={value => setContents(contents.map((it, i) => i === index ? { ...it, count: value ?? 1 } : it))} />
            </Row>)}
        </RowList>
    </>;
}

function SiloFields({ chest, itemNames, onChange, name, fieldSx }: {
    chest: RocketSiloFormData; itemNames: string[]; onChange: Props['onChange']; name: string; fieldSx: object;
}) {
    const contents = chest.contents ?? [];
    const set = (update: Partial<RocketSiloFormData>) => onChange(update as Partial<ChestFormData>);
    const setContents = (rows: ItemCountFormData[]) => set({ contents: rows });
    return <>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            <QualityField label="Recipe quality" value={chest.recipe_quality} ariaLabel={`Recipe quality, ${name}`} sx={fieldSx}
                onChange={recipe_quality => set({ recipe_quality })} />
            <NumberField label="Crafting Speed" value={chest.crafting_speed ?? null} min={0.01} step={0.1} size="small" placeholder="1"
                onValueChange={value => set({ crafting_speed: value ?? undefined })} sx={fieldSx} />
            <NumberField label="Productivity (%)" value={chest.productivity ?? null} min={0} step={1} size="small" placeholder="0"
                onValueChange={value => set({ productivity: value ?? undefined })} sx={fieldSx} />
        </Box>
        <Typography variant="caption" color="text.secondary">
            The rocket part&apos;s ingredients go into the input slots, up to the insertion limit its crafting speed sets; any other
            item, and all of them at another recipe quality, goes into the rocket, up to the weight it lifts. No rocket is
            built, so productivity changes nothing yet.
        </Typography>
        <RowList title="Contents" note="What it holds when the build starts, placed as an inserter would place it."
            addLabel="Add contents" onAdd={() => setContents([...contents, { item: '', count: 1 }])}>
            {contents.map((row, index) => <Row key={index} removeLabel={`Remove contents ${index + 1}, ${name}`}
                onRemove={() => setContents(contents.filter((_, i) => i !== index))}>
                <ItemSelector value={row.item || null} options={itemNames} label="Item" inputAriaLabel={`Item of contents ${index + 1}, ${name}`}
                    onChange={value => setContents(contents.map((it, i) => i === index ? { ...it, item: value ?? '' } : it))}
                    sx={{ flex: '1 1 180px', minWidth: 0 }} minWidth={0} />
                <NumberField label="Count" value={row.count} min={1} step={1} size="small" sx={{ width: 110, flexShrink: 0 }}
                    onValueChange={value => setContents(contents.map((it, i) => i === index ? { ...it, count: value ?? 1 } : it))} />
            </Row>)}
        </RowList>
    </>;
}

function RowList({ title, note, addLabel, onAdd, children }: {
    title: string; note: string; addLabel: string; onAdd: () => void; children: ReactNode;
}) {
    return <Box role="group" aria-label={title} sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" component="span">{title}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 200px' }}>{note}</Typography>
            <Button size="small" color="inherit" startIcon={<Add />} onClick={onAdd}>{addLabel}</Button>
        </Box>
        {children}
    </Box>;
}

function Row({ removeLabel, onRemove, children }: { removeLabel: string; onRemove: () => void; children: ReactNode }) {
    return <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        {children}
        <IconButton size="small" color="error" aria-label={removeLabel} onClick={onRemove}><Delete fontSize="small" /></IconButton>
    </Box>;
}
