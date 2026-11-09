import * as A from "fp-ts/Array";
import { pipe } from "fp-ts/function";
import * as NEA from "fp-ts/NonEmptyArray";
import * as O from "fp-ts/Option";

/**
 * Checks of data imported from outside the clock generator (the sidecar mod) that guide the user.
 *
 * A step looks at the import and has either nothing to say (None) or a message about what the user is missing
 * (Some). A pipeline runs its steps and folds the messages they have into one, so the user gets a single piece of
 * guidance that grows with every feature their version of the mod lacks:
 *
 *     ImportPipeline.of(stepA).then(stepB).run(input)  // O.Option<string>
 */

export interface ImportedMachine {
    recipe: string;
    /** The former simulation rule, which sidecars before 0.12.0 exported */
    type?: string;
    prototype?: string;
}

/** What a step gets to look at */
export interface ImportInput {
    /** The version of the mod that exported the data; null when it did not say, as before it exported one */
    sidecar_version: string | null;
    machines: readonly ImportedMachine[];
    chests?: readonly unknown[];
    inserters?: readonly unknown[];
    drills?: readonly unknown[];
}

export type ImportStep = (input: ImportInput) => O.Option<string>;

export class ImportPipeline {
    public static readonly of = (...steps: ImportStep[]) => new ImportPipeline(steps);
    public static readonly empty = () => new ImportPipeline([]);

    private constructor(
        public readonly steps: readonly ImportStep[],
        private readonly fallback?: ImportStep,
    ) { }

    /** A pipeline that runs this one's steps and then the given steps */
    public then(...next: ImportStep[]): ImportPipeline {
        return new ImportPipeline([...this.steps, ...next], this.fallback);
    }

    /** A pipeline that runs this one's steps and then those of another pipeline */
    public concat(other: ImportPipeline): ImportPipeline {
        return new ImportPipeline([...this.steps, ...other.steps], other.fallback ?? this.fallback);
    }

    /** A pipeline that runs the given step only when none of the steps before it had anything to say */
    public otherwise(fallback: ImportStep): ImportPipeline {
        return new ImportPipeline(this.steps, fallback);
    }

    /** The messages of the steps folded into one, in the order of the steps; None when no step had anything to say */
    public run(input: ImportInput, combine: (accumulated: string, next: string) => string = joinSentences): O.Option<string> {
        return pipe(
            this.steps.map(step => step(input)),
            A.compact,
            NEA.fromArray,
            O.map(messages => messages.reduce(combine)),
            O.alt(() => this.fallback?.(input) ?? O.none),
        );
    }
}

function joinSentences(accumulated: string, next: string): string {
    return `${accumulated} ${next}`;
}
