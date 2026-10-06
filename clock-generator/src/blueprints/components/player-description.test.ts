import { describe, expect, it } from "vitest";
import { fitPlayerDescription, MAX_PLAYER_DESCRIPTION_BYTES } from "./player-description";

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("fitPlayerDescription", () => {
    it("joins the lines when they fit", () => {
        expect(fitPlayerDescription(["Inserter 1", "Swing Counts:", "- total: 2"])).toBe("Inserter 1\nSwing Counts:\n- total: 2");
    });

    it("keeps a description of exactly the limit", () => {
        const text = "x".repeat(MAX_PLAYER_DESCRIPTION_BYTES);
        expect(fitPlayerDescription([text])).toBe(text);
    });

    it("keeps the first lines that fit and marks that more were left out", () => {
        const lines = Array.from({ length: 20 }, (_, index) => `line ${index} ${"y".repeat(40)}`);
        const description = fitPlayerDescription(lines);
        expect(bytes(description)).toBeLessThanOrEqual(MAX_PLAYER_DESCRIPTION_BYTES);
        expect(description.startsWith(lines[0] + "\n" + lines[1])).toBe(true);
        expect(description.endsWith("\n...")).toBe(true);
        expect(description).not.toContain(lines[19]);
    });

    it("cuts a first line that is too long on its own", () => {
        const description = fitPlayerDescription(["z".repeat(2000), "second"]);
        expect(bytes(description)).toBeLessThanOrEqual(MAX_PLAYER_DESCRIPTION_BYTES);
        expect(description.endsWith("...")).toBe(true);
        expect(description).not.toContain("second");
    });

    it("counts bytes, not characters, and does not cut a character in half", () => {
        // each of these takes 3 bytes
        const description = fitPlayerDescription(["€".repeat(400)]);
        expect(bytes(description)).toBeLessThanOrEqual(MAX_PLAYER_DESCRIPTION_BYTES);
        expect(description).toMatch(/^€+\.\.\.$/);
    });

    it("takes the limit it is given", () => {
        expect(fitPlayerDescription(["abcdef", "ghijkl"], 10)).toBe("abcdef\n...");
    });
});
