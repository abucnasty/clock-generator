import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import cell02 from '../../../clock-generator/resources/config-samples/real/stupidfathobbit/cell02/stupidfathobbit-cell02.json?raw';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { ConfigSchema, FactorioDataService, validateConfig } from 'clock-generator/browser';
import { TransferPlanPanel } from './TransferPlanPanel';

// React reports two children with the same key only when it renders in a browser, not in the server render these tests
// use, so the table body checks the keys of its rows as React does: within each list, every key once.
const keys = vi.hoisted(() => ({ listed: [] as string[], repeated: [] as string[] }));
vi.mock('@mui/material', async importOriginal => {
    const actual = await importOriginal<typeof import('@mui/material')>();
    const { createElement, isValidElement } = await import('react');
    const check = (children: ReactNode) => {
        if (!Array.isArray(children)) return;
        const listed = children.filter(isValidElement).map(child => child.key).filter(key => key !== null);
        keys.listed.push(...listed);
        keys.repeated.push(...listed.filter((key, index) => listed.indexOf(key) !== index));
        children.forEach(check);
    };
    return { ...actual, TableBody: (props: { children?: ReactNode }) => { check(props.children); return createElement(actual.TableBody, props); } };
});
beforeEach(() => { keys.listed = []; keys.repeated = []; });

FactorioDataService.initialize(JSON.parse(factorioData));

it('lists the swing plan of cell 02, whose export inserters fill both lanes of a belt with circuits, with no key twice', () => {
    const plan = validateConfig(ConfigSchema.parse(JSON.parse(cell02))).transfer_plan;
    const exports = plan.entities.filter(entity => ['inserter:16', 'inserter:17'].includes(entity.entity_id));
    expect(exports.map(entity => entity.item_transfers.map(transfer => transfer.item_name))).toEqual([
        ['electronic-circuit', 'electronic-circuit'],
        ['electronic-circuit', 'electronic-circuit'],
    ]);
    renderToStaticMarkup(<TransferPlanPanel transferPlan={plan} usedLcm={plan.computed_lcm} excludedIngredients={[]} onExcludeChange={() => {}} />);
    expect(keys.repeated).toEqual([]);
    expect(keys.listed).toContain('inserter:16-electronic-circuit#2');
});
