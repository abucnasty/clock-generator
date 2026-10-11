import { describe, expect, it } from "vitest";
import { Option } from "./option";

describe("Option", () => {
    it("maps a Some and leaves a None", () => {
        expect(Option.map(Option.some(2), it => it * 2)).toEqual(Option.some(4));
        expect(Option.map(Option.none<number>(), it => it * 2)).toEqual(Option.none());
    });

    it("flatMaps into another Option", () => {
        expect(Option.flatMap(Option.some(2), it => Option.some(`${it}`))).toEqual(Option.some("2"));
        expect(Option.flatMap(Option.some(2), () => Option.none())).toEqual(Option.none());
        expect(Option.flatMap(Option.none<number>(), it => Option.some(it))).toEqual(Option.none());
    });

    it("takes the other Option or the fallback only for a None", () => {
        expect(Option.orElse(Option.some(1), () => Option.some(2))).toEqual(Option.some(1));
        expect(Option.orElse(Option.none<number>(), () => Option.some(2))).toEqual(Option.some(2));
        expect(Option.getOrElse(Option.some(1), () => 9)).toBe(1);
        expect(Option.getOrElse(Option.none<number>(), () => 9)).toBe(9);
        expect(Option.toNullable(Option.none())).toBeNull();
    });

    it("matches both cases", () => {
        const describeOption = (it: Option<number>) => Option.match(it, { none: () => "nothing", some: value => `got ${value}` });
        expect(describeOption(Option.some(3))).toBe("got 3");
        expect(describeOption(Option.none())).toBe("nothing");
    });

    it("folds the Somes into one value and is None when there are none", () => {
        const add = (a: number, b: number) => a + b;
        expect(Option.fold([Option.some(1), Option.none(), Option.some(2)], add)).toEqual(Option.some(3));
        expect(Option.fold([Option.none<number>(), Option.none<number>()], add)).toEqual(Option.none());
        expect(Option.fold<number>([], add)).toEqual(Option.none());
    });
});
