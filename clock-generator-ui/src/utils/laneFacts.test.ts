import data from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it } from 'vitest';
import { ConfigSchema, FactorioDataService, laneFactsOfConfig, type Config } from 'clock-generator/browser';
import { laneRolesAnswer } from '../worker/laneRoles';
import { beltRoleLine, formLaneFactsOf, inputLaneEnds, inputLanesText, isTakenLane, laneRolesKeyOf, outputBeltSummary } from './laneFacts';

FactorioDataService.initialize(JSON.parse(data));

const SAMPLE_FILES = import.meta.glob('../../../clock-generator/resources/config-samples/**/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
/** The examples of the page (scripts/game-data-plugin.ts), with the count line each one's Belts section shows */
const EXAMPLES: [string, string, string][] = [
    ['logistic-science', 'science/logistic/logistic-240.json', '2 dead ends · 0 infinite'],
    ['automation-science', 'science/automation/automation-240.json', '2 dead ends · 0 infinite'],
    ['utility-science', 'science/utility/utility-120.json', '4 dead ends · 0 infinite'],
    ['chemical-science', 'science/chemical/chemical-240-shared-foundry.json', '8 dead ends · 0 infinite'],
    ['electromagnetic-science', 'science/electromagnetic/electromagnetic-330.json', '2 dead ends · 0 infinite'],
    ['military-science', 'science/military/military-240.json', '8 dead ends · 0 infinite'],
    ['production-science', 'science/production/production-120-two-belts.json', '2 dead ends · 0 infinite'],
    ['metallurgic-science', 'science/metallurgic/metallurgic-45.json', '4 dead ends · 0 infinite'],
    ['agriculture-science', 'science/agricultural/agricultural-250.json', '4 dead ends · 0 infinite'],
];
const example = (file: string) => ConfigSchema.parse(JSON.parse(SAMPLE_FILES[`../../../clock-generator/resources/config-samples/${file}`]));
/** The example with no lane stating its end, so that every lane shows the end the engine gives it */
const noEnds = (config: Config): Config => ({ ...config, belts: config.belts.map(belt => ({ ...belt,
    lanes: (belt.lanes as Config['belts'][number]['lanes'][number][]).map(({ lane_end: _end, ...lane }) => { void _end; return lane; }) })) as Config['belts'] });
/** The form's facts, with the roles the worker answers */
const formFactsOf = (config: Config) => formLaneFactsOf(config, laneRolesAnswer(config, laneFactsOfConfig(config)))!;

describe('the lanes of the examples, as the form reads them', () => {
    it.each(EXAMPLES)('%s: each lane has the engine\'s role and end, with its ends stated and with none', (_id, file) => {
        for (const config of [example(file), noEnds(example(file))]) {
            const engine = laneFactsOfConfig(config);
            const facts = formFactsOf(config);
            for (const lane of facts.lanes) {
                expect([lane.belt_id, lane.lane, lane.role, lane.end]).toEqual([lane.belt_id, lane.lane, engine.of(lane.belt_id, lane.lane).role,
                    engine.of(lane.belt_id, lane.lane).lane_end.kind]);
            }
            expect(facts.lanes.length).toBe(config.belts.reduce((sum, belt) => sum + belt.lanes.length, 0));
        }
    });

    it.each(EXAMPLES)('%s: the count line', (_id, file, count) => {
        expect(inputLanesText(inputLaneEnds(formFactsOf(example(file)))!)).toBe(count);
    });

    it('counts an unknown end, and the lanes an inserter takes from only', () => {
        const config = example('science/automation/automation-240.json');
        const lanes = config.belts[0].lanes as Config['belts'][number]['lanes'][number][];
        lanes[0] = { ...lanes[0], lane_end: { kind: 'unknown' } };
        lanes[1] = { ...lanes[1], lane_end: { kind: 'infinite' } };
        expect(inputLanesText(inputLaneEnds(formFactsOf(config))!)).toBe('0 dead ends · 1 infinite · 1 unknown');
        // the output lane of belt 2 is not counted
        expect(formFactsOf(config).lanes.filter(isTakenLane).map(lane => lane.belt_id)).toEqual([1, 1]);
    });
});

describe('formLaneFactsOf', () => {
    it('leaves the role and the end unknown where the engine has not given the roles, and keeps the capacity and the sharing', () => {
        const config = example('science/automation/automation-240.json');
        const facts = formLaneFactsOf(config, null)!;
        expect(facts.of(1, 1)).toEqual({ belt_id: 1, lane: 1, role: undefined, end: undefined, capacity: 120, sharing: 'shared' });
        expect(inputLaneEnds(facts)).toBeNull();
    });

    it('reads the supply rate of a lane that states none as its capacity, and a stated sharing as stated', () => {
        const config = example('science/military/military-240.json');
        const facts = formFactsOf(config);
        expect(facts.of(5, 1)).toMatchObject({ role: 'input', end: 'dead_end', capacity: 120, sharing: 'per_copy' });
    });

    it('keys the roles on the fields they come from only', () => {
        const config = example('science/automation/automation-240.json');
        const stated = { ...config, belts: config.belts.map(belt => ({ ...belt, flow_direction: 8 as const, lanes: belt.lanes.map(lane => ({ ...lane, supply_rate: 10 })) })) } as Config;
        expect(laneRolesKeyOf(stated)).toBe(laneRolesKeyOf(config));
        const otherItem = { ...config, belts: [{ ...config.belts[0], lanes: [{ ...config.belts[0].lanes[0], ingredient: 'iron-plate' }] }, ...config.belts.slice(1)] } as Config;
        expect(laneRolesKeyOf(otherItem)).not.toBe(laneRolesKeyOf(config));
    });
});

describe('outputBeltSummary', () => {
    it('counts what the output belt of a config states', () => {
        expect(outputBeltSummary(example('science/automation/automation-240.json').output_belt!)).toBe('5 stretches, 1 splitter, 1 infinite end.');
        expect(outputBeltSummary({ stretches: [{ points: [{ drop: 1, lane: 'left' }] }] })).toBe('1 stretch.');
    });
});

describe('beltRoleLine', () => {
    const lane = (role: 'input' | 'output' | 'buffer' | null | undefined, sharing: 'shared' | 'per_copy' = 'shared') => ({ role, sharing });
    it.each([
        [[lane('input'), lane('input')], 9, 'input belt · the 9 copies share it'],
        [[lane('input')], 5.5, 'input belt · the 5.5 copies share it'],
        [[lane('input', 'per_copy'), lane('input', 'per_copy')], 5, 'input belt · each copy has its own'],
        [[lane('input')], 1, 'input belt'],
        [[lane('output')], 9, 'output belt · the output inserters drop on it'],
        [[lane('buffer')], 9, 'buffer belt · inserters drop on it and take from it'],
        [[lane('input'), lane('output')], 9, 'lane 1 input, lane 2 output'],
        [[lane(null), lane(null)], 9, null],
        [[lane('input'), lane(undefined)], 9, null],
        [[], 9, null],
    ] as const)('%o of %s copies: %s', (lanes, copies, line) => {
        expect(beltRoleLine(lanes, copies)).toBe(line);
    });
});
