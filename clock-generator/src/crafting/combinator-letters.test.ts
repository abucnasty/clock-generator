import { describe, expect, it } from "vitest";
import { COMBINATOR_COLOURS, combinatorKey, combinatorLetters, letterOfIndex } from "./combinator-letters";

const groups = (inserters: number[][], drills: number[][] = []) => ({ inserters, drills });
const letterOf = (map: ReturnType<typeof combinatorLetters>, kind: "inserter" | "drill", ids: number[]) => map.get(combinatorKey(kind, ids));

describe("combinatorLetters", () => {
    it("gives the inserter groups A, B, ... in the order of their first config id, and the drill groups the letters after them", () => {
        const letters = combinatorLetters(groups([[5, 14], [1, 11], [2, 12]], [[2], [1]]));
        expect(letterOf(letters, "inserter", [1, 11])).toEqual({ letter: "A", colour: 0, round: false });
        expect(letterOf(letters, "inserter", [2, 12])).toEqual({ letter: "B", colour: 1, round: false });
        expect(letterOf(letters, "inserter", [5, 14])).toEqual({ letter: "C", colour: 2, round: false });
        expect(letterOf(letters, "drill", [1])?.letter).toBe("D");
        expect(letterOf(letters, "drill", [2])?.letter).toBe("E");
    });

    it("does not change when the groups, or the ids inside a group, come in another order", () => {
        const sets = [[1, 11], [2, 12], [3, 20], [4, 18], [5, 14], [6, 16], [7], [8, 15], [9, 17], [10, 21], [13, 19]];
        const plain = combinatorLetters(groups(sets, [[3, 4], [1, 2]]));
        const shuffled = combinatorLetters(groups(
            [...sets].reverse().map(ids => [...ids].reverse()),
            [[1, 2], [4, 3]],
        ));
        expect([...shuffled.entries()].sort()).toEqual([...plain.entries()].sort());
        // a fixed clock keeps its letters: inserters 5 and 14 are E, 6 and 16 are F
        expect(letterOf(plain, "inserter", [5, 14])?.letter).toBe("E");
        expect(letterOf(plain, "inserter", [6, 16])?.letter).toBe("F");
    });

    it("gives the 12th combinator L and colour 1 again, in a round tag, and the 27th AA", () => {
        const twelve = combinatorLetters(groups(Array.from({ length: 12 }, (_, index) => [index + 1])));
        expect(letterOf(twelve, "inserter", [1])).toEqual({ letter: "A", colour: 0, round: false });
        expect(letterOf(twelve, "inserter", [11])).toEqual({ letter: "K", colour: 10, round: false });
        expect(letterOf(twelve, "inserter", [12])).toEqual({ letter: "L", colour: 0, round: true });
        const many = combinatorLetters(groups(Array.from({ length: 28 }, (_, index) => [index + 1])));
        expect(letterOf(many, "inserter", [26])?.letter).toBe("Z");
        expect(letterOf(many, "inserter", [27])).toEqual({ letter: "AA", colour: 4, round: true });
        expect(letterOf(many, "inserter", [28])?.letter).toBe("AB");
    });

    it("gives a group with no ids no letter, and does not count it", () => {
        const letters = combinatorLetters(groups([[], [3], [1]]));
        expect(letters.size).toBe(2);
        expect(letterOf(letters, "inserter", [1])?.letter).toBe("A");
        expect(letterOf(letters, "inserter", [3])?.letter).toBe("B");
    });

    it("names the letters of an index: A to Z, then AA, AB", () => {
        expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(letterOfIndex)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
    });

    it("keeps 11 colours, as many as the page has", () => {
        expect(COMBINATOR_COLOURS).toBe(11);
    });
});
