import { Box } from '@mui/material';

/**
 * A thin bar above the header of the preview of `master`: `preview <commit>`. The build sets the commit; production and
 * local builds set none, so they show no bar. It is in the page's flow, not fixed, so it scrolls away and the header's
 * height is the one the sticky offsets measure.
 */
export function PreviewBanner() {
    const commit = typeof __PREVIEW_COMMIT__ !== 'undefined' ? __PREVIEW_COMMIT__ : '';
    if (commit === '') return null;
    return (
        <Box
            sx={{
                bgcolor: 'warning.main',
                color: 'warning.contrastText',
                fontSize: '0.6875rem',
                lineHeight: '16px',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                pt: 'env(safe-area-inset-top)',
                pl: 'env(safe-area-inset-left)',
                pr: 'env(safe-area-inset-right)',
            }}
        >
            {`preview ${commit}`}
        </Box>
    );
}
