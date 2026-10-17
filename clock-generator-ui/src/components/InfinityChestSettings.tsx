import { Box, Checkbox, FormControlLabel } from '@mui/material';
import type { ReactNode } from 'react';
import type { InfinityChestFormData } from '../utils/configForm/formData';

/** Filters maintain stock; this independent switch disposes of everything else. */
export function InfinityChestSettings({ chest, onChange, children }: { chest: InfinityChestFormData; onChange: (enabled: boolean) => void; children?: ReactNode }) {
    return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {children}
        <FormControlLabel label="Also remove unfiltered items" sx={{ m: 0, whiteSpace: 'nowrap' }} control={<Checkbox size="small" checked={chest.remove_unfiltered_items === true}
            onChange={(_, checked) => onChange(checked)} />} />
    </Box>;
}
