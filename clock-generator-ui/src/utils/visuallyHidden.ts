/** Hidden from sight, read by screen readers; an `sx` value. Sizes in px, since a bare 1 in `sx` means 100% */
export const VISUALLY_HIDDEN = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    m: '-1px',
    p: 0,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
} as const;
