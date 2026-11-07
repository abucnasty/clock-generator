#!/usr/bin/env python3
"""The record: one small JSON per blast job in clock-generator/record/, written from a blast run (the job files of a folder or
of a cache entry) and checked against another run. The record is a projection of what the blast computes, so what it holds is
what blast.sh computes and nothing else: no seconds, no path, no machine.

usage:
  record.py write [--dir record/] <jobs>            writes <dir>/<job>.json for every job of <jobs>; removes the record
                                                    files of jobs <jobs> does not have (a folder of job files made by
                                                    blast.sh run with BLAST_GROUPS=config,pickup,overhood,front,blocked,containers,variants,
                                                    or a cache entry)
  record.py check [--dir record/] [--map renames.txt] [--summary file] [--allow-unchecked] <jobs>
                                                    regenerates the records from <jobs> and compares them with <dir> field by
                                                    field; prints a table of job, field, before (the committed record) and
                                                    after (<jobs>); then the properties of <jobs> (below); exit 1 on any
                                                    difference, any property problem or when a side has no job
  record.py worse --base <record folder> [--dir record/] [--moves file] [--summary file]
                                                    the never-worse rule: the selected clock of each job in both folders (the record of
                                                    the base, and <dir>, the record of the change), and every job whose selected clock got
                                                    worse (below); exit 1 on any that the --moves text does not name

The ids of the alternatives are derived from the strategy and the settings of their clocks; the slot that made a clock is the `maker` of its
job-file entry (today's old id). `check` reads an id of the committed record that is a maker of the run, and not an id of it, as the id the
run gave that maker's clock, so a renamed id is not one alternative removed and another added (the ids in order and every field of the
alternative then compare under the new id). A run from an engine from before has no makers and no ids to read so.

--map: the blast's rename map (`old-job-key new-job-key` a line, '#' starts a comment): the committed record's jobs are
renamed through it before the join, so a renamed job compares with its new name; the config hash of a renamed job is
a field like another (a pure rename keeps it; a config_sha256 row says it did not). --summary: the table is also appended to this file (GITHUB_STEP_SUMMARY).

The never-worse rule (`worse`): a change may move a selected clock, and a selected clock that gets worse fails unless the change says
why. For each job in both records, the selected alternative of the base is set against the selected alternative of the change, and
the job is worse when any of these holds (the record has no target, so "below the target" is the `holds` field and the rate):
  - the job generated before and now fails to (`error`);
  - the verdict ranks lower: stable, then no recovery (it holds and does not get back from some backpressure loss), then unstable;
  - `holds` went from true to false;
  - `rate` (items a second) is lower;
  - `wake_ups` (inserter wake-ups a minute, to three decimals) is higher.
A job is named when its key (the file name without `.json`, as in MOVES.md) is in the text of --moves: CI gives the lines the pull request
adds to record/MOVES.md. A job in one record only (added or removed) is not compared. A job named but not worse is not an error.

The properties: every job file the blast writes holds `properties`, what tests/game/builds/record-properties.ts found on the live
results of the job (the six properties, on every alternative; the results are too big to keep). `check` fails, with a table of job,
property, alternative and the values, on any problem; it also fails on a job file with no `properties`, one the module could not run
on, or one judged by another version of the module than the checkout's (a run made before the module, or carried from one by a
selective run): rerun with `blast.sh run --full`, or pass --allow-unchecked to list them and go on.

The per-job checks: every job file the blast writes also holds `checks`, what tests/game/builds/record-job-checks.ts (and the files of
tests/game/builds/job-checks/) found on the live result of the job: the checks a test of that build used to make and the record does not
hold (expected texts, deciders, always-on reasons, the fuel view). `check` fails, with a table of job, check and expected and actual, on any
that failed; it fails on a job file with no `checks`, one the module could not run on, or one judged by another version of the module, as it
does for the properties (--allow-unchecked lists them and goes on).

The format (clock-record-1) is documented in clock-generator/record/README.md. Field names are stable: a new field is a new
format number.
"""
import glob, hashlib, json, os, re, sys

FORMAT = 'clock-record-1'
# the fields of an alternative, in the order they are written
ALTERNATIVE_FIELDS = ['id', 'verdict', 'holds', 'rate', 'supply', 'period', 'wake_ups', 'descriptions_cut', 'clock_sha256',
                      'windows_sha256', 'text_sha256', 'results_sha256']
# wake-ups a minute are written to this many decimals: the record is read by people, and the results digest holds the rest
WAKE_UP_DECIMALS = 3


def die(message):
    sys.exit(f'record.py: {message}')


def jobs_dir(path):
    """the folder of job files of a jobs folder or of a cache entry"""
    return os.path.join(path, 'jobs') if os.path.exists(os.path.join(path, 'MANIFEST.json')) else path


def compact_windows(windows):
    """a job's windows ({'inserter:1': [{'start': 0, 'end': 10}, ...]}) as {'inserter:1': '0-10,54-64'}: the opening edge
    and the closing edge of each window, in order"""
    if not isinstance(windows, dict):
        die(f'windows are not an object of lists ({type(windows).__name__}): the record format does not know them')
    out = {}
    for name, spans in windows.items():
        if not isinstance(spans, list) or any(not isinstance(s, dict) or set(s) != {'start', 'end'} for s in spans):
            die(f'the windows of {name} are not a list of start and end: the record format does not know them')
        out[name] = ','.join(f"{s['start']}-{s['end']}" for s in spans)
    return out


def project(job, config_sha256):
    """the record of one job file"""
    base = {'format': FORMAT, 'job': f"{job['group']}-{job['name']}", 'group': job['group'], 'name': job['name'],
            'config_sha256': config_sha256}
    if 'refused' in job:
        die(f"{base['job']} is a refusal check: the record holds clocks")
    if 'error' in job:
        return {**base, 'error': job['error']}
    alternatives = []
    for a in job['alternatives']:
        row = {f: a.get(f) for f in ALTERNATIVE_FIELDS}
        if row['wake_ups'] is not None:
            row['wake_ups'] = round(row['wake_ups'], WAKE_UP_DECIMALS)
        alternatives.append(row)
    selected = job['alternatives'][job['selected_index']]
    return {**base, 'job_results_sha256': job['job_results']['results_sha256'], 'selected': selected['id'],
            'selected_windows': compact_windows(selected['windows']), 'alternatives': alternatives}


def load_jobs(path):
    """the records of a jobs folder or cache entry, {job key: record}; dies naming the side when there is no job"""
    d = jobs_dir(path)
    files = sorted(f for f in glob.glob(os.path.join(d, '*.json')) if not os.path.basename(f).startswith('_'))
    if not files:
        die(f'no job files in {path}: not a folder of job files or a cache entry')
    listing = os.path.join(d, '_jobs.json')
    if not os.path.exists(listing):
        die(f'{path} has no _jobs.json: the record holds each job\'s config hash')
    hashes = {e['key']: e.get('config_sha256') for e in json.load(open(listing)).get('jobs', [])}
    listed = sorted(k for k in hashes if not os.path.exists(os.path.join(d, k + '.json')))
    if listed:
        die(f'{path} is an incomplete run: {len(listed)} listed jobs have no result ({", ".join(listed[:5])}{", ..." if len(listed) > 5 else ""})')
    records = {}
    for f in files:
        key = os.path.basename(f)[:-5]
        if key not in hashes or not hashes[key]:
            die(f'{key} is not in the job list of {path} (or has no config hash)')
        records[key] = project(json.load(open(f)), hashes[key])
    return records


def load_makers(path):
    """{job key: {maker: alternative id}} of the job files of a jobs folder or cache entry. Since the ids of the alternatives are derived from
    the strategy and the settings of their clocks, a job file keeps the slot that made each clock (`maker`, today's old id) beside the id; a
    job file of an engine from before has none. The record does not hold it (its format does not change)."""
    out = {}
    for f in sorted(glob.glob(os.path.join(jobs_dir(path), '*.json'))):
        if os.path.basename(f).startswith('_'):
            continue
        body = json.load(open(f))
        out[os.path.basename(f)[:-5]] = {a['maker']: a['id'] for a in body.get('alternatives', []) if a.get('maker') is not None}
    return out


def with_derived_ids(before, makers):
    """the committed records with the ids their alternatives had before they were derived (the maker's id) read as the id the run gave the
    same maker's clock, so that an id renamed is not read as one alternative removed and another added: {job key: record}, and how many ids
    were read so. An id the run still has is left alone (a record written after the derivation has none to rename)."""
    out, renamed = {}, 0
    for key, record in before.items():
        by_maker = makers.get(key, {})
        ids = {a['id'] for a in record.get('alternatives', [])}
        live = set(by_maker.values())
        mapping = {old: by_maker[old] for old in ids if old in by_maker and old not in live}
        if not mapping:
            out[key] = record
            continue
        renamed += len(mapping)
        out[key] = {**record, 'selected': mapping.get(record['selected'], record['selected']),
                    'alternatives': [{**a, 'id': mapping.get(a['id'], a['id'])} for a in record['alternatives']]}
    return out, renamed


MODULE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', 'game', 'builds', 'record-properties.ts')


def load_properties(path):
    """the `properties` of each job file of a jobs folder or cache entry, {job key: properties, or None where the file has none};
    a job that failed to generate has none to have (the record says it failed)"""
    d = jobs_dir(path)
    out = {}
    for f in sorted(glob.glob(os.path.join(d, '*.json'))):
        if os.path.basename(f).startswith('_'):
            continue
        body = json.load(open(f))
        if 'error' not in body:
            out[os.path.basename(f)[:-5]] = body.get('properties')
    return out


CHECKS_MODULE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', 'game', 'builds', 'record-job-checks.ts')


def load_job_checks(path):
    """the `checks` of each job file of a jobs folder or cache entry, {job key: checks, or None where the file has none}; a job
    that failed to generate has none to have"""
    d = jobs_dir(path)
    out = {}
    for f in sorted(glob.glob(os.path.join(d, '*.json'))):
        if os.path.basename(f).startswith('_'):
            continue
        body = json.load(open(f))
        if 'error' not in body:
            out[os.path.basename(f)[:-5]] = body.get('checks')
    return out


def checks_module_sha256(module):
    """the hash record-job-checks.ts's moduleSha256 makes: the module's file and the .ts files of job-checks/ beside it by name, each as
    its path from the module's folder, a NUL and its bytes"""
    folder = os.path.dirname(os.path.abspath(module))
    inner = os.path.join(folder, 'job-checks')
    digest = hashlib.sha256()
    try:
        files = [os.path.abspath(module)] + [os.path.join(inner, n) for n in sorted(os.listdir(inner)) if n.endswith('.ts')]
        for f in files:
            digest.update(os.path.relpath(f, folder).replace(os.sep, '/').encode() + b'\x00' + open(f, 'rb').read())
    except OSError as e:
        die(f'cannot read the job checks module {module}: {e.strerror}')
    return digest.hexdigest()


def job_check_rows(checks, module):
    """(rows, unchecked, totals): the rows (job, check, found) of the checks that failed, the jobs with no usable result of them (and why),
    and what ran: [jobs, checks run, seconds]"""
    rows, unchecked = [], []
    jobs = ran = 0
    seconds = 0.0
    current = checks_module_sha256(module)
    for key in sorted(checks):
        c = checks[key]
        if c is None:
            unchecked.append((key, 'no checks in the job file (made before the per-job checks, or carried from such a run)'))
        elif 'error' in c:
            rows.append((key, '(module)', c['error']))
        elif c.get('module_sha256') != current:
            unchecked.append((key, f"judged by another version of the per-job checks ({str(c.get('module_sha256'))[:12]}.. against {current[:12]}..)"))
        else:
            jobs += 1
            ran += len(c['ran'])
            seconds += c.get('seconds', 0)
            for f in c['failures']:
                if 'expected' in f and 'actual' in f:
                    found = f"expected {f['expected']}, actual {f['actual']}"
                else:
                    found = f['message']
                rows.append((key, f['check'], ' '.join(found.split())))
    return rows, unchecked, [jobs, ran, seconds]


def job_check_table(rows):
    cells = [('job', 'check', 'found')] + rows
    widths = [max(len(c[i]) for c in cells) for i in range(2)]
    return '\n'.join('  '.join(c[i].ljust(widths[i]) for i in range(2)) + '  ' + c[2] for c in cells)


def module_sha256(module):
    try:
        return hashlib.sha256(open(module, 'rb').read()).hexdigest()
    except OSError as e:
        die(f'cannot read the property module {module}: {e.strerror}')


def property_rows(properties, module, allow_unchecked):
    """(rows, unchecked, totals, excepted): the rows (job, property, alternative, found) of what the properties found, the jobs with no
    usable result of them (and why), what ran: [jobs, alternatives checked a property on, seconds], and the rows of what the
    module's named exceptions found (not problems, and shown)"""
    rows, unchecked, excepted = [], [], []
    jobs = alternatives = 0
    seconds = 0.0
    current = module_sha256(module)
    for key in sorted(properties):
        p = properties[key]
        if p is None:
            unchecked.append((key, 'no properties in the job file (made before the module, or carried from such a run)'))
        elif 'error' in p:
            rows.append((key, '(module)', '', p['error']))
        elif p.get('module_sha256') != current:
            unchecked.append((key, f"judged by another version of the property module ({str(p.get('module_sha256'))[:12]}.. against {current[:12]}..)"))
        else:
            jobs += 1
            alternatives += sum(p['checked'].values())
            seconds += p.get('seconds', 0)
            rows.extend((key, q['property'], q['alternative'], q['message']) for q in p['problems'])
            excepted.extend((key, e['property'], e['alternative'], f"{len(e['found'])} found, excepted: {e['reason']}") for e in p.get('excepted', []))
    return rows, unchecked, [jobs, alternatives, seconds], excepted


def property_table(rows):
    cells = [('job', 'property', 'alternative', 'found')] + rows
    widths = [max(len(c[i]) for c in cells) for i in range(3)]
    return '\n'.join('  '.join(c[i].ljust(widths[i]) for i in range(3)) + '  ' + c[3] for c in cells)


def load_record(directory):
    """the committed records of a folder, {job key: record}"""
    out = {}
    for f in sorted(glob.glob(os.path.join(directory, '*.json'))):
        record = json.load(open(f))
        key = os.path.basename(f)[:-5]
        if record.get('job') != key:
            die(f'{f}: the job field {record.get("job")!r} is not the file name')
        out[key] = record
    return out


def render(record):
    """the file text of a record: one line a field, a window list a line, an alternative a line; the same text for the same record"""
    dump = lambda x: json.dumps(x, ensure_ascii=False, separators=(', ', ': '))
    top = [(k, v) for k, v in record.items() if k not in ('selected_windows', 'alternatives')]
    lines = [f'  {dump(k)}: {dump(v)}' for k, v in top]
    if 'selected_windows' in record:
        inner = ',\n'.join(f'    {dump(k)}: {dump(v)}' for k, v in record['selected_windows'].items())
        lines.append('  "selected_windows": {' + (f'\n{inner}\n  ' if inner else '') + '}')
        inner = ',\n'.join(f'    {dump(a)}' for a in record['alternatives'])
        lines.append('  "alternatives": [\n' + inner + '\n  ]')
    return '{\n' + ',\n'.join(lines) + '\n}\n'


def load_map(path):
    """the rename map as {old: new}; the blast's format and rules (compare.py)"""
    try:
        lines = open(path).read().splitlines()
    except OSError as e:
        die(f'cannot read the map {path}: {e.strerror}')
    by_old, by_new = {}, {}
    for n, line in enumerate(lines, 1):
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2:
            die(f"{path} line {n}: expected 'old-job-key new-job-key', got {line!r}")
        old, new = parts
        if old == new:
            die(f'{path} line {n}: {old} maps to itself')
        if by_old.setdefault(old, new) != new:
            die(f'{path}: {old} maps to both {by_old[old]} and {new}')
        if by_new.setdefault(new, old) != old:
            die(f'{path}: {by_new[new]} and {old} both map to {new}')
    return by_old


def flatten(record):
    """{field path: value} of a record: top fields, selected_windows.<name>, and alternatives[<id>].<field> (an alternative is
    named by its id, so that one added or removed does not shift the others), with the order of the ids as a field of its own"""
    out = {}
    for k, v in record.items():
        if k == 'selected_windows':
            for name, windows in v.items():
                out[f'selected_windows.{name}'] = windows
        elif k == 'alternatives':
            out['alternatives (ids, in order)'] = ' '.join(a['id'] for a in v)
            for a in v:
                for f, x in a.items():
                    if f != 'id':
                        out[f"alternatives[{a['id']}].{f}"] = x
        else:
            out[k] = v
    return out


ABSENT = '(absent)'


def show(value):
    """a value for the table: a hash cut to 12 characters, a long text cut with its length"""
    if value is ABSENT:
        return ABSENT
    if isinstance(value, str):
        if re.fullmatch(r'[0-9a-f]{64}', value):
            return value[:12] + '..'
        if len(value) > 48:
            return f'{value[:40]}.. ({len(value)} chars)'
        return value
    return json.dumps(value)


def differences(before, after, renames):
    """rows (job, field, before, after) of the committed records `before` against the regenerated `after`"""
    rows = []
    renamed = {}
    for key, record in before.items():
        new = renames.get(key, key)
        if new in renamed:
            die(f'the map renames a job onto a name the record has: {new}')
        if new != key:
            group, name = (after[new]['group'], after[new]['name']) if new in after else (new.split('-', 1)[0], new.split('-', 1)[1])
            record = {**record, 'job': new, 'group': group, 'name': name}
        renamed[new] = record
    unused = sorted(old for old in renames if old not in before)
    for key in sorted(set(renamed) | set(after)):
        b, a = renamed.get(key), after.get(key)
        if b is None:
            rows.append((key, '(job)', ABSENT + ' in the record', 'in the run')); continue
        if a is None:
            rows.append((key, '(job)', 'in the record', ABSENT + ' in the run')); continue
        fb, fa = flatten(b), flatten(a)
        for field in fb.keys() | fa.keys():
            if fb.get(field, ABSENT) != fa.get(field, ABSENT):
                rows.append((key, field, fb.get(field, ABSENT), fa.get(field, ABSENT)))
    order = {k: i for i, k in enumerate(sorted(set(renamed) | set(after)))}
    rows.sort(key=lambda r: (order[r[0]], r[1]))
    return rows, unused


def table(rows):
    cells = [('job', 'field', 'before (record)', 'after (run)')] + [(j, f, show(b), show(a)) for j, f, b, a in rows]
    widths = [max(len(c[i]) for c in cells) for i in range(4)]
    return '\n'.join('  '.join(c[i].ljust(widths[i]) for i in range(4)).rstrip() for c in cells)


VERDICT_RANK = {'stable': 2, 'no recovery': 1, 'unstable': 0}


def selected_of(record):
    """the selected alternative of a record, or None where the job failed to generate"""
    if 'error' in record:
        return None
    for a in record['alternatives']:
        if a['id'] == record['selected']:
            return a
    die(f"{record['job']}: the selected alternative {record['selected']!r} is not among its alternatives")


def worse_reasons(before, after):
    """[(field, before, after)] of how the selected clock of `after` is worse than that of `before`; empty when it is not"""
    b, a = selected_of(before), selected_of(after)
    if b is None:
        return []
    if a is None:
        return [('error', 'generated', after['error'])]
    reasons = []
    for verdict in (b['verdict'], a['verdict']):
        if verdict not in VERDICT_RANK:
            die(f"{after['job']}: a verdict the rule does not rank: {verdict!r}")
    if VERDICT_RANK[a['verdict']] < VERDICT_RANK[b['verdict']]:
        reasons.append(('verdict', b['verdict'], a['verdict']))
    if b['holds'] and not a['holds']:
        reasons.append(('holds', b['holds'], a['holds']))
    if a['rate'] < b['rate'] - 1e-9 * max(1, abs(b['rate'])):
        reasons.append(('rate', b['rate'], a['rate']))
    if a['wake_ups'] is not None and b['wake_ups'] is not None and a['wake_ups'] > b['wake_ups']:
        reasons.append(('wake_ups', b['wake_ups'], a['wake_ups']))
    return reasons


def names_job(text, key):
    """whether the text has the job key as a word of its own (config-A is not named by config-A_BACKED_UP)"""
    return re.search(r'(?<![A-Za-z0-9_-])' + re.escape(key) + r'(?![A-Za-z0-9_-])', text) is not None


def worse_jobs(base, change, moves):
    """[(job, field, before, after, named)] for every job in both records whose selected clock got worse"""
    rows = []
    for key in sorted(set(base) & set(change)):
        for field, b, a in worse_reasons(base[key], change[key]):
            rows.append((key, field, b, a, names_job(moves, key)))
    return rows


def main_worse(opts):
    base_dir = opts.get('base')
    if not base_dir:
        die('worse takes --base <the record folder of the base>')
    directory = opts.get('dir') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'record')
    base, change = load_record(base_dir), load_record(directory)
    if not base or not change:
        die(f'no records in {base_dir if not base else directory}')
    moves = ''
    if opts.get('moves'):
        try:
            moves = open(opts['moves']).read()
        except OSError as e:
            die(f'cannot read {opts["moves"]}: {e.strerror}')
    rows = worse_jobs(base, change, moves)
    unnamed = [r for r in rows if not r[4]]
    compared = len(set(base) & set(change))
    print(f'record.py: the selected clocks of {compared} jobs set against the base: {len({r[0] for r in rows})} jobs worse, '
          f'{len({r[0] for r in unnamed})} of them not named in MOVES.md')
    if rows:
        cells = [('job', 'field', 'before (base)', 'after (change)', 'named in MOVES.md')] + [(j, f, show(b), show(a), 'yes' if n else 'NO') for j, f, b, a, n in rows]
        widths = [max(len(c[i]) for c in cells) for i in range(5)]
        text = '\n'.join('  '.join(c[i].ljust(widths[i]) for i in range(5)).rstrip() for c in cells)
        print('\n' + text)
        if unnamed:
            print('\nrecord.py: name each of these jobs in the entry this pull request adds to clock-generator/record/MOVES.md, with why it is accepted')
        if opts.get('summary') and unnamed:
            with open(opts['summary'], 'a') as out:
                out.write(f'### Never worse: {len({r[0] for r in unnamed})} selected clocks got worse and are not named in MOVES.md\n\n```\n{text}\n```\n')
    return 1 if unnamed else 0


def parse(argv):
    pos, opts, i = [], {}, 0
    while i < len(argv):
        if argv[i] == '--allow-unchecked':
            opts['allow-unchecked'] = True; i += 1
        elif argv[i] in ('--dir', '--map', '--summary', '--module', '--checks-module', '--base', '--moves'):
            if i + 1 >= len(argv):
                die(f'{argv[i]} takes an argument')
            opts[argv[i][2:]] = argv[i + 1]; i += 2
        elif argv[i].startswith('--'):
            die(f'unknown option {argv[i]}')
        else:
            pos.append(argv[i]); i += 1
    return pos, opts


def main(argv):
    if not argv or argv[0] not in ('write', 'check', 'worse'):
        sys.exit(__doc__)
    pos, opts = parse(argv[1:])
    if argv[0] == 'worse':
        if pos:
            die('worse takes no folder of job files: --base <record folder> [--dir <record folder>]')
        return main_worse(opts)
    if len(pos) != 1:
        die(f'{argv[0]} takes one jobs folder or cache entry')
    directory = opts.get('dir') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'record')
    after = load_jobs(pos[0])
    if argv[0] == 'write':
        os.makedirs(directory, exist_ok=True)
        for stale in set(load_record(directory)) - set(after):
            os.remove(os.path.join(directory, stale + '.json'))
        for key, record in after.items():
            with open(os.path.join(directory, key + '.json'), 'w') as out:
                out.write(render(record))
        print(f'record.py: wrote {len(after)} records to {directory}')
        return 0
    if not os.path.isdir(directory):
        die(f'{directory} is not a folder')
    before = load_record(directory)
    if not before:
        die(f'no records in {directory}')
    renames = load_map(opts['map']) if 'map' in opts else {}
    before, derived = with_derived_ids(before, load_makers(pos[0]))
    if derived:
        print(f'record.py: {derived} alternative ids of the record read as the derived ids of the clocks the same makers made (the run\'s `maker` fields)')
    rows, unused = differences(before, after, renames)
    if renames:
        print(f'renamed through the map: {len(renames) - len(unused)} jobs (a renamed job whose config hash differs is a config_sha256 row below)'
              + (f'; map entries not in the record: {unused}' if unused else ''))

    jobs_moved = len({r[0] for r in rows})
    failed = False
    if not rows:
        print(f'record.py: {len(after)} jobs, {sum(len(r.get("alternatives", [])) for r in after.values())} alternatives: no difference from the record in {directory}')
    else:
        failed = True
        text = table(rows)
        print(f'record.py: {len(rows)} differences in {jobs_moved} of {len(set(before) | set(after))} jobs (the record in {directory} against the run)\n')
        print(text)
        if opts.get('summary'):
            with open(opts['summary'], 'a') as out:
                out.write(f'### Rec summary: {len(rows)} differences in {jobs_moved} jobs\n\n```\n{text}\n```\n')
    # the properties of the run's results, on every alternative of every job
    allowed = opts.get('allow-unchecked', False)
    found, unchecked, (jobs, checked, seconds), excepted = property_rows(load_properties(pos[0]), opts.get('module') or MODULE, allowed)
    print(f'\nrecord.py: properties checked on {jobs} jobs ({checked} alternative checks, {seconds:.1f} s of the module): '
          f'{len(found)} problems' + (f', {len(unchecked)} jobs with no result of them' if unchecked else ''))
    if found:
        failed = True
        text = property_table(found)
        print('\n' + text)
        if opts.get('summary'):
            with open(opts['summary'], 'a') as out:
                out.write(f'### Properties: {len(found)} problems in {len({r[0] for r in found})} jobs\n\n```\n{text}\n```\n')
    for key, prop, alternative, what in excepted:
        print(f'  excepted: {key} {prop} {alternative}: {what}')
    for key, why in unchecked:
        print(f'  {key}: {why}')
        failed = failed or not allowed
    if unchecked and not allowed:
        print('record.py: the properties were not checked on these jobs: rerun them (blast.sh run --full), or pass --allow-unchecked')
    # the per-job checks, on the same results
    failing, not_checked, (check_jobs, ran, check_seconds) = job_check_rows(load_job_checks(pos[0]), opts.get('checks-module') or CHECKS_MODULE)
    print(f'\nrecord.py: per-job checks: {ran} checks on {check_jobs} jobs ({check_seconds:.1f} s): {len(failing)} failed'
          + (f', {len(not_checked)} jobs with no result of them' if not_checked else ''))
    if failing:
        failed = True
        text = job_check_table(failing)
        print('\n' + text)
        if opts.get('summary'):
            with open(opts['summary'], 'a') as out:
                out.write(f'### Job checks: {len(failing)} failed in {len({r[0] for r in failing})} jobs\n\n```\n{text}\n```\n')
    for key, why in not_checked:
        print(f'  {key}: {why}')
        failed = failed or not allowed
    if not_checked and not allowed:
        print('record.py: the per-job checks did not run on these jobs: rerun them (blast.sh run --full), or pass --allow-unchecked')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    sys.exit(main(sys.argv[1:]))
