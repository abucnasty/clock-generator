import { z } from "zod";

/** The most the game keeps of a bulk inserter's capacity bonus */
const BULK_CAPACITY_MAX = 254;
/** The longest name of a research profile */
const PROFILE_NAME_MAX = 60;

const percent = z.number().finite().min(0);
const whole = z.number().int().min(0);
const entityId = z.number().int().positive();

/**
 * The numbers of a game's force that a build was made with: the research of the force, as the final numbers. Productivity is
 * in percent, as a machine's `productivity`; the stack bonuses are in items.
 */
const ResearchBonusesSchema = z.object({
    mining_drill_productivity_bonus: percent.describe("The mining productivity that research gives every mining drill, in percent."),
    inserter_stack_size_bonus: whole.describe("The items that research adds to the hand of an inserter that is not a bulk inserter."),
    bulk_inserter_capacity_bonus: whole.max(BULK_CAPACITY_MAX).describe("The items that research adds to the hand of a bulk inserter and of a stack inserter, 0 to 254."),
    belt_stack_size_bonus: whole.describe("The items that research adds to a stack on a belt lane. A stack holds at most 4 whatever it is."),
    recipes: z.record(z.string(), z.object({
        productivity_bonus: percent.describe("The productivity that research gives the recipe, in percent."),
    })).describe("The productivity that research gives each recipe, by the name of the recipe. A recipe that is not here has 0."),
});

/** What each entity has apart from research, by its number, so that another set of research numbers can be put on it */
const ResearchBaseSchema = z.object({
    machines: z.array(z.object({
        id: entityId.describe("The number of the machine."),
        recipe: z.string().describe("The recipe that the machine made when the base was taken."),
        productivity: percent.describe("The productivity of the machine without research, in percent."),
    })).describe("The machines that research gives productivity."),
    drills: z.array(z.object({
        id: entityId.describe("The number of the drill."),
        productivity: percent.describe("The productivity of the drill without research, in percent."),
    })).describe("The mining drills that research gives productivity."),
    silos: z.array(z.object({
        id: entityId.describe("The number of the rocket silo."),
        recipe: z.string().describe("The recipe of the rocket silo."),
        productivity: percent.describe("The productivity of the rocket silo without research, in percent."),
    })).describe("The rocket silos that research gives productivity."),
    inserters: z.array(z.object({
        id: entityId.describe("The number of the inserter."),
        stack_size: z.number().int().positive().optional().describe("The hand that the blueprint sets for the inserter. Research does not change it."),
    })).describe("The inserters that research gives a hand."),
    belts: z.array(z.object({
        id: entityId.describe("The number of the belt."),
    })).describe("The belts whose lanes research gives a stack size."),
});

/**
 * The research a build was made with: the name of the profile, the template it came from, the final numbers, and the base
 * that they were put on. Nothing reads it when the clock is made: the machines, drills, inserters and belts hold the values.
 * It is kept so that a saved build or a link shows the research that the values come from.
 */
export const ResearchBlockSchema = z.object({
    profile: z.string().min(1).max(PROFILE_NAME_MAX).describe("The name of the research profile, for labels only."),
    template: z.enum(["no-research", "all-finite-research"]).nullable().describe("The template that the profile was made from, or null."),
    bonuses: ResearchBonusesSchema.describe("The research numbers that the values of the build were made with."),
    base: ResearchBaseSchema.describe("The values of the build without research, by entity number."),
});

export type ResearchBlock = z.infer<typeof ResearchBlockSchema>;
export type ResearchBonuses = ResearchBlock["bonuses"];
export type ResearchBase = ResearchBlock["base"];
