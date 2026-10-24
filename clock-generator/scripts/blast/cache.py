#!/usr/bin/env python3
"""The blast cache (<main checkout>/clock-generator/.scratch/blast-cache/ by default, BLAST_CACHE): one entry per key,
<engine12>-<jobs12>/ with jobs/<job>.json, MANIFEST.json and functions/ (the functions each job ran: _table.json.gz, the
engine's units and their hashes, and <job>.json.gz, a job's footprint in it; see functions.js), and index.tsv (one line per
entry). Used by blast.sh.

usage:
  cache.py complete <jobs-dir> [<_jobs.json>]   per the job list: done, config errors, missing; exit 1 if any missing
  cache.py lookup <cache> <key>                 exit 0 and print the entry's jobs folder if it is complete
  cache.py store <cache> <key> <jobs-dir> <_jobs.json> <engine.json> <source-json>
                                                copies the listed jobs (only those: a job not in the list, Thaeln's
                                                cell 09 say, is left out and named) into a new entry; refuses if any is
                                                missing. If the entry exists, compares instead: every job the same
                                                (but its seconds) or the differences
  cache.py list <cache>
  cache.py missing <out> <_jobs.json>           how many listed jobs have no result in <out>
  cache.py seed <out> <base jobs dir> <base functions dir> <_jobs.json> [--dry]
                                                per <out>/.plan.json (functions.js plan): copies the carried jobs'
                                                results into <out>, marks them claimed, writes .seed.json; says why
                                                the others rerun. --dry only says
  cache.py same <a> <b>                         every job the same in two jobs folders (or entries' jobs/), but its seconds;
                                                exit 1 if any differs or is in one only
  cache.py bases <cache> <engine.json> <_jobs.json> <tool> <worktree>
                                                the entries a new engine can carry jobs forward from, nearest in git
                                                first, one JSON object per line: same game data (resources/ without the sample configs), package-lock and tsconfig,
                                                same job format, footprints recorded by this tool version
"""
import datetime, glob, gzip, json, os, shutil, subprocess, sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts for the import below
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import key as keymod


def load_list(f):
    return json.load(open(f))


def job_files(d):
    return {os.path.basename(f)[:-5]: f for f in glob.glob(os.path.join(d, '*.json')) if not os.path.basename(f).startswith('_')}


def complete(d, list_file=None):
    lst = load_list(list_file or os.path.join(d, '_jobs.json'))
    files = job_files(d)
    keys = [j['key'] for j in lst['jobs']]
    missing = [k for k in keys if k not in files]
    errors = [k for k in keys if k in files and 'error' in json.load(open(files[k]))]
    # a refusal check that did not fail with its expected error (a job with refused false)
    refusals_failed = [k for k in keys if k in files and json.load(open(files[k])).get('refused') is False]
    extra = sorted(set(files) - set(keys))
    seconds = sum(json.load(open(files[k])).get('seconds', 0) for k in keys if k in files)
    return {'listed': len(keys), 'done': len(keys) - len(missing), 'missing': missing, 'errors': errors,
            'refusals_failed': refusals_failed, 'extra': extra,
            'seconds': round(seconds, 1), 'jobs_sha256': lst['jobs_sha256']}


def same(a, b):
    a, b = dict(json.load(open(a))), dict(json.load(open(b)))
    a.pop('seconds', None); b.pop('seconds', None)
    return a == b


def copy_functions(src_jobs_dir, tmp, lst):
    """The footprints of the listed jobs and the table they index, if the run made them; returns the manifest's part"""
    src = os.path.join(src_jobs_dir, 'functions')
    table = os.path.join(src, '_table.json.gz')
    if not os.path.exists(table):
        return None
    os.makedirs(os.path.join(tmp, 'functions'))
    shutil.copy2(table, os.path.join(tmp, 'functions', '_table.json.gz'))
    n = 0
    for j in lst['jobs']:
        f = os.path.join(src, j['key'] + '.json.gz')
        if os.path.exists(f):
            shutil.copy2(f, os.path.join(tmp, 'functions', j['key'] + '.json.gz'))
            n += 1
    t = json.load(gzip.open(table))
    return {'format': t['format'], 'tool': t.get('tool'), 'jobs': n, 'units': len(t['units'])}


def write_entry(tmp, entry, cache, key, lst, list_file, files, engine, source, c, src_jobs_dir):
    os.makedirs(os.path.join(tmp, 'jobs'))
    for j in lst['jobs']:
        shutil.copy2(files[j['key']], os.path.join(tmp, 'jobs', j['key'] + '.json'))
    shutil.copy2(list_file, os.path.join(tmp, 'jobs', '_jobs.json'))
    man = {
        'key': key, 'created': datetime.datetime.now().isoformat(timespec='seconds'), 'source': source,
        'engine': engine,
        'jobs': {'format': lst['format'], 'groups': lst['groups'], 'skip': lst['skip'], 'count': lst['count'],
                 'jobs_sha256': lst['jobs_sha256'], 'list': lst['jobs']},
        'config_errors': c['errors'], 'refusals_failed': c['refusals_failed'], 'left_out': c['extra'],
        'generation_seconds': c['seconds'],
        'functions': copy_functions(src_jobs_dir, tmp, lst),
    }
    json.dump(man, open(os.path.join(tmp, 'MANIFEST.json'), 'w'), indent=1)
    os.rename(tmp, entry)
    with open(os.path.join(cache, 'index.tsv'), 'a') as f:
        f.write('\t'.join([key, man['created'], engine['rev'][:8], str(lst['count']), source.get('kind', ''), source.get('note', '')]) + '\n')


def distance(worktree, a, b):
    """Commits between two revisions of the worktree's repository, either way; a huge number if one is unknown"""
    try:
        counts = [int(subprocess.run(['git', '-C', worktree, 'rev-list', '--count', r], capture_output=True, text=True, check=True).stdout)
                  for r in (f'{a}..{b}', f'{b}..{a}')]
        return sum(counts)
    except (subprocess.CalledProcessError, ValueError):
        return 10 ** 9


def main(argv):
    cmd = argv[0]
    if cmd == 'complete':
        c = complete(argv[1], argv[2] if len(argv) > 2 else None)
        print(f"jobs {c['done']} of {c['listed']} done ({c['seconds']} s of generation); config errors {len(c['errors'])}"
              f"{' ' + ', '.join(c['errors']) if c['errors'] else ''}"
              f"{'; REFUSAL CHECKS NOT AS EXPECTED: ' + ', '.join(c['refusals_failed']) if c['refusals_failed'] else ''}"
              f"; missing {len(c['missing'])}"
              f"{' ' + ', '.join(c['missing'][:10]) if c['missing'] else ''}"
              f"{'; not in the job list (left out of the cache): ' + ', '.join(c['extra']) if c['extra'] else ''}")
        sys.exit(1 if c['missing'] else 0)
    if cmd == 'lookup':
        entry = os.path.join(argv[1], argv[2])
        m = os.path.join(entry, 'MANIFEST.json')
        if not os.path.exists(m):
            sys.exit(1)
        man = json.load(open(m))
        files = job_files(os.path.join(entry, 'jobs'))
        if any(j['key'] not in files for j in man['jobs']['list']):
            print(f'cache entry {entry} is incomplete', file=sys.stderr)
            sys.exit(2)
        print(os.path.join(entry, 'jobs'))
        sys.exit(0)
    if cmd == 'store':
        cache, key, d, list_file, engine_file, source = argv[1:7]
        lst = load_list(list_file)
        c = complete(d, list_file)
        if c['missing']:
            sys.exit(f"cache.py: not storing {d}: {len(c['missing'])} listed jobs missing ({', '.join(c['missing'][:5])})")
        files = job_files(d)
        entry = os.path.join(cache, key)
        if os.path.exists(os.path.join(entry, 'MANIFEST.json')):
            cached = job_files(os.path.join(entry, 'jobs'))
            diff = [j['key'] for j in lst['jobs'] if not same(files[j['key']], cached[j['key']])]
            print(f"cache entry {key} exists; {len(lst['jobs']) - len(diff)} of {len(lst['jobs'])} jobs the same"
                  + (f"; DIFFERENT: {', '.join(diff)}" if diff else ''))
            sys.exit(3 if diff else 0)
        source = json.loads(source)
        engine = json.load(open(engine_file))
        engine.pop('dirty', None)
        os.makedirs(cache, exist_ok=True)
        tmp = os.path.join(cache, f'.{key}.{os.getpid()}.tmp')
        try:
            write_entry(tmp, entry, cache, key, lst, list_file, files, engine, source, c, d)
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        recorded = json.load(open(os.path.join(entry, 'MANIFEST.json')))['functions']
        print(f"stored {len(lst['jobs'])} jobs as {entry}" + (f"; left out: {', '.join(c['extra'])}" if c['extra'] else '')
              + (f"; functions recorded for {recorded['jobs']}" if recorded else '; no functions recorded'))
        sys.exit(0)
    if cmd == 'same':
        a, b = (os.path.join(x, 'jobs') if os.path.isdir(os.path.join(x, 'jobs')) else x for x in argv[1:3])
        fa, fb = job_files(a), job_files(b)
        both = sorted(set(fa) & set(fb))
        diff = [k for k in both if not same(fa[k], fb[k])]
        only_a, only_b = sorted(set(fa) - set(fb)), sorted(set(fb) - set(fa))
        print(f"{len(both)} jobs in both; {len(both) - len(diff)} the same"
              + (f"; DIFFERENT: {', '.join(diff)}" if diff else '')
              + (f"; only in the first: {', '.join(only_a)}" if only_a else '') + (f"; only in the second: {', '.join(only_b)}" if only_b else ''))
        sys.exit(1 if diff or only_a or only_b else 0)
    if cmd == 'missing':
        lst = load_list(argv[2])
        print(sum(1 for j in lst['jobs'] if not os.path.exists(os.path.join(argv[1], j['key'] + '.json'))))
        sys.exit(0)
    if cmd == 'seed':
        out, bjobs, fdir, jobs = argv[1:5]
        dry = '--dry' in argv
        plan = json.load(open(os.path.join(out, '.plan.json')))
        if not dry:
            for key in plan['carry']:
                shutil.copy2(os.path.join(bjobs, key + '.json'), os.path.join(out, key + '.json'))
                os.makedirs(os.path.join(out, '.claims', key), exist_ok=True)
            json.dump({'base': os.path.basename(os.path.dirname(bjobs)), 'base_functions': fdir,
                       'carried': plan['carry'], 'rerun': plan['rerun']}, open(os.path.join(out, '.seed.json'), 'w'), indent=1)
        why = {}
        for r in plan['rerun']:
            why[r['why']] = why.get(r['why'], 0) + 1
        print(f"   {len(plan['carry'])} jobs carried forward, {len(plan['rerun'])} rerun"
              f" ({len(plan['changed_units'])} units and {len(plan['changed_files'])} top levels differ)")
        for w, n in sorted(why.items(), key=lambda x: -x[1])[:8]:
            print(f"   rerun {n:3d}  {w}")
        sys.exit(0)
    if cmd == 'seednote':
        f = os.path.join(argv[1], '.seed.json')
        if os.path.exists(f):
            seed = json.load(open(f))
            print(f"{len(seed['carried'])} jobs carried from {seed['base']}, {len(seed['rerun'])} rerun")
        sys.exit(0)
    if cmd == 'bases':
        cache, engine_file, list_file, tool, worktree = argv[1:6]
        engine, lst = json.load(open(engine_file)), json.load(open(list_file))
        found = []
        for m in glob.glob(os.path.join(cache, '*', 'MANIFEST.json')):
            man = json.load(open(m))
            fn = man.get('functions')
            e = man['engine']
            if not fn or fn.get('tool') != tool or man['jobs']['format'] != lst['format']:
                continue
            # the game data, not the sample configs (a job's own config hash covers those); entries from before the field have it from their commit
            data = e.get('resources_data') or keymod.data_key_or_none(worktree, e['rev'])
            if data != engine.get('resources_data') or any(e.get(k) != engine.get(k) for k in ('lock', 'tsconfig')):
                continue
            found.append({'key': man['key'], 'rev': e['rev'], 'functions': os.path.join(os.path.dirname(m), 'functions'),
                          'jobs': os.path.join(os.path.dirname(m), 'jobs'), 'distance': distance(worktree, e['rev'], engine['rev'])})
        for f in sorted(found, key=lambda f: (f['distance'], f['key']))[:5]:
            print(json.dumps(f))
        sys.exit(0)
    if cmd == 'list':
        idx = os.path.join(argv[1], 'index.tsv')
        print('key\tcreated\tcommit\tjobs\tsource\tnote')
        if os.path.exists(idx):
            print(open(idx).read(), end='')
        sys.exit(0)
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
