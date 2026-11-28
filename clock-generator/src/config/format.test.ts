import { describe, expect, it } from "vitest";
import { CONFIG_FORMAT, ConfigFormatError, configFormatMessage, configFormatProblem, withConfigFormat } from "./format";
import { ConfigSchema } from "./schema";

describe("configFormatProblem", () => {
    it("reads a configuration of this format", () => {
        expect(CONFIG_FORMAT).toBe(1);
        expect(configFormatProblem({ format: 1, machines: [] })).toBeNull();
    });

    it("calls a configuration without the key, or with one that is no whole number of at least 1, old", () => {
        for (const value of [{}, { format: 0 }, { format: -3 }, { format: 1.5 }, { format: "1" }, { format: null }, [], null, "text", 1]) {
            expect(configFormatProblem(value), JSON.stringify(value)).toBe("old");
        }
    });

    it("calls a higher number newer", () => {
        expect(configFormatProblem({ format: 2 })).toBe("newer");
        expect(configFormatProblem({ format: 40 })).toBe("newer");
    });
});

describe("withConfigFormat", () => {
    it("puts the key first, in place of one the configuration had", () => {
        const written = withConfigFormat({ setpoint: { item: "iron-plate" }, format: 7, machines: [] });
        expect(Object.keys(written)).toEqual(["format", "setpoint", "machines"]);
        expect(written.format).toBe(1);
    });
});

describe("the key and the schema", () => {
    it("is not declared, so a parsed configuration carries none", () => {
        const parsed = ConfigSchema.parse({ format: 1, setpoint: { item: "iron-gear-wheel", items_per_second: 1, copies: 1 }, machines: [], inserters: [], belts: [] });
        expect("format" in parsed).toBe(false);
    });
});

describe("ConfigFormatError", () => {
    it("is one line, with the file when it is given", () => {
        const error = new ConfigFormatError("old", "build.json");
        expect(error.problem).toBe("old");
        expect(error.message).toBe(`build.json: ${configFormatMessage("old")}`);
        expect(error.message).not.toContain("\n");
        expect(new ConfigFormatError("newer").message).toBe(configFormatMessage("newer"));
    });
});
