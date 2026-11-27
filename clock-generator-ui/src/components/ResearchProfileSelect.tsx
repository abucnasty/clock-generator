import { Box, Typography } from '@mui/material';
import { SelectField } from './SelectField';

interface ResearchProfileChoice {
    id: string;
    name: string;
    isTemplate: boolean;
}

interface ResearchProfileSelectProps {
    /** The templates and the profiles, in the order they show */
    entries: readonly ResearchProfileChoice[];
    /** The id of the chosen profile or template */
    value: string;
    onChange: (id: string) => void;
    label?: string;
    fullWidth?: boolean;
}

/** The list of research profiles and the two templates, to choose one from. A template is marked as one in the list. */
export function ResearchProfileSelect({ entries, value, onChange, label = 'Profile', fullWidth = true }: ResearchProfileSelectProps) {
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    return <SelectField label={label} fullWidth={fullWidth} value={value} options={entries.map(entry => entry.id)} onChange={onChange}
        render={id => byId.get(id)?.name ?? id}
        renderOption={id => <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', justifyContent: 'space-between', width: '100%' }}>
            <span>{byId.get(id)?.name ?? id}</span>
            {byId.get(id)?.isTemplate && <Typography variant="caption" color="text.secondary">Template</Typography>}
        </Box>} />;
}
