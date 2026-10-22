/**
 * Which generator made a clock, so whoever finds one in a game or a blueprint library can find the generator: its name,
 * the engine's version from its package.json, its site and its source. Every clock blueprint carries it, in the
 * blueprint's description, as the clock decider's last line and in the clock decider's tags.
 */

// package.json is outside src/ (tsc's rootDir), so it is read with require rather than imported: from
// src/generator.ts and from dist/generator.js alike, it is one folder up; a bundler (the web app's) inlines it
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require("../package.json") as { version: string };

export const GENERATOR = {
    name: "Clock Generator",
    version,
    site: "https://clock-generator-self.vercel.app",
    source: "https://github.com/abucnasty/clock-generator",
} as const;

/** The site without its scheme, as a line of text shows it */
export const GENERATOR_SITE_TEXT = GENERATOR.site.replace(/^https:\/\//, "");
