import assert from "../common/assert";

export interface WakeSubscriptionState<E = string> {
    readonly channel: string;
    /** Delivery order within this one wake list, not a global worker order. */
    readonly entities: readonly E[];
}

/** One wake list: who waits on the channel, the first to be told first. Kept while empty, so a caller can hold it */
export interface WakeChannel<E = string> {
    readonly name: string;
    readonly entries: WakeEntry<E>[];
}

/** One waiter: the channels it waits on, none while it waits on nothing. A caller can hold it (`entry`) */
export interface WakeEntry<E = string> {
    readonly entity: E;
    readonly channels: WakeChannel<E>[];
}

const NOBODY: readonly WakeEntry<never>[] = [];

/**
 * A hand can wait on several inventories. Any Alarm removes all of its registrations, even
 * when it is already active. A later sleep registers it anew, changing its place in each list.
 * The native pink source/destination trace observes precisely this cross-channel transition.
 *
 * It runs in every tick of a simulation under the new dispatch: each waiter keeps its channels, so that an Alarm
 * unlinks it from those alone, and a caller that holds its channels and entries (InserterScheduling) calls the
 * `...Entry` methods, which are the same lists without the lookups. An entity is any value compared by identity.
 */
export class WakeSubscriptions<E = string> {
    private readonly channels = new Map<string, WakeChannel<E>>();
    private readonly entries = new Map<E, WakeEntry<E>>();

    constructor(state: readonly WakeSubscriptionState<E>[] = []) {
        this.restore(state);
    }

    /** Puts the lists of a state (`state`) back, onto channels nobody waits on yet */
    public restore(state: readonly WakeSubscriptionState<E>[]): void {
        for (const {channel: name, entities} of state) {
            const channel = this.channel(name);
            assert(channel.entries.length === 0, "Duplicate wake channel");
            assert(new Set(entities).size === entities.length, "Duplicate wake registration");
            for (const entity of entities) {
                const entry = this.entry(entity);
                channel.entries.push(entry);
                entry.channels.push(channel);
            }
        }
    }

    /** The channel of this name, made empty when there is none yet */
    public channel(name: string): WakeChannel<E> {
        let channel = this.channels.get(name);
        if (channel === undefined) {
            channel = {name, entries: []};
            this.channels.set(name, channel);
        }
        return channel;
    }

    /** The entity's entry, made (waiting on nothing) when there is none yet */
    public entry(entity: E): WakeEntry<E> {
        let entry = this.entries.get(entity);
        if (entry === undefined) {
            entry = {entity, channels: []};
            this.entries.set(entity, entry);
        }
        return entry;
    }

    public clear(entity: E): void {
        const entry = this.entries.get(entity);
        if (entry !== undefined) this.clearEntry(entry);
    }

    public clearEntry(entry: WakeEntry<E>): void {
        const channels = entry.channels;
        for (let channel = channels.pop(); channel !== undefined; channel = channels.pop()) remove(channel.entries, entry);
    }

    public register(entity: E, channels: readonly string[]): void {
        this.registerEntry(this.entry(entity), channels.map(name => this.channel(name)));
    }

    public registerEntry(entry: WakeEntry<E>, channels: readonly WakeChannel<E>[]): void {
        this.clearEntry(entry);
        for (const channel of channels) {
            if (entry.channels.includes(channel)) continue;
            entry.channels.push(channel);
            channel.entries.unshift(entry);
        }
    }

    /** Collecting one channel unlinks the collected hands from every channel before dispatch. */
    public take(channel: string): E[] {
        const named = this.channels.get(channel);
        return named === undefined ? [] : this.takeEntries(named).map(entry => entry.entity);
    }

    public takeEntries(channel: WakeChannel<E>): readonly WakeEntry<E>[] {
        if (channel.entries.length === 0) return NOBODY;
        const taken = channel.entries.slice();
        for (const entry of taken) this.clearEntry(entry);
        return taken;
    }

    public state(): WakeSubscriptionState<E>[] {
        return [...this.channels.values()].filter(channel => channel.entries.length > 0)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({name, entries}) => ({channel: name, entities: entries.map(entry => entry.entity)}));
    }
}

/** Takes the item out of the list, the others keeping their order (a list here holds a handful of entries) */
function remove<T>(list: T[], item: T): void {
    const last = list.length - 1;
    for (let index = list.indexOf(item); index < last; index++) list[index] = list[index + 1];
    list.pop();
}
