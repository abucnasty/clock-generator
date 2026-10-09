/** A value that may be missing: None, or Some holding the value */
export type Option<A> =
    | { readonly _tag: "None" }
    | { readonly _tag: "Some", readonly value: A };

const NONE: Option<never> = { _tag: "None" };

function none<A = never>(): Option<A> {
    return NONE;
}

function some<A>(value: A): Option<A> {
    return { _tag: "Some", value };
}

function isSome<A>(option: Option<A>): option is { readonly _tag: "Some", readonly value: A } {
    return option._tag === "Some";
}

function isNone<A>(option: Option<A>): option is { readonly _tag: "None" } {
    return option._tag === "None";
}

/** Applies f to the value of a Some; a None stays a None */
function map<A, B>(option: Option<A>, f: (value: A) => B): Option<B> {
    return isSome(option) ? some(f(option.value)) : NONE;
}

/** Continues with the Option f makes from the value of a Some; a None stays a None */
function flatMap<A, B>(option: Option<A>, f: (value: A) => Option<B>): Option<B> {
    return isSome(option) ? f(option.value) : NONE;
}

/** The option itself when it is a Some, else the other one */
function orElse<A>(option: Option<A>, other: () => Option<A>): Option<A> {
    return isSome(option) ? option : other();
}

/** Takes the value of a Some, or what the fallback gives for a None */
function getOrElse<A>(option: Option<A>, fallback: () => A): A {
    return isSome(option) ? option.value : fallback();
}

/** Takes one of two ways out of an Option */
function match<A, B>(option: Option<A>, cases: { none: () => B, some: (value: A) => B }): B {
    return isSome(option) ? cases.some(option.value) : cases.none();
}

function toNullable<A>(option: Option<A>): A | null {
    return isSome(option) ? option.value : null;
}

/** The values of the Somes, in order */
function compact<A>(options: readonly Option<A>[]): A[] {
    return options.flatMap(it => isSome(it) ? [it.value] : []);
}

/**
 * Folds the Somes into one value with combine, or None when there are none. The Nones are skipped:
 * none of them has anything to add.
 */
function fold<A>(options: readonly Option<A>[], combine: (accumulated: A, next: A) => A): Option<A> {
    const values = compact(options);
    return values.length === 0 ? NONE : some(values.reduce(combine));
}

export const Option = { none, some, isSome, isNone, map, flatMap, orElse, getOrElse, match, toNullable, compact, fold };
