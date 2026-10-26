import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { IconButton, Tab, Tabs } from '@mui/material';
import { EntitySettings } from './EntitySettings';

const hooks = vi.hoisted(() => {
    let states: unknown[] = [], stateIndex = 0, idIndex = 0;
    const effects: (() => void)[] = [];
    return {
        effects,
        reset() { states = []; effects.length = 0; },
        begin() { stateIndex = idIndex = 0; effects.length = 0; },
        react: {
            useState(initial: unknown) {
                const index = stateIndex++;
                if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
                return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? (value as (old: unknown) => unknown)(states[index]) : value; }];
            },
            useId() { return `settings-test-${idIndex++}`; },
            useEffect(effect: () => void) { effects.push(effect); },
        },
    };
});

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks.react }));

type PropsView = Record<string, unknown> & { children?: ReactNode };
type ElementView = { type: unknown; props: PropsView };
function elements(node: ReactNode): ElementView[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement<PropsView>(node)) return [];
    return [{ type: node.type, props: node.props }, ...elements(node.props.children)];
}

const actionContainerId = 'machine-actions';
let summaryOpenTab: ((label: string) => void) | undefined;
const content = (name: string) => <span>{name}</span>;
const props = {
    label: 'Machine 1', actionContainerId, children: content('general-content'),
    summary: (openTab: (label: string) => void) => { summaryOpenTab = openTab; return content('machine-summary'); },
    tabs: [{ label: 'Input Routes', content: content('input-content') }, { label: 'Output Routes', content: content('output-content') }, { label: 'Machine Facts', content: content('facts-content') }],
};
const Render = () => { hooks.begin(); return elements(EntitySettings(props)); };
const detailsButton = () => Render().find(element => element.type === IconButton && element.props['aria-label'] === 'Entity details for Machine 1')!;
const panels = () => Render().filter(element => element.props.role === 'tabpanel');

beforeEach(() => { hooks.reset(); summaryOpenTab = undefined; });
afterEach(() => { vi.unstubAllGlobals(); });

it('labels the details toggle accessibly and starts closed with route tabs lazy until visited', () => {
    const view = Render();
    const button = view.find(element => element.type === IconButton && element.props['aria-label'] === 'Entity details for Machine 1')!;
    expect(button.props['aria-expanded']).toBe(false);
    expect(button.props['aria-controls']).toBe('settings-test-0-settings');
    expect(view.some(element => element.type === Tabs)).toBe(false);
    expect(view.some(element => element.props.role === 'tabpanel')).toBe(false);

    (button.props.onClick as () => void)();
    const open = Render();
    expect(open.some(element => element.type === Tabs && element.props['aria-label'] === 'Machine 1 entity details')).toBe(true);
    expect(open.filter(element => element.type === Tab).map(element => element.props.label)).toEqual(['General', 'Input Routes', 'Output Routes', 'Machine Facts']);
    expect(panels().map(panel => panel.props.hidden)).toEqual([false, true, true, true]);
    expect(open.some(element => element.props.children === 'input-content')).toBe(false);
    expect(open.some(element => element.props.children === 'output-content')).toBe(false);
    expect(open.some(element => element.props.children === 'facts-content')).toBe(false);
});

it('keeps the panel mounted but hidden when toggled closed and visits input and output tabs on selection', () => {
    const button = detailsButton();
    (button.props.onClick as () => void)();
    const tabs = Render().find(element => element.type === Tabs)!;
    (tabs.props.onChange as (_event: unknown, value: number) => void)({}, 1);
    let view = Render();
    expect(view.filter(element => element.props.role === 'tabpanel').map(panel => panel.props.hidden)).toEqual([true, false, true, true]);
    expect(view.some(element => element.props.children === 'input-content')).toBe(true);

    const outputTabs = view.find(element => element.type === Tabs)!;
    (outputTabs.props.onChange as (_event: unknown, value: number) => void)({}, 2);
    view = Render();
    expect(view.filter(element => element.props.role === 'tabpanel').map(panel => panel.props.hidden)).toEqual([true, true, false, true]);
    expect(view.some(element => element.props.children === 'output-content')).toBe(true);

    const close = view.find(element => element.type === IconButton)!;
    (close.props.onClick as () => void)();
    view = Render();
    const panel = view.find(element => element.props.id === 'settings-test-0-settings')!;
    expect(panel.props.hidden).toBe(true);
    expect(view.some(element => element.type === Tabs)).toBe(true);
});

it('opens the requested summary tab and requests focus for that tab', () => {
    Render();
    expect(summaryOpenTab).toBeDefined();
    summaryOpenTab!('Output Routes');
    const view = Render();
    expect(view.filter(element => element.props.role === 'tabpanel').map(panel => panel.props.hidden)).toEqual([true, true, false, true]);
    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    const getElementById = vi.fn(() => ({ focus, scrollIntoView }));
    vi.stubGlobal('document', { getElementById });
    hooks.effects.forEach(effect => effect());
    expect(getElementById).toHaveBeenCalledWith('settings-test-0-tab-2');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
