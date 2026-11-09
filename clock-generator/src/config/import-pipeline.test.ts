import { describe, expect, it } from "vitest";
import * as O from "fp-ts/Option";
import { ImportInput, ImportPipeline, ImportStep } from "./import-pipeline";

const input: ImportInput = { sidecar_version: "1.0.0", machines: [] };
const says = (message: string): ImportStep => () => O.some(message);
const nothing: ImportStep = () => O.none;

describe("ImportPipeline", () => {
    it("has no message when every step has nothing to say", () => {
        expect(ImportPipeline.of(nothing, nothing).run(input)).toEqual(O.none);
        expect(ImportPipeline.empty().run(input)).toEqual(O.none);
    });

    it("folds the messages of its steps into one, in order, skipping steps with nothing to say", () => {
        const pipeline = ImportPipeline.of(says("A."), nothing).then(says("C."));
        expect(pipeline.run(input)).toEqual(O.some("A. C."));
    });

    it("folds with the combine it is given", () => {
        expect(ImportPipeline.of(says("a"), says("b"), says("c")).run(input, (x, y) => `${x}, ${y}`)).toEqual(O.some("a, b, c"));
    });

    it("gives every step the same input", () => {
        const seen: ImportInput[] = [];
        const spy: ImportStep = it => { seen.push(it); return O.none; };
        ImportPipeline.of(spy, spy).run(input);
        expect(seen).toEqual([input, input]);
    });

    it("does not change the pipeline it builds on", () => {
        const base = ImportPipeline.of(says("A."));
        base.then(says("B."));
        expect(base.run(input)).toEqual(O.some("A."));
    });

    it("joins pipelines", () => {
        expect(ImportPipeline.of(says("A.")).concat(ImportPipeline.of(says("B."))).run(input)).toEqual(O.some("A. B."));
    });

    it("runs the fallback only when no step had anything to say", () => {
        expect(ImportPipeline.of(says("A.")).otherwise(says("fallback")).run(input)).toEqual(O.some("A."));
        expect(ImportPipeline.of(nothing).otherwise(says("fallback")).run(input)).toEqual(O.some("fallback"));
        expect(ImportPipeline.of(nothing).otherwise(nothing).run(input)).toEqual(O.none);
    });
});
