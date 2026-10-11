/**
 * A replay of the circuit of a blueprint, for tests: constant combinators, decider combinators (conditions, outputs,
 * else outputs, networks) and arithmetic combinators on red and green networks as the wires of the blueprint join
 * them. A combinator's output at one tick is made from its inputs at the tick before, as in the game. It knows nothing
 * of quality, of the signals each and anything, or of the 32-bit range of a signal, which no clock here reaches.
 */
import { FactorioBlueprint } from "../blueprints/blueprint";

export type Signals = Map<string, number>;

type Networks = { red?: boolean; green?: boolean } | undefined;
type Condition = {
    first_signal: { name: string };
    comparator: string;
    constant?: number;
    second_signal?: { name: string };
    compare_type?: string;
    first_signal_networks?: Networks;
    second_signal_networks?: Networks;
};
type Output = { signal: { name: string }; copy_count_from_input?: boolean; constant?: number; networks?: Networks };
type Behavior = {
    decider_conditions?: { conditions: Condition[]; outputs: Output[]; else_outputs?: Output[] };
    arithmetic_conditions?: { first_signal: { name: string }; second_constant: number; operation: string; output_signal: { name: string } };
    sections?: { sections: { filters: { name: string; count: number }[] }[] };
    is_on?: boolean;
};

const EVERYTHING = "signal-everything";

function add(into: Signals, name: string, count: number): void {
    into.set(name, (into.get(name) ?? 0) + count);
}

function compare(comparator: string, a: number, b: number): boolean {
    switch (comparator) {
        case "<": return a < b;
        case ">": return a > b;
        case "=": return a === b;
        case "≥": case ">=": return a >= b;
        case "≤": case "<=": return a <= b;
        case "≠": case "!=": return a !== b;
        default: throw new Error(`Unknown comparator ${comparator}`);
    }
}

export class CircuitReplay {
    tick = 0;
    private readonly parent = new Map<string, string>();
    private outputs = new Map<number, Signals>();
    private readonly behavior = new Map<number, Behavior>();
    private readonly names = new Map<number, string>();
    private readonly on = new Map<number, boolean>();
    private sums = new Map<string, Signals>();

    constructor(blueprint: Pick<FactorioBlueprint, "entities" | "wires">) {
        for (const entity of blueprint.entities) {
            this.behavior.set(entity.entity_number, (entity.control_behavior ?? {}) as Behavior);
            this.names.set(entity.entity_number, entity.name);
            this.on.set(entity.entity_number, (entity.control_behavior as Behavior | undefined)?.is_on !== false);
        }
        for (const [from, from_connector, to, to_connector] of blueprint.wires) {
            this.parent.set(this.find(`${from}:${from_connector}`), this.find(`${to}:${to_connector}`));
        }
        this.sums = this.sumNetworks();
    }

    private find(node: string): string {
        const up = this.parent.get(node);
        if (up === undefined || up === node) {
            this.parent.set(node, node);
            return node;
        }
        const root = this.find(up);
        this.parent.set(node, root);
        return root;
    }

    /** Switches a constant combinator on or off */
    setOn(entity_number: number, on: boolean): void {
        this.on.set(entity_number, on);
        this.sums = this.sumNetworks();
    }

    /** What a combinator puts out now */
    output(entity_number: number): Signals {
        return this.outputs.get(entity_number) ?? new Map();
    }

    /** The signals on the network at a connector of an entity now (1 and 2 are the red and green input, 3 and 4 the outputs) */
    network(entity_number: number, connector: number): Signals {
        return this.sums.get(this.find(`${entity_number}:${connector}`)) ?? new Map();
    }

    private sumNetworks(): Map<string, Signals> {
        const sums = new Map<string, Signals>();
        const put = (entity_number: number, connectors: number[], signals: Signals) => {
            for (const connector of connectors) {
                const net = this.find(`${entity_number}:${connector}`);
                const sum = sums.get(net) ?? new Map();
                sums.set(net, sum);
                signals.forEach((count, name) => add(sum, name, count));
            }
        };
        for (const [entity_number, name] of this.names) {
            if (name === "constant-combinator") {
                const signals: Signals = new Map();
                if (this.on.get(entity_number)) {
                    for (const section of this.behavior.get(entity_number)!.sections?.sections ?? []) {
                        section.filters.forEach(filter => add(signals, filter.name, filter.count));
                    }
                }
                put(entity_number, [1, 2], signals);
            } else {
                put(entity_number, [3, 4], this.output(entity_number));
            }
        }
        return sums;
    }

    private read(entity_number: number, networks: Networks): Signals {
        const total: Signals = new Map();
        const wanted = { red: networks?.red ?? true, green: networks?.green ?? true };
        for (const [selected, connector] of [[wanted.red, 1], [wanted.green, 2]] as const) {
            if (selected) {
                this.network(entity_number, connector).forEach((count, name) => add(total, name, count));
            }
        }
        return total;
    }

    private decide(entity_number: number): Signals {
        const { conditions, outputs, else_outputs } = this.behavior.get(entity_number)!.decider_conditions!;
        const holds = (condition: Condition) => {
            const first = this.read(entity_number, condition.first_signal_networks).get(condition.first_signal.name) ?? 0;
            const second = condition.second_signal
                ? this.read(entity_number, condition.second_signal_networks).get(condition.second_signal.name) ?? 0
                : condition.constant ?? 0;
            return compare(condition.comparator, first, second);
        };
        // conditions joined by "and" bind tighter than "or", which is how a condition joins the one before it unless it says otherwise
        let result = false;
        let group = true;
        conditions.forEach((condition, index) => {
            if (index > 0 && condition.compare_type !== "and") {
                result = result || group;
                group = true;
            }
            group = group && holds(condition);
        });
        result = result || group;

        const out: Signals = new Map();
        for (const row of (result ? outputs : else_outputs) ?? []) {
            if (row.copy_count_from_input === false) {
                add(out, row.signal.name, row.constant ?? 1);
            } else if (row.signal.name === EVERYTHING) {
                this.read(entity_number, row.networks).forEach((count, name) => count !== 0 && add(out, name, count));
            } else {
                const count = this.read(entity_number, row.networks).get(row.signal.name) ?? 0;
                if (count !== 0) {
                    add(out, row.signal.name, count);
                }
            }
        }
        return out;
    }

    private calculate(entity_number: number): Signals {
        const { first_signal, second_constant, operation, output_signal } = this.behavior.get(entity_number)!.arithmetic_conditions!;
        const value = this.read(entity_number, undefined).get(first_signal.name) ?? 0;
        if (operation !== "*" && operation !== "%") {
            throw new Error(`Unknown operation ${operation}`);
        }
        return new Map([[output_signal.name, operation === "*" ? value * second_constant : value % second_constant]]);
    }

    /** One tick: every combinator reads the networks as they are and puts out what it makes from them */
    step(): void {
        const next = new Map<number, Signals>();
        for (const [entity_number, name] of this.names) {
            if (name === "decider-combinator") {
                next.set(entity_number, this.decide(entity_number));
            } else if (name === "arithmetic-combinator") {
                next.set(entity_number, this.calculate(entity_number));
            }
        }
        this.outputs = next;
        this.sums = this.sumNetworks();
        this.tick++;
    }
}
