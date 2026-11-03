import assert from "../common/assert";
import type {SimulationContext} from "../crafting/sequence/simulation-context";
import {EntityState} from "../state/entity-state";
import type {InserterListing} from "../state/factorio-entity-state";
import {ActiveScheduler, ActiveSchedulerState, ScheduledNode, SchedulingEvent} from "./active-scheduler";
import type {LeavesList, WokenInWalk} from "./dispatch";
import type {InserterArchetype} from "./archetypes/inserter";
import {WakeChannel, WakeEntry, WakeSubscriptions, WakeSubscriptionState} from "./wake-subscriptions";

export interface InserterSchedulingState extends ActiveSchedulerState {
    readonly wake_subscriptions?: readonly WakeSubscriptionState[];
    readonly updating?: {entity: string; picked: boolean} | null;
    /** With `leaves` "next-update": the members whose last update found them waiting, still in the list */
    readonly leaving?: readonly string[];
}

/** The two points of the list the observations leave open (simulation/dispatch.ts) */
export interface InserterSchedulingOptions {
    readonly woken_in_walk?: WokenInWalk;
    readonly leaves?: LeavesList;
}

/**
 * One inserter of the scheduling: what is bound for it at the start (its id, the channels it waits on), its node in the
 * scheduler and its entry in the wake lists, so that no step of a tick looks it up
 */
interface Member {
    readonly id: string;
    readonly inserter: InserterArchetype;
    /** The output channel of its source, when the source is a machine */
    readonly machine_source: WakeChannel<Member> | undefined;
    /** The input channel of its sink, when the sink is a machine with readiness notifications */
    readonly machine_sink: WakeChannel<Member> | undefined;
    readonly polling_sink: boolean;
    /** What it registers on as it sleeps, by its reason (completeUpdate): made once */
    readonly waits_for_source: readonly WakeChannel<Member>[];
    /** After a partial take: its sink's input channel, whatever the sink, and its source's */
    readonly waits_for_both: readonly WakeChannel<Member>[];
    readonly waits_for_sink: readonly WakeChannel<Member>[];
    /** Its place in the update list (set once the scheduler is made) */
    node: ScheduledNode<Member>;
    /** Its registrations on the wake lists */
    readonly wait: WakeEntry<Member>;
    /** With `leaves` "next-update": its last update found it waiting, and it is still in the list */
    leaving: boolean;
}

/**
 * Machine/hand notification integration. The context owns its lifetime and live connections;
 * sleep registrations are behavior state, independent of those connections and active membership.
 * Native activation outcomes are never inputs to these handlers.
 *
 * It runs in every tick under the new dispatch, so it holds each inserter's node in the scheduler and entry in the wake
 * lists (no lookup by id or inserter in a tick), an Alarm that changes nothing returns at once, and events are made only
 * while somebody observes them.
 */
export class InserterScheduling {
    private readonly scheduler: ActiveScheduler<Member>;
    private readonly observers: ((event: SchedulingEvent) => void)[] = [];
    private readonly by_id: ReadonlyMap<string, Member>;
    /** In the order given, the order finishControls delivers in */
    private readonly members: readonly Member[];
    private readonly member_of = new Map<InserterArchetype, Member>();
    private readonly waits = new WakeSubscriptions<Member>();
    /** The inserter whose Update is open, and its pickups before it */
    private updating: Member | null = null;
    private updating_pickups_before = 0;
    private readonly leaves: LeavesList;
    private observing: boolean;

    constructor(context: SimulationContext, order: readonly InserterArchetype[],
        private readonly observe_with?: (event: SchedulingEvent) => void, state?: InserterSchedulingState,
        options: InserterSchedulingOptions = {}) {
        this.leaves = options.leaves ?? "after-update";
        const inserters = new Map(order.map(inserter => [inserter.entity_id.id, inserter]));
        const initial = state ?? {active_order: [...inserters.keys()], remaining_updates: null, pending_next_phase: []};
        assert([...initial.active_order, ...(initial.remaining_updates ?? []), ...initial.pending_next_phase]
            .every(id => inserters.has(id)), "Scheduler state refers to an unknown inserter");
        for (const id of state?.leaving ?? []) assert(inserters.has(id), "Leaving state refers to an unknown inserter");
        assert((state?.wake_subscriptions ?? []).every(channel => channel.entities.every(id => inserters.has(id))),
            "Wake state refers to an unknown inserter");
        if (state?.updating) assert(inserters.has(state.updating.entity), "Update state refers to an unknown inserter");

        const connected = new Set<string>();
        const members: Member[] = [];
        for (const inserter of inserters.values()) {
            inserter.hand.useNotificationScheduling();
            const id = inserter.entity_id.id;
            const definition = inserter.inserter_state.inserter;
            const source = context.state_registry.getStateByEntityIdOrThrow(definition.source.entity_id);
            const sink = context.state_registry.getStateByEntityIdOrThrow(definition.sink.entity_id);
            const source_channel = this.waits.channel(`${source.entity_id.id}:output`);
            const sink_channel = this.waits.channel(`${sink.entity_id.id}:input`);
            const polling_sink = inserter.hand.drop.requiresReadinessPolling?.() === true;
            let machine_source: WakeChannel<Member> | undefined, machine_sink: WakeChannel<Member> | undefined;
            if (EntityState.isMachine(source)) {
                machine_source = source_channel;
                if (!connected.has(source_channel.name)) {
                    connected.add(source_channel.name);
                    source.yield.notifications.subscribeOutput(cause => this.notify(source_channel, cause));
                }
            }
            if (EntityState.isMachine(sink)) {
                if (!polling_sink) machine_sink = sink_channel;
                if (!connected.has(sink_channel.name)) {
                    connected.add(sink_channel.name);
                    sink.yield.notifications.subscribeInput(cause => this.notify(sink_channel, cause));
                }
            }
            const member: Member = {id, inserter, machine_source, machine_sink, polling_sink,
                waits_for_source: machine_source === undefined ? [] : [machine_source],
                waits_for_both: machine_source === undefined ? [sink_channel] : [sink_channel, machine_source],
                waits_for_sink: machine_sink === undefined ? [] : [machine_sink],
                node: null!, wait: null!, leaving: false};
            (member as {wait: WakeEntry<Member>}).wait = this.waits.entry(member);
            inserter.hand.notifications.subscribe(cause => this.alarm(member, cause));
            members.push(member);
            this.member_of.set(inserter, member);
        }
        this.members = members;
        const by_id = this.by_id = new Map(members.map(member => [member.id, member]));
        const of = (id: string) => by_id.get(id)!;
        this.scheduler = new ActiveScheduler<Member>({
            active_order: initial.active_order.map(of),
            remaining_updates: initial.remaining_updates?.map(of) ?? null,
            pending_next_phase: initial.pending_next_phase.map(of),
        }, undefined, options.woken_in_walk ?? "next-tick");
        for (const member of members) member.node = this.scheduler.node(member);
        for (const id of state?.leaving ?? []) of(id).leaving = true;
        this.waits.restore((state?.wake_subscriptions ?? []).map(({channel, entities}) => ({channel, entities: entities.map(of)})));
        if (state?.updating) {
            this.updating = of(state.updating.entity);
            this.updating_pickups_before = this.updating.inserter.inserter_state.items_picked_up - Number(state.updating.picked);
        }
        this.observing = observe_with !== undefined;
        if (this.observing) this.scheduler.observeWith(this.deliverEvent);
    }

    /** The scheduler's event for the observers, with the inserter's id */
    private readonly deliverEvent = (event: SchedulingEvent<Member>): void => {
        const named: SchedulingEvent = {event: event.event, entity: event.entity.id, cause: event.cause};
        this.observe_with?.(named);
        for (const observer of this.observers) observer(named);
    };

    private alarm(member: Member, cause: string): void {
        const node = member.node;
        // in the list, waiting on nothing and not leaving: the Alarm changes nothing, and nobody sees it
        if (node.active && member.wait.links.length === 0 && !member.leaving && !this.observing) return;
        this.waits.clearEntry(member.wait);
        member.leaving = false;
        if (this.observing) this.scheduler.deliverAlarm(member, cause, true);
        else this.scheduler.activateNode(node, cause);
    }

    private notify(channel: WakeChannel<Member>, cause: string): void {
        if (channel.size === 0) return;
        for (const {entity} of this.waits.takeEntries(channel)) this.alarm(entity, cause);
    }

    /** Diagnostic delivery does not enter the recurrence key. */
    public observe(observer: (event: SchedulingEvent) => void): void {
        this.observers.push(observer);
        this.observing = true;
        this.scheduler.observeWith(this.deliverEvent);
    }

    public beginUpdates(): void { this.scheduler.beginUpdates(); }

    public nextUpdate(): InserterArchetype | null {
        const node = this.scheduler.nextUpdateNode();
        if (node === null) return null;
        const member = node.entity;
        this.updating = member;
        this.updating_pickups_before = member.inserter.inserter_state.items_picked_up;
        return member.inserter;
    }

    /** Sources without production notification coverage keep polling until their integration is validated. */
    public completeUpdate(inserter: InserterArchetype): void {
        const updating = this.updating;
        const member = updating !== null && updating.inserter === inserter ? updating : this.member_of.get(inserter)!;
        const picked = updating === member && inserter.inserter_state.items_picked_up > this.updating_pickups_before;
        this.updating = null;
        // Planning controls may latch when asked. They retain polling until their own control
        // notification semantics exist; pure clock lookahead does not perform an extra latched read.
        if (!inserter.control.looks_ahead) return;
        const reason = inserter.hand.sleepReason();
        if (reason === null) {
            member.leaving = false;
            return;
        }
        if (this.leaves === "next-update" && !member.leaving) {
            // stays for one more update; an Alarm meanwhile finds it active and keeps its place
            if (this.waitsWith(member, reason)) member.leaving = true;
            return;
        }
        member.leaving = false;
        const source = member.machine_source, sink = member.machine_sink;
        if (reason === "source-empty" && source !== undefined) {
            // A successful partial take checks both ends before sleep. Ports without complete
            // readiness notifications keep polling rather than inventing native wakeability, but a belt
            // lane with room at the drop spot lets the hand sleep on both ends, as the game does (its
            // machine's next result in the same tick then wakes it again: HandDropPort.roomForStack).
            if (picked && member.polling_sink && inserter.hand.drop.roomForStack?.() !== true) return;
            this.waits.registerEntry(member.wait, picked ? member.waits_for_both : member.waits_for_source);
            this.scheduler.deactivateNode(member.node, reason);
        } else if (reason === "destination-refused" && sink !== undefined) {
            this.waits.registerEntry(member.wait, member.waits_for_sink);
            this.scheduler.deactivateNode(member.node, reason);
        } else if (reason === "control-disabled") {
            // An Update that finds the hand disabled leaves it on no list, as in the game (2.1.24). A hand its clock
            // switched off while it slept was not updated, so it keeps its lists until one of them wakes it: that
            // wake-up is the game's too, and the Update it brings ends here.
            this.waits.clearEntry(member.wait);
            this.scheduler.deactivateNode(member.node, reason);
        }
    }

    /** Whether a sleep with this reason leaves the list (the reasons completeUpdate deactivates on) */
    private waitsWith(member: Member, reason: string): boolean {
        if (reason === "source-empty") return member.machine_source !== undefined;
        if (reason === "destination-refused") return member.machine_sink !== undefined;
        return reason === "control-disabled";
    }

    /**
     * Finish-dispatch edges arrive after entity Updates and are eligible in the next phase. Every control that looks
     * ahead answers from the clock alone (`Control.looks_ahead`), so asking it is free of effects.
     *
     * While nobody observes, an edge changes something only for an inserter out of the list, waiting or leaving (a
     * stirred one): an Alarm to any other changes nothing. So only the stirred inserters' edges are delivered, in the
     * order all the edges would be; an unstirred inserter is asked only when its control has no decider build order,
     * since one opening edge without it keeps the edges in the inserters' order.
     */
    public finishControls(): void {
        const members = this.members;
        let opening: Member[] | null = null;
        let ordered = true;
        for (let index = 0; index < members.length; index++) {
            const member = members[index];
            const stirred = this.observing || !member.node.active || member.wait.links.length > 0 || member.leaving;
            const unordered = member.inserter.control.decider_build_order === undefined;
            if (!stirred && (!ordered || !unordered)) continue;
            if (!opensNextTick(member.inserter)) continue;
            if (unordered) ordered = false;
            if (stirred) (opening ??= []).push(member);
        }
        if (opening === null) return;
        // Known decider build order already belongs to the exported clock. Its native forward/
        // reversed controls require last-built-first Updates. Deliver ascending so new attachments
        // lead in reverse. Unknown orders keep the trial scenario, without inventing build facts.
        if (ordered) opening.sort((a, b) => a.inserter.control.decider_build_order! - b.inserter.control.decider_build_order!);
        for (const member of opening) this.alarm(member, "control-finish-enable-edge");
    }

    public endUpdates(): void { this.scheduler.endUpdates(); }

    /** Where the inserter is: on the update list, out of it asleep on the list of the machine it takes from, or elsewhere */
    public listingOf(inserter: InserterArchetype): InserterListing {
        const member = this.member_of.get(inserter);
        if (member === undefined) return "elsewhere";
        if (member.node.active) return "update-list";
        if (member.machine_source === undefined) return "elsewhere";
        const links = member.wait.links;
        for (let index = 0; index < links.length; index++) if (links[index].channel === member.machine_source) return "asleep-for-items";
        return "elsewhere";
    }
    public state(): InserterSchedulingState {
        const scheduler = this.scheduler.state();
        const id = (member: Member) => member.id;
        const leaving = this.members.filter(member => member.leaving).map(id).sort();
        const updating = this.updating;
        return {
            active_order: scheduler.active_order.map(id),
            remaining_updates: scheduler.remaining_updates?.map(id) ?? null,
            pending_next_phase: scheduler.pending_next_phase.map(id).sort(),
            wake_subscriptions: this.waits.state().map(({channel, entities}) => ({channel, entities: entities.map(id)})),
            ...(leaving.length > 0 && {leaving}),
            updating: updating === null ? null : {
                entity: updating.id,
                picked: updating.inserter.inserter_state.items_picked_up > this.updating_pickups_before,
            },
        };
    }
    public key(): string { return JSON.stringify(this.state()); }
}

/**
 * Whether the inserter's control opens next tick: closed now and open next tick, for a control that looks ahead. Next
 * tick is asked first: a sleeping inserter is mostly in a closed window, where that one answer settles it.
 */
function opensNextTick(inserter: InserterArchetype): boolean {
    const control = inserter.control;
    return control.looks_ahead && control.enabledIn(1) && !control.enabledIn(0);
}
