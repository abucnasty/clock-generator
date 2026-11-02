import assert from "../common/assert";

export interface WakeSubscriptionState {
    readonly channel: string;
    /** Delivery order within this one wake list, not a global worker order. */
    readonly entities: readonly string[];
}

/**
 * A hand can wait on several inventories. Any Alarm removes all of its registrations, even
 * when it is already active. A later sleep registers it anew, changing its place in each list.
 * The native pink source/destination trace observes precisely this cross-channel transition.
 */
export class WakeSubscriptions {
    private readonly channels = new Map<string, string[]>();

    constructor(state: readonly WakeSubscriptionState[] = []) {
        for (const {channel, entities} of state) {
            assert(!this.channels.has(channel), "Duplicate wake channel");
            assert(new Set(entities).size === entities.length, "Duplicate wake registration");
            if (entities.length > 0) this.channels.set(channel, [...entities]);
        }
    }

    public clear(entity: string): void {
        for (const [channel, entities] of this.channels) {
            const index = entities.indexOf(entity);
            if (index >= 0) entities.splice(index, 1);
            if (entities.length === 0) this.channels.delete(channel);
        }
    }

    public register(entity: string, channels: readonly string[]): void {
        this.clear(entity);
        for (const channel of new Set(channels)) {
            const entities = this.channels.get(channel) ?? [];
            entities.unshift(entity);
            this.channels.set(channel, entities);
        }
    }

    /** Collecting one channel unlinks the collected hands from every channel before dispatch. */
    public take(channel: string): string[] {
        const entities = [...this.channels.get(channel) ?? []];
        for (const entity of entities) this.clear(entity);
        return entities;
    }

    public state(): WakeSubscriptionState[] {
        return [...this.channels].sort(([a], [b]) => a.localeCompare(b))
            .map(([channel, entities]) => ({channel, entities: [...entities]}));
    }
}
