#!/usr/bin/env python3
"""The blast cache (<main checkout>/clock-generator/.scratch/blast-cache/ by default, BLAST_CACHE): one entry per key, <engine12>-<jobs12>/ with jobs/<job>.json and
MANIFEST.json, and index.tsv (one line per entry). Used by blast.sh.

usage:
  cache.py complete <jobs-dir> [<_jobs.json>]   per the job list: done, config errors, missing; exit 1 if any missing
  cache.py lookup <cache> <key>                 exit 0 and print the entry's jobs folder if it is complete
  cache.py store <cache> <key> <jobs-dir> <_jobs.json> <engine.json> <source-json>
                                                copies the listed jobs (only those: a job not in the list, Thaeln's
                                                cell 09 say, is left out and named) into a new entry; refuses if any is
                                                missing. If the entry exists, compares instead: every job the same
                                                (but its seconds) or the differences
  cache.py list <cache>
"""
import datetime, glob, json, os, shutil, sys


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


def write_entry(tmp, entry, cache, key, lst, list_file, files, engine, source, c):
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
    }
    json.dump(man, open(os.path.join(tmp, 'MANIFEST.json'), 'w'), indent=1)
    os.rename(tmp, entry)
    with open(os.path.join(cache, 'index.tsv'), 'a') as f:
        f.write('\t'.join([key, man['created'], engine['rev'][:8], str(lst['count']), source.get('kind', ''), source.get('note', '')]) + '\n')


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
            write_entry(tmp, entry, cache, key, lst, list_file, files, engine, source, c)
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        print(f"stored {len(lst['jobs'])} jobs as {entry}" + (f"; left out: {', '.join(c['extra'])}" if c['extra'] else ''))
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
