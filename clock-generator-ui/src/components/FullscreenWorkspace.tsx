import { Close, Fullscreen } from '@mui/icons-material';
import { Box, IconButton, Modal, Tooltip } from '@mui/material';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Panel } from './Panel';

interface FullscreenWorkspaceProps {
    fullscreen: boolean;
    onFullscreenChange(fullscreen: boolean): void;
    actions: ReactNode;
    children: ReactNode;
}

/** One mounted workspace in both sizes; Modal supplies focus trapping and nested-menu handling. */
export function FullscreenWorkspace({ fullscreen, onFullscreenChange, actions, children }: FullscreenWorkspaceProps) {
    const host = useRef<HTMLDivElement>(null);
    const [inlinePosition, setInlinePosition] = useState({ height: 0, scrollY: 0 });
    const id = useId();
    const toggleFullscreen = () => {
        if (!fullscreen) setInlinePosition({ height: host.current?.getBoundingClientRect().height ?? 0, scrollY: window.scrollY });
        onFullscreenChange(!fullscreen);
    };

    useLayoutEffect(() => {
        if (!fullscreen || !host.current) return;
        const overflow = document.body.style.overflow;
        const padding = document.body.style.paddingRight;
        const scrollbar = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = 'hidden';
        if (scrollbar > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbar}px`;
        // This Modal stays in place to preserve chart state. Hide background siblings along its ancestor path.
        const background: { element: HTMLElement; inert: boolean }[] = [];
        const fullscreenHost = host.current;
        let branch: HTMLElement = fullscreenHost;
        while (branch.parentElement) {
            for (const sibling of branch.parentElement.children) {
                if (sibling !== branch && sibling instanceof HTMLElement) {
                    background.push({ element: sibling, inert: sibling.inert });
                    sibling.inert = true;
                }
            }
            if (branch.parentElement === document.body) break;
            branch = branch.parentElement;
        }
        return () => {
            document.body.style.overflow = overflow;
            document.body.style.paddingRight = padding;
            for (const { element, inert } of background) element.inert = inert;
            requestAnimationFrame(() => {
                if (!fullscreenHost.querySelector('[aria-modal="true"]')) window.scrollTo({ top: inlinePosition.scrollY, behavior: 'instant' });
            });
        };
    }, [fullscreen, inlinePosition.scrollY]);

    return <Box ref={host} sx={{ minHeight: fullscreen ? inlinePosition.height : undefined }}>
        <Modal open={fullscreen} onClose={() => onFullscreenChange(false)} keepMounted disablePortal hideBackdrop disableScrollLock
            container={() => host.current} aria-hidden={false}
            sx={{ position: fullscreen ? 'fixed' : 'static', visibility: 'visible', zIndex: fullscreen ? theme => theme.zIndex.modal : 'auto' }}>
            <Box role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-labelledby={fullscreen ? `${id}-title` : undefined}
                tabIndex={-1} sx={{ height: fullscreen ? '100dvh' : undefined, minWidth: 0, outline: 0, bgcolor: 'background.paper' }}>
                <Panel id={id} title="Selected clock workspace" data-result-context="" data-build-anchor="clock-context"
                    actions={<>{actions}<Tooltip title={fullscreen ? 'Close fullscreen' : 'Open fullscreen'}>
                        <IconButton onClick={toggleFullscreen} size="small" aria-label={fullscreen ? 'Close fullscreen' : 'Open fullscreen'}>
                            {fullscreen ? <Close /> : <Fullscreen />}
                        </IconButton>
                    </Tooltip></>}
                    sx={{ mb: 0, height: fullscreen ? '100%' : undefined, boxSizing: 'border-box',
                        ...(fullscreen && { display: 'flex', flexDirection: 'column', '& > header': { flexShrink: 0 },
                            '& > :last-child': { flex: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' } }),
                    }}>
                    {children}
                </Panel>
            </Box>
        </Modal>
    </Box>;
}
