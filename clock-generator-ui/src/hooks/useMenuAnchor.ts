import { useId, useState, type MouseEvent } from 'react';

/**
 * A button that opens a menu: spread `button` on the button and `menu` on the MUI Menu. `choose(action)` is a menu
 * item's click: it closes the menu, then does the action.
 */
export function useMenuAnchor() {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const id = useId();
    const open = anchor !== null;
    const close = () => setAnchor(null);
    return {
        button: {
            onClick: (event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget),
            'aria-haspopup': 'menu' as const,
            'aria-expanded': open,
            'aria-controls': open ? id : undefined,
        },
        menu: { id, anchorEl: anchor, open, onClose: close },
        choose: (action: () => void) => () => { close(); action(); },
    };
}
