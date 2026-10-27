#!/usr/bin/env node
// functions.js: which engine code each blast job ran, and which jobs a change of the engine reaches (blast.sh's
// selection; the header of blast.sh says what it decides and why it is sound).
//
// The engine's build (dist/*.js) is cut into UNITS: every function (declaration, expression, arrow, method, accessor,
// constructor) is one, every class is one (its heritage, its fields and what is not a method), and what is left of a file is
// its TOP LEVEL (what runs when the module loads). A unit's hash is of its own tokens, comments and layout stripped, with
// the code of the units nested in it left out: a change to an inner function moves the inner unit's hash only. A class
// also has its member names apart from its hash (an added method can override an inherited one).
//
// The top level is kept by statement: imports (`const util_1 = require("./util")`), declarations with a name (`const LIMIT = 4`,
// `exports.LIMIT = 4`, the statics of a class) and the statements that only run (a call, a loop, a patch of a prototype).
// What a top-level declaration holds is read by name: a declaration that differs between the builds changes its names, a
// declaration that reads a changed name changes its own, and a job reruns when a unit in its footprint (what ran while the
// engine loaded counts for every job) reads a changed name. A statement that only runs, if it differs or reads a changed
// name, reruns the jobs that loaded its file. Names that are only in one build are not changes: code that did not change
// cannot read an added name, and cannot read a removed one. A class that extends another and gains or loses a member (or
// changes what it extends) changes what its relatives' calls reach, and V8 reports no function for an implicit
// constructor, so a job that only made an instance leaves no trace of the class: that change reruns every job.
//
// While a job generates, blast.blastrun.ts records the byte ranges of the functions V8 ran (binary precise coverage,
// restarted for every job) and the files loaded so far. `collect` turns those into unit ids (a function ran: its unit, its
// enclosing functions and class), writes the build's unit table beside them, and `plan` compares a recorded build with a
// new one: a job reruns when a unit it ran is gone or has another hash, or reads a name whose value changed (above).
//
// usage:
//   functions.js collect --dist <dist> --raw <dir> --out <dir> [--carry <seed.json>]
//        <raw>/<job>.json (the recorder's ranges) -> <out>/<job>.json.gz, and <out>/_table.json.gz; with --carry
//        (the seed file `plan` led to) the carried jobs' records are translated to the new table
//   functions.js plan --dist <dist> --base <functions dir> --jobs <_jobs.json> --base-jobs <_jobs.json> --out <plan.json>
//        which jobs of <jobs> to rerun, which to carry forward from the base, and why
//   functions.js tool                 the hash of the files whose change makes every recorded footprint void
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const FORMAT = 'blast-functions-2';
const TOP = '<top>';

function loadTypescript(dirs) {
    for (const dir of dirs) {
        try { return require(require.resolve('typescript', { paths: [dir] })); } catch { /* try the next */ }
    }
    throw new Error('functions.js: typescript is not installed (npm ci in clock-generator/)');
}

const sha = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * The units of one built file, and its top level. Returns { top, units, unitsOfRange }:
 *   top    { entries: { key: [group, hash, declares, names] }, effects: [[hash, names]] } (see the header)
 *   units  [{ id, kind, hash, refs, members, extends }] (members and extends of classes only; refs: the names a unit mentions)
 *   unitsOfRange(start, end)  the ids to count for a function V8 ran, given as the range it reports
 * `ts` is the typescript module; `text` the file's text.
 */
function analyze(ts, text) {
    const K = ts.SyntaxKind;
    const sf = ts.createSourceFile('unit.js', text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    const isFunction = node => [K.FunctionDeclaration, K.FunctionExpression, K.ArrowFunction, K.MethodDeclaration,
        K.Constructor, K.GetAccessor, K.SetAccessor].includes(node.kind);
    const isClass = node => node.kind === K.ClassDeclaration || node.kind === K.ClassExpression;
    const nameOf = node => {
        if (node.kind === K.Constructor) return 'constructor';
        const prefix = (node.kind === K.GetAccessor ? 'get ' : node.kind === K.SetAccessor ? 'set ' : '')
            + (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static ? 'static ' : '');
        let name = node.name && node.name.getText(sf);
        const parent = node.parent;
        if (!name && parent) {
            if ((parent.kind === K.VariableDeclaration || parent.kind === K.PropertyAssignment || parent.kind === K.PropertyDeclaration) && parent.name) name = parent.name.getText(sf);
            else if (parent.kind === K.BinaryExpression && parent.operatorToken.kind === K.EqualsToken) name = parent.left.getText(sf);
        }
        return prefix + (name ?? '<anon>');
    };
    const heritageOf = node => {
        const clause = (node.heritageClauses ?? []).find(c => c.token === K.ExtendsKeyword);
        return clause && clause.types.length ? clause.types[0].expression.getText(sf).split('.').pop() : null;
    };
    const top = { id: TOP, kind: 'top', parent: null, seen: new Map(), members: [], start: 0, end: text.length };
    const all = [];
    // `sink` collects the tokens (the unit's own, or the top-level statement's); `owner` is the unit that nested units belong to
    const visit = (child, owner, sink) => {
        if (child.kind >= K.FirstJSDocNode && child.kind <= K.LastJSDocNode) return;
        const isFn = isFunction(child), isCls = isClass(child);
        if (isFn || isCls) {
            const segment = isCls ? `class ${child.name ? child.name.getText(sf) : nameOf(child)}` : nameOf(child);
            const n = (owner.seen.get(segment) ?? 0) + 1;
            owner.seen.set(segment, n);
            const segmentId = n > 1 ? `${segment}#${n}` : segment;
            const unit = { id: owner.id === TOP ? segmentId : `${owner.id}/${segmentId}`, kind: isCls ? 'class' : 'function',
                tokens: [], names: new Set(), parent: owner, seen: new Map(), members: [], extends: isCls ? heritageOf(child) : null, start: child.getStart(sf), end: child.end };
            if (owner.kind === 'class' && isFn) owner.members.push(segmentId);
            all.push(unit);
            walk(child, unit, unit);
        } else if (child.getChildCount(sf) === 0) {
            if (child.kind === K.EndOfFileToken) return;
            const token = text.slice(child.getStart(sf), child.end);
            if (token) sink.tokens.push(token);
            if (token && (child.kind === K.Identifier || child.kind === K.PrivateIdentifier)) sink.names.add(token);
        } else {
            walk(child, owner, sink);
        }
    };
    const walk = (node, owner, sink) => { for (const child of node.getChildren(sf)) visit(child, owner, sink); };

    // the top level, statement by statement
    const specifierOf = expression => {
        if (expression && ts.isCallExpression(expression) && expression.arguments.length === 1) {
            const callee = expression.expression.getText(sf);
            if (callee === 'require') return expression.arguments[0].getText(sf);
            if (callee === '__importStar' || callee === '__importDefault') return specifierOf(expression.arguments[0]);
        }
        return null;
    };
    const isExports = node => node.getText(sf).startsWith('exports.');
    const boundNames = node => ts.isIdentifier(node) ? [node.getText(sf)]
        : ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node) ? node.elements.flatMap(e => ts.isBindingElement(e) ? boundNames(e.name) : []) : [];
    /** What an expression statement is: null (a binding that cannot change what code reads), { declares } (a value), or
     * undefined (a statement that only runs) */
    const classifyExpression = expression => {
        if (ts.isStringLiteral(expression)) return null;
        if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === K.EqualsToken) {
            const names = [];
            let right = expression;
            while (ts.isBinaryExpression(right) && right.operatorToken.kind === K.EqualsToken) { names.push(right.left); right = right.right; }
            if (names.every(isExports)) {
                if (ts.isVoidExpression(right)) return null;
                if (names.length === 1 && ts.isIdentifier(right) && names[0].getText(sf) === `exports.${right.getText(sf)}`) return null;
                if (names.length === 1) return { declares: [names[0].getText(sf).slice('exports.'.length)] };
            }
        }
        if (ts.isCallExpression(expression)) {
            const callee = expression.expression.getText(sf);
            if (callee === 'Object.defineProperty' && expression.arguments.length && expression.arguments[0].getText(sf) === 'exports') return null;
            if (callee === '__exportStar') return null;
            // the enum a TypeScript build writes: (function (E) { ... })(E || (exports.E = E = {}));
            const fn = ts.isParenthesizedExpression(expression.expression) ? expression.expression.expression : expression.expression;
            if (ts.isFunctionExpression(fn) && fn.parameters.length === 1 && expression.arguments.length === 1
                && expression.arguments[0].getText(sf).startsWith(`${fn.parameters[0].name.getText(sf)} ||`)) return { declares: [fn.parameters[0].name.getText(sf)] };
        }
        return undefined;
    };
    const entries = {}, effects = [];
    const addEntry = (key, group, hash, declares, names) => {
        let unique = key, n = 1;
        while (unique in entries) unique = `${key}#${++n}`;
        entries[unique] = [group, hash, declares, [...names].sort()];
    };
    for (const statement of sf.statements) {
        if (isFunction(statement) || isClass(statement)) { visit(statement, top, null); continue; }
        if (statement.kind === K.VariableStatement) {
            const keyword = statement.declarationList.getFirstToken(sf).getText(sf);
            for (const declaration of statement.declarationList.declarations) {
                const record = { tokens: [keyword], names: new Set() };
                visit(declaration, top, record);
                const declares = boundNames(declaration.name);
                const specifier = specifierOf(declaration.initializer);
                if (specifier !== null) addEntry(`import ${declares.join(',')}`, 'binding', sha(specifier), declares, []);
                else addEntry(`declaration ${declares.join(',')}`, 'value', sha(record.tokens.join(' ')), declares, record.names);
            }
            continue;
        }
        const record = { tokens: [], names: new Set() };
        visit(statement, top, record);
        const kind = statement.kind === K.ExpressionStatement ? classifyExpression(statement.expression) : undefined;
        if (kind === null) continue;
        const hash = sha(record.tokens.join(' '));
        if (kind) addEntry(`declaration ${kind.declares.join(',')}`, 'value', hash, kind.declares, record.names);
        else effects.push([hash, [...record.names].sort()]);
    }

    const hashOf = unit => sha(unit.tokens.join(' '));
    const byEnd = new Map();
    for (const unit of all) {
        if (!byEnd.has(unit.end)) byEnd.set(unit.end, []);
        byEnd.get(unit.end).push(unit);
    }
    const unitsOfRange = (start, end) => {
        const ended = (byEnd.get(end) ?? []).filter(unit => unit.start <= start);
        let unit = ended.filter(u => u.kind === 'function').sort((a, b) => b.start - a.start)[0] ?? ended.sort((a, b) => b.start - a.start)[0];
        let mapped = true;
        if (!unit) {
            // a range that is no unit's (a class's field initialiser, say): the smallest unit around it
            mapped = false;
            unit = all.filter(u => u.start <= start && u.end >= end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] ?? top;
        }
        const chain = [];
        for (let u = unit; u && u.id !== TOP; u = u.parent) chain.push(u.id);
        return { ids: chain, mapped };
    };
    // a static field or block of a class is code that runs when the file loads, and any code can read it
    for (const unit of all) {
        if (unit.kind === 'class' && unit.parent === top && unit.tokens.includes('static')) {
            addEntry(`statics ${unit.id}`, 'value', hashOf(unit), [unit.id.replace(/^class /, '').replace(/#\d+$/, '')], unit.names);
        }
    }
    return {
        top: { entries, effects },
        units: all.map(u => ({ id: u.id, kind: u.kind, hash: hashOf(u), refs: [...u.names].sort(), ...(u.kind === 'class' ? { members: sha([...u.members].sort().join('\0')), extends: u.extends } : {}) })),
        unitsOfRange,
    };
}

/**
 * What differs at the top level of a file between two builds: the names its declarations that are in both builds and hold
 * other code declare, and why the statements that only run are not the same list (or null). Declarations only in one
 * build are not a change (see the header).
 */
function topChange(base, next) {
    const names = [];
    for (const [key, [group, hash, declares]] of Object.entries(base.entries)) {
        const other = next.entries[key];
        if (other && (other[0] !== group || other[1] !== hash)) names.push(...declares);
    }
    const same = base.effects.length === next.effects.length && base.effects.every((effect, i) => effect[0] === next.effects[i][0]);
    return { names: [...new Set(names)], effects: same ? null : 'a statement that only runs differs' };
}

/** Every built file of a dist/ folder, by path relative to it */
function builtFiles(dist) {
    const out = [];
    const visit = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(file);
            else if (entry.name.endsWith('.js')) out.push(path.relative(dist, file).split(path.sep).join('/'));
        }
    };
    visit(dist);
    return out.sort();
}

/** The table of a build: { format, files: [rel], names: [string], tops: [top], units: [[fileIndex, id, hash, [name index]]],
 * classes: [[unitIndex, members, extends]] } and the analyses by file */
function tableOfDist(ts, dist) {
    const files = builtFiles(dist);
    const table = { format: FORMAT, files, names: [], tops: [], units: [], classes: [] };
    const nameIndex = new Map();
    const indexOf = name => {
        if (!nameIndex.has(name)) { nameIndex.set(name, table.names.length); table.names.push(name); }
        return nameIndex.get(name);
    };
    const analyses = new Map();
    files.forEach((rel, fileIndex) => {
        const analysis = analyze(ts, fs.readFileSync(path.join(dist, rel), 'utf8'));
        analyses.set(rel, analysis);
        table.tops.push(analysis.top);
        for (const unit of analysis.units) {
            if (unit.kind === 'class') table.classes.push([table.units.length, unit.members, unit.extends ?? '']);
            table.units.push([fileIndex, unit.id, unit.hash, unit.refs.map(indexOf)]);
        }
    });
    return { table, analyses };
}

/**
 * A job's footprint from the recorder's raw file ({ loaded: [rel], executed: { rel: [[start, end]] } }): the table indexes
 * of the files loaded and of the units that ran, and how many functions mapped to no unit of their own.
 */
function footprintOf(raw, table, analyses) {
    const fileIndex = new Map(table.files.map((rel, i) => [rel, i]));
    const unitIndex = new Map(table.units.map((u, i) => [`${u[0]}\0${u[1]}`, i]));
    const units = new Set();
    let unmapped = 0;
    for (const [rel, ranges] of Object.entries(raw.executed)) {
        const analysis = analyses.get(rel);
        const file = fileIndex.get(rel);
        if (!analysis || file === undefined) continue;
        for (const [start, end] of ranges) {
            const { ids, mapped } = analysis.unitsOfRange(start, end);
            if (!mapped) unmapped++;
            for (const id of ids) units.add(unitIndex.get(`${file}\0${id}`));
        }
    }
    const loaded = raw.loaded.map(rel => fileIndex.get(rel)).filter(i => i !== undefined);
    return { loaded: [...new Set(loaded)].sort((a, b) => a - b), units: [...units].filter(i => i !== undefined).sort((a, b) => a - b), unmapped };
}

const writeGz = (file, value) => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(value)));
const readGz = file => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());

/** The footprint of a base job in the new table's indexes, or null if a unit of it is not in the new table */
function translate(footprint, baseTable, table) {
    const fileIndex = new Map(table.files.map((rel, i) => [rel, i]));
    const unitIndex = new Map(table.units.map((u, i) => [`${u[0]}\0${u[1]}`, i]));
    const loaded = [], units = [];
    for (const i of footprint.loaded) {
        const j = fileIndex.get(baseTable.files[i]);
        if (j === undefined) return null;
        loaded.push(j);
    }
    for (const i of footprint.units) {
        const [file, id] = baseTable.units[i];
        const j = unitIndex.get(`${fileIndex.get(baseTable.files[file])}\0${id}`);
        if (j === undefined) return null;
        units.push(j);
    }
    return { loaded: loaded.sort((a, b) => a - b), units: units.sort((a, b) => a - b), unmapped: footprint.unmapped ?? 0 };
}

/**
 * What differs between a base build and a new one, by the base's indexes: changedUnit (whether each unit is gone or has other
 * code); changedNames (the names whose value differs, with where: a declaration with other code, or one that reads a changed
 * name); changedFile (why the statements that only run in each file differ, or null); and changedClasses (the classes with
 * heritage whose heritage or member names differ: an added method can override an inherited one, which a job that never ran
 * a function of the class, only made an instance of it, would reach: V8 reports no function for an implicit constructor).
 */
function changesBetween(baseTable, table) {
    const newFile = new Map(table.files.map((rel, i) => [rel, i]));
    const newUnit = new Map(table.units.map(u => [`${table.files[u[0]]}\0${u[1]}`, u[2]]));
    const changedUnit = baseTable.units.map(u => newUnit.get(`${baseTable.files[u[0]]}\0${u[1]}`) !== u[2]);
    // names whose value differs
    const changedNames = new Map(), changedFile = baseTable.files.map(() => null);
    baseTable.files.forEach((rel, i) => {
        if (!newFile.has(rel)) return;
        const change = topChange(baseTable.tops[i], table.tops[newFile.get(rel)]);
        for (const name of change.names) if (!changedNames.has(name)) changedNames.set(name, `${rel}: ${name}`);
        changedFile[i] = change.effects;
    });
    // a declaration that reads a changed name holds another value, and so on
    const declarations = [];
    for (const [tops, files] of [[baseTable.tops, baseTable.files], [table.tops, table.files]]) {
        tops.forEach((top, i) => { for (const [group, , declares, names] of Object.values(top.entries)) if (group === 'value') declarations.push([files[i], declares, names]); });
    }
    for (let grew = true; grew;) {
        grew = false;
        for (const [rel, declares, names] of declarations) {
            const read = names.find(name => changedNames.has(name));
            if (read === undefined) continue;
            for (const name of declares) if (!changedNames.has(name)) { changedNames.set(name, `${changedNames.get(read)}, read by ${rel}: ${name}`); grew = true; }
        }
    }
    // statements that only run and read a changed name
    for (const [tops, files] of [[baseTable.tops, baseTable.files], [table.tops, table.files]]) {
        tops.forEach((top, i) => {
            const read = top.effects.flatMap(effect => effect[1]).find(name => changedNames.has(name));
            const file = baseTable.files.indexOf(files[i]);
            if (read !== undefined && file >= 0 && !changedFile[file]) changedFile[file] = `a statement that only runs reads ${read}, which changed (${changedNames.get(read)})`;
        });
    }
    const newClass = new Map((table.classes ?? []).map(c => [`${table.files[table.units[c[0]][0]]}\0${table.units[c[0]][1]}`, c]));
    const changedClasses = [];
    for (const [unitIndex, members, heritage] of baseTable.classes ?? []) {
        const [file, id] = baseTable.units[unitIndex];
        const next = newClass.get(`${baseTable.files[file]}\0${id}`);
        if (next && (next[1] !== members || next[2] !== heritage) && (heritage || next[2])) changedClasses.push(`${baseTable.files[file]}: ${id}`);
    }
    return { changedFile, changedUnit, changedNames, changedClasses };
}

/** What `plan` decides, from the base's tables and footprints (a Map job key -> footprint) */
function plan({ baseTable, table, baseJobs, jobs, footprints, baseConfigs }) {
    const { changedFile, changedUnit, changedNames, changedClasses } = changesBetween(baseTable, table);
    const carry = [], rerun = [];
    for (const job of jobs) {
        const key = job.key;
        if (!baseJobs.has(key)) { rerun.push({ key, why: 'new job' }); continue; }
        if (baseConfigs.get(key) !== job.config_sha256) { rerun.push({ key, why: 'its config changed' }); continue; }
        const footprint = footprints.get(key);
        if (!footprint) { rerun.push({ key, why: 'no record of the functions it ran' }); continue; }
        if (changedClasses.length) { rerun.push({ key, why: `${changedClasses[0]} changed its heritage or its members` }); continue; }
        const unit = footprint.units.find(i => changedUnit[i]);
        if (unit !== undefined) { rerun.push({ key, why: `ran ${baseTable.files[baseTable.units[unit][0]]}: ${baseTable.units[unit][1]}` }); continue; }
        const file = footprint.loaded.find(i => changedFile[i]);
        if (file !== undefined) { rerun.push({ key, why: `loaded ${baseTable.files[file]}, where ${changedFile[file]}` }); continue; }
        const reader = changedNames.size ? footprint.units.find(i => (baseTable.units[i][3] ?? []).some(n => changedNames.has(baseTable.names[n]))) : undefined;
        if (reader !== undefined) {
            const name = baseTable.units[reader][3].map(n => baseTable.names[n]).find(n => changedNames.has(n));
            rerun.push({ key, why: `ran ${baseTable.files[baseTable.units[reader][0]]}: ${baseTable.units[reader][1]}, which reads ${name} (changed: ${changedNames.get(name)})` }); continue;
        }
        carry.push(key);
    }
    return {
        carry, rerun,
        changed_units: baseTable.units.filter((_, i) => changedUnit[i]).map(u => `${baseTable.files[u[0]]}: ${u[1]}`),
        changed_names: [...changedNames.values()],
        changed_files: baseTable.files.map((rel, i) => changedFile[i] ? `${rel} (${changedFile[i]})` : null).filter(Boolean),
        changed_classes: changedClasses,
    };
}

function toolHash(dir) {
    const h = crypto.createHash('sha256');
    for (const name of ['blast.blastrun.ts', 'blast.recorder.ts', 'vitest.dist.config.ts', 'functions.js']) h.update(name).update(fs.readFileSync(path.join(dir, name)));
    return h.digest('hex').slice(0, 16);
}

function args(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
    return out;
}

function main(argv) {
    const cmd = argv[0], a = args(argv.slice(1));
    if (cmd === 'tool') { console.log(toolHash(__dirname)); return; }
    const ts = loadTypescript([a.dist ? path.dirname(path.resolve(a.dist)) : process.cwd(), __dirname]);
    const jobsOf = file => JSON.parse(fs.readFileSync(file, 'utf8')).jobs;
    if (cmd === 'collect') {
        const { table, analyses } = tableOfDist(ts, path.resolve(a.dist));
        table.tool = toolHash(__dirname);
        fs.mkdirSync(a.out, { recursive: true });
        let recorded = 0, unmapped = 0, startupUnits = 0;
        if (fs.existsSync(a.raw)) {
            // what ran while the engine loaded and the job list was made: every job counts it as its own
            const startupFile = path.join(a.raw, '.startup.json');
            const startupSet = new Set(fs.existsSync(startupFile) ? footprintOf(JSON.parse(fs.readFileSync(startupFile, 'utf8')), table, analyses).units : []);
            startupUnits = startupSet.size;
            for (const f of fs.readdirSync(a.raw).filter(f => f.endsWith('.json') && !f.startsWith('.'))) {
                const footprint = footprintOf(JSON.parse(fs.readFileSync(path.join(a.raw, f), 'utf8')), table, analyses);
                unmapped += footprint.unmapped;
                footprint.units = [...new Set([...footprint.units, ...startupSet])].sort((x, y) => x - y);
                writeGz(path.join(a.out, `${f}.gz`), footprint);
                recorded++;
            }
        }
        let carried = 0, dropped = 0;
        if (a.carry && fs.existsSync(a.carry)) {
            const seed = JSON.parse(fs.readFileSync(a.carry, 'utf8'));
            const baseTable = readGz(path.join(seed.base_functions, '_table.json.gz'));
            for (const key of seed.carried) {
                const file = path.join(seed.base_functions, `${key}.json.gz`);
                const moved = fs.existsSync(file) ? translate(readGz(file), baseTable, table) : null;
                if (moved) { writeGz(path.join(a.out, `${key}.json.gz`), moved); carried++; } else dropped++;
            }
        }
        writeGz(path.join(a.out, '_table.json.gz'), table);
        console.log(`functions: ${table.files.length} files, ${table.units.length} units; recorded ${recorded} jobs (${startupUnits} units ran while the engine loaded, ${unmapped} functions with no unit of their own), carried ${carried}${dropped ? `, ${dropped} carried jobs without a record` : ''}`);
        return;
    }
    if (cmd === 'plan') {
        const baseTable = readGz(path.join(a.base, '_table.json.gz'));
        if (baseTable.format !== FORMAT || baseTable.tool !== toolHash(__dirname)) {
            console.log(JSON.stringify({ error: 'the base was recorded by another version of the recorder' }));
            process.exit(3);
        }
        const { table } = tableOfDist(ts, path.resolve(a.dist));
        const baseJobList = jobsOf(a['base-jobs']);
        const footprints = new Map();
        for (const job of baseJobList) {
            const file = path.join(a.base, `${job.key}.json.gz`);
            if (fs.existsSync(file)) footprints.set(job.key, readGz(file));
        }
        const result = plan({
            baseTable, table, jobs: jobsOf(a.jobs), footprints,
            baseJobs: new Set(baseJobList.map(j => j.key)), baseConfigs: new Map(baseJobList.map(j => [j.key, j.config_sha256])),
        });
        fs.writeFileSync(a.out, JSON.stringify(result, null, 1));
        console.log(`plan: ${result.rerun.length} to rerun, ${result.carry.length} carried; ${result.changed_units.length} units, ${result.changed_names.length} top-level names and ${result.changed_files.length} files with statements that run differ`);
        return;
    }
    console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1).filter((l, i, lines) => lines.slice(0, i + 1).every(x => x.startsWith('//'))).map(l => l.slice(3)).join('\n'));
    process.exit(2);
}

module.exports = { analyze, topChange, tableOfDist, footprintOf, translate, changesBetween, plan, toolHash, FORMAT, TOP };

if (require.main === module) main(process.argv.slice(2));
