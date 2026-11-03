import assert from "../common/assert";

export interface WakeSubscriptionState<E = string> {
    readonly channel: string;
    /** Delivery order within this one wake list, not a global worker order. */
    readonly entities: readonly E[];
}

/** One waiter on one channel: its place in that channel's list */
interface WakeLink<E> {
    readonly entry: WakeEntry<E>;
    readonly channel: WakeChannel<E>;
    previous: WakeLink<E> | null;
    next: WakeLink<E> | null;
}

/**
 * One wake list: who waits on the channel, the first to be told first, linked from `first` to `last`. Kept while
 * empty, so a caller can hold it
 */
export interface WakeChannel<E = string> {
    readonly name: string;
    first: WakeLink<E> | null;
    last: WakeLink<E> | null;
    /** How many wait on it */
    size: number;
}

/** One waiter: its links on the channels it waits on, none while it waits on nothing. A caller can hold it (`entry`) */
export interface WakeEntry<E = string> {
    readonly entity: E;
    readonly links: WakeLink<E>[];
    /** Every link it ever had, one a channel, to use again */
    readonly made: WakeLink<E>[];
}

const NOBODY: readonly WakeEntry<never>[] = [];

/**
 * A hand can wait on several inventories. Any Alarm removes all of its registrations, even
 * when it is already active. A later sleep registers it anew, changing its place in each list.
 * The native pink source/destination trace observes precisely this cross-channel transition.
 *
 * It runs in every tick of a simulation under the new dispatch: a channel's list is linked through its waiters, so a
 * registration or an Alarm moves nobody else, each waiter keeps its links, so that an Alarm unlinks it from its own
 * channels alone, and a caller that holds its channels and entries (InserterScheduling) calls the `...Entry` methods,
 * which are the same lists without the lookups. An entity is any value compared by identity.
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
            assert(channel.size === 0, "Duplicate wake channel");
            assert(new Set(entities).size === entities.length, "Duplicate wake registration");
            for (const entity of entities) {
                const entry = this.entry(entity);
                const link = linkOf(entry, channel);
                link.previous = channel.last;
                link.next = null;
                if (channel.last === null) channel.first = link;
                else channel.last.next = link;
                channel.last = link;
                channel.size++;
                entry.links.push(link);
            }
        }
    }

    /** The channel of this name, made empty when there is none yet */
    public channel(name: string): WakeChannel<E> {
        let channel = this.channels.get(name);
        if (channel === undefined) {
            channel = {name, first: null, last: null, size: 0};
            this.channels.set(name, channel);
        }
        return channel;
    }

    /** The entity's entry, made (waiting on nothing) when there is none yet */
    public entry(entity: E): WakeEntry<E> {
        let entry = this.entries.get(entity);
        if (entry === undefined) {
            entry = {entity, links: [], made: []};
            this.entries.set(entity, entry);
        }
        return entry;
    }

    public clear(entity: E): void {
        const entry = this.entries.get(entity);
        if (entry !== undefined) this.clearEntry(entry);
    }

    public clearEntry(entry: WakeEntry<E>): void {
        const links = entry.links;
        for (let link = links.pop(); link !== undefined; link = links.pop()) {
            const {channel, previous, next} = link;
            if (previous === null) channel.first = next;
            else previous.next = next;
            if (next === null) channel.last = previous;
            else next.previous = previous;
            link.previous = link.next = null;
            channel.size--;
        }
    }

    public register(entity: E, channels: readonly string[]): void {
        this.registerEntry(this.entry(entity), channels.map(name => this.channel(name)));
    }

    /** Registers the entry on each channel, first in its list; a channel named twice counts once */
    public registerEntry(entry: WakeEntry<E>, channels: readonly WakeChannel<E>[]): void {
        this.clearEntry(entry);
        const links = entry.links;
        for (let index = 0; index < channels.length; index++) {
            const channel = channels[index];
            if (links.length > 0 && links.some(link => link.channel === channel)) continue;
            const link = linkOf(entry, channel);
            link.previous = null;
            link.next = channel.first;
            if (channel.first === null) channel.last = link;
            else channel.first.previous = link;
            channel.first = link;
            channel.size++;
            links.push(link);
        }
    }

    /** Collecting one channel unlinks the collected hands from every channel before dispatch. */
    public take(channel: string): E[] {
        const named = this.channels.get(channel);
        return named === undefined ? [] : this.takeEntries(named).map(entry => entry.entity);
    }

    public takeEntries(channel: WakeChannel<E>): readonly WakeEntry<E>[] {
        if (channel.size === 0) return NOBODY;
        const taken: WakeEntry<E>[] = [];
        for (let link = channel.first; link !== null; link = link.next) taken.push(link.entry);
        for (let index = 0; index < taken.length; index++) this.clearEntry(taken[index]);
        return taken;
    }

    public state(): WakeSubscriptionState<E>[] {
        return [...this.channels.values()].filter(channel => channel.size > 0)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(channel => ({channel: channel.name, entities: entitiesOf(channel)}));
    }
}

/** The entry's link for the channel: the one it had before, or a new one */
function linkOf<E>(entry: WakeEntry<E>, channel: WakeChannel<E>): WakeLink<E> {
    const made = entry.made;
    for (let index = 0; index < made.length; index++) if (made[index].channel === channel) return made[index];
    const link: WakeLink<E> = {entry, channel, previous: null, next: null};
    made.push(link);
    return link;
}

function entitiesOf<E>(channel: WakeChannel<E>): E[] {
    const entities: E[] = [];
    for (let link = channel.first; link !== null; link = link.next) entities.push(link.entry.entity);
    return entities;
}
