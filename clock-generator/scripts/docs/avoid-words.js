#!/usr/bin/env node
// Checks that the Markdown lines a change adds use none of the glossary's Avoid words (docs/maintainer/glossary.md):
// each word on an _Avoid_ line is a word that the entry above it replaces. Usage, from clock-generator/:
//   npm run docs:avoid-words -- --base <commit>   the lines added since <commit> (CI: the base of the pull request)
//   npm run docs:avoid-words -- --all             every line of every Markdown file, for a sweep
// Only the words without a qualifier are checked: "build (as a verb)" or "window (bare)" needs a reader. A word is a use,
// not a mention, so these are left out: code spans and blocks, bold labels (the label test checks them), italics, quoted
// text and link targets. docs/avoid-words-allow.tsv lists the words never checked and the phrases in which a word is
// right, each with its reason. The glossary itself and the generated files are not checked.
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const GLOSSARY = "docs/maintainer/glossary.md";
const ALLOW = "docs/avoid-words-allow.tsv";
// the glossary lists the words; the generated files repeat their sources (docs/user, the engine's ConfigSchema)
const SKIPPED = new Set([GLOSSARY, "clock-generator-sidecar/PORTAL.md", "docs/maintainer/configuration-file-fields.md"]);

/** Each Avoid word of the glossary, with the term that replaces it and whether it has a qualifier */
function avoidWords(glossary) {
    const words = [];
    const lines = glossary.split("\n");
    let term = "";
    for (let index = 0; index < lines.length; index += 1) {
        const entry = lines[index].match(/^\*\*(.+?)\*\*:/);
        if (entry) term = entry[1];
        if (!lines[index].startsWith("_Avoid_:")) continue;
        // an Avoid line wraps until the paragraph ends
        let text = lines[index].slice("_Avoid_:".length);
        while (index + 1 < lines.length && lines[index + 1].trim() && !/^(\*\*|#)/.test(lines[index + 1])) text += ` ${lines[++index].trim()}`;
        let depth = 0;
        let current = "";
        for (const char of `${text},`) {
            if (char === "(") depth += 1;
            if (char === ")") depth -= 1;
            if (char !== "," || depth > 0) {
                current += char;
                continue;
            }
            const word = current.trim();
            if (word) words.push({ word: word.replace(/\s*\(.*$/, "").replace(/^"|"$/g, ""), qualified: word.includes("("), term });
            current = "";
        }
    }
    return words;
}

/** The allow list: word -> the phrases in which it is right (none: the word is never checked) */
function allowList(tsv) {
    const allowed = new Map();
    for (const line of tsv.split("\n").slice(1)) {
        if (!line.trim()) continue;
        const [word, phrase] = line.split("\t");
        if (!allowed.has(word.toLowerCase())) allowed.set(word.toLowerCase(), []);
        if (phrase) allowed.get(word.toLowerCase()).push(new RegExp(phrase, "gi"));
    }
    return allowed;
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// blanks keep the columns, so a phrase of the allow list is found where the word is
const blank = match => " ".repeat(match.length);

/** A line with its mentions blanked: code spans, bold labels, italics, quoted text, link targets, HTML comments */
function uses(line) {
    return line
        .replace(/`[^`]*`/g, blank)
        .replace(/<!--.*?-->/g, blank)
        .replace(/\]\([^)]*\)/g, blank)
        .replace(/\*\*[^*]+\*\*/g, blank)
        .replace(/(^|[^\w*])\*[^*\s][^*]*\*(?![\w*])/g, blank)
        .replace(/(^|\W)_[^_\s][^_]*_(?!\w)/g, blank)
        .replace(/"[^"\n]*"|“[^”\n]*”/g, blank);
}

/** The Avoid words a line uses: [{ word, term }] */
function avoidedIn(line, words, allowed) {
    const text = uses(line);
    const found = [];
    for (const { word, qualified, term } of words) {
        const phrases = allowed.get(word.toLowerCase());
        if (qualified || (phrases && phrases.length === 0)) continue;
        for (const match of text.matchAll(new RegExp(`(?<![\\w.-])${escape(word)}(?![\\w-])`, "gi"))) {
            const right = (phrases ?? []).some(phrase => [...text.matchAll(phrase)]
                .some(at => at.index <= match.index && match.index + word.length <= at.index + at[0].length));
            if (!right) found.push({ word, term });
        }
    }
    return found;
}

/** The lines of a Markdown file outside code blocks, as [line number, text] */
function proseLines(text) {
    let fenced = false;
    return text.split("\n").flatMap((line, index) => {
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            return [];
        }
        return fenced ? [] : [[index + 1, line]];
    });
}

const git = args => childProcess.execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** The numbers of the lines a file has that are not in <base> */
function addedLines(base, file) {
    const added = new Set();
    for (const hunk of git(["diff", "-U0", base, "--", file]).matchAll(/^@@ [^+]*\+(\d+)(?:,(\d+))? @@/gm)) {
        const start = Number(hunk[1]);
        for (let line = start; line < start + Number(hunk[2] ?? 1); line += 1) added.add(line);
    }
    return added;
}

function main(argv) {
    const base = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : undefined;
    if (!base && !argv.includes("--all")) {
        console.error("usage: avoid-words.js --base <commit> | --all");
        process.exit(2);
    }
    const words = avoidWords(fs.readFileSync(path.join(ROOT, GLOSSARY), "utf8"));
    const allowed = allowList(fs.readFileSync(path.join(ROOT, ALLOW), "utf8"));
    const files = (base ? git(["diff", "--name-only", "--diff-filter=AM", base, "--", "*.md"]) : git(["ls-files", "*.md"]))
        .split("\n").filter(file => file && !SKIPPED.has(file));
    let count = 0;
    for (const file of files) {
        const added = base ? addedLines(base, file) : undefined;
        for (const [number, line] of proseLines(fs.readFileSync(path.join(ROOT, file), "utf8"))) {
            if (added && !added.has(number)) continue;
            for (const { word, term } of avoidedIn(line, words, allowed)) {
                count += 1;
                console.log(`::error file=${file},line=${number}::"${word}": the glossary's entry ${term} replaces this word. `
                    + `If the word is right here, add the phrase to ${ALLOW}`);
            }
        }
    }
    console.log(count ? `${count} Avoid words of ${GLOSSARY}` : `No Avoid words of ${GLOSSARY}`);
    process.exit(count ? 1 : 0);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { avoidWords, allowList, avoidedIn, proseLines };
