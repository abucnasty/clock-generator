#!/usr/bin/env python3
"""Shards of the blast: the job list dealt out to runners by each job's measured CI seconds, and the shards' job files joined again.

usage:
  shard.py plan   <_jobs.json> <durations.json> <count>               the split: for each shard its jobs, job-seconds and estimated wall time
  shard.py select <_jobs.json> <durations.json> <index>/<count> [--write <_shard.json>]
                                                                       prints the job names of shard <index> (1-based) as the comma list
                                                                       BLAST_ONLY takes; --write also leaves the shard's record of the
                                                                       split (which shard, which of the jobs, the whole list) for `merge`
  shard.py merge  <out> <shard folder>...                             joins the folders of finished shards into <out>: the job files, and
                                                                       one _jobs.json of the whole list; refuses a shard that is missing or
                                                                       twice, shards of other splits, a job twice, missing or not in its shard

<_jobs.json> is the job list the blast writes (blast.blastrun.ts); <durations.json> is ci/record-durations.json ({job key: seconds on a CI
runner}). Every shard job computes the whole split from the same two files and takes its part, so the shards are disjoint and together
hold every job, as the generation tests' sequencer (ci/duration-sequencer.ts) does for the test files; a job that is not in the durations
counts as the median job. Jobs go longest first onto the shard whose estimated wall time is then smallest (ties: the least job-seconds).

A shard runs its jobs WORKERS at a time (blast.sh -n, 4 on a runner with 4 vCPUs), each as a process of its own, longest first, so its
wall time is that of list scheduling on WORKERS slots (`estimate`), never under its longest job.
"""
import glob, heapq, json, os, shutil, sys

FORMAT = 'blast-shard-1'
WORKERS = 4
SHARD_FILE = '_shard.json'


def die(message):
    sys.exit(f'shard.py: {message}')


def load_json(path, what):
    try:
        with open(path) as f:
            return json.load(f)
    except OSError as e:
        die(f'cannot read {what} {path}: {e.strerror}')
    except ValueError as e:
        die(f'{what} {path} is not JSON: {e}')


def estimate(seconds, workers=WORKERS):
    """the wall time of jobs of these seconds on `workers` slots, each slot taking the next job, longest first"""
    slots = [0.0] * workers
    heapq.heapify(slots)
    for s in sorted(seconds, reverse=True):
        heapq.heappush(slots, heapq.heappop(slots) + s)
    return max(slots)


def job_seconds(keys, known):
    """{key: seconds}: the measured seconds of the known keys; a key that is not known (a new or renamed job) counts as the median"""
    measured = sorted(known.values())
    median = measured[len(measured) // 2] if measured else 1.0
    return {k: float(known.get(k, median)) for k in keys}


def assign(seconds, count, workers=WORKERS):
    """the split of {key: seconds} into `count` shards (lists of keys): longest first onto the shard that is then estimated to finish
    first. Depends on the keys and seconds only (not on their order), so every shard job computes the same split"""
    shards = [[] for _ in range(count)]
    for key in sorted(seconds, key=lambda k: (-seconds[k], k)):
        best = min(range(count), key=lambda i: (estimate([seconds[k] for k in shards[i]] + [seconds[key]], workers),
                                                sum(seconds[k] for k in shards[i]), i))
        shards[best].append(key)
    return shards


def load_list(path):
    listing = load_json(path, 'the job list')
    jobs = listing.get('jobs')
    if not isinstance(jobs, list) or not jobs:
        die(f'{path} lists no job')
    names = {}
    for job in jobs:
        # BLAST_ONLY takes names, not keys: a name two groups share would run the job of both
        if names.setdefault(job['name'], job['key']) != job['key']:
            die(f"the name {job['name']} is in two groups ({names[job['name']]} and {job['key']}): BLAST_ONLY could not tell them apart")
    return listing, {job['key']: job for job in jobs}


def split(listing_path, durations_path, count):
    listing, jobs = load_list(listing_path)
    known = load_json(durations_path, 'the durations')
    seconds = job_seconds(jobs, known)
    return listing, jobs, seconds, assign(seconds, count)


def parse_shard(text):
    try:
        index, count = (int(x) for x in text.split('/'))
    except ValueError:
        die(f'a shard is <index>/<count>, not {text!r}')
    if count < 1 or not 1 <= index <= count:
        die(f'shard {text} is not between 1 and {count}')
    return index, count


def cmd_plan(args):
    if len(args) != 3:
        die('plan <_jobs.json> <durations.json> <count>')
    count = int(args[2])
    _, jobs, seconds, shards = split(args[0], args[1], count)
    for i, shard in enumerate(shards, 1):
        total = sum(seconds[k] for k in shard)
        print(f'shard {i}/{count}: {len(shard):2d} jobs, {total:7.1f} job-s, about {estimate([seconds[k] for k in shard]):6.1f} s; longest {max(shard, key=lambda k: seconds[k])} ({max(seconds[k] for k in shard):.1f} s)')
    print(f'slowest shard about {max(estimate([seconds[k] for k in s]) for s in shards):.1f} s of {sum(seconds.values()):.1f} job-s in all (the longest job: {max(seconds.values()):.1f} s)')


def cmd_select(args):
    write = None
    if '--write' in args:
        at = args.index('--write')
        if at + 1 >= len(args):
            die('--write takes a file')
        write = args[at + 1]
        args = args[:at] + args[at + 2:]
    if len(args) != 3:
        die('select <_jobs.json> <durations.json> <index>/<count> [--write file]')
    index, count = parse_shard(args[2])
    listing, jobs, seconds, shards = split(args[0], args[1], count)
    mine = sorted(shards[index - 1])
    if write:
        record = {'format': FORMAT, 'index': index, 'count': count, 'jobs': mine, 'all': sorted(jobs), 'jobs_sha256': listing.get('jobs_sha256')}
        with open(write, 'w') as out:
            json.dump(record, out, indent=1)
    print(','.join(jobs[k]['name'] for k in mine))


def cmd_merge(args):
    if len(args) < 2:
        die('merge <out> <shard folder>...')
    out, folders = args[0], args[1:]
    shards = {}
    for folder in folders:
        info = load_json(os.path.join(folder, SHARD_FILE), f'the shard record of {folder}')
        if info.get('format') != FORMAT:
            die(f"{folder}: the shard record is of format {info.get('format')!r}, not {FORMAT}")
        if info['index'] in shards:
            die(f"shard {info['index']} is in {shards[info['index']][0]} and in {folder}")
        shards[info['index']] = (folder, info)
    count = {info['count'] for _, info in shards.values()}
    if len(count) != 1:
        die(f'the shards are of splits of different sizes: {sorted(count)}')
    count = count.pop()
    missing = [i for i in range(1, count + 1) if i not in shards]
    if missing:
        die(f"shard {', '.join(map(str, missing))} of {count} is missing: the shards' jobs are not all there")
    first = shards[1][1]
    if any(info['all'] != first['all'] or info['jobs_sha256'] != first['jobs_sha256'] for _, info in shards.values()):
        die('the shards were dealt from different job lists')
    dealt = [k for _, info in shards.values() for k in info['jobs']]
    if sorted(dealt) != sorted(first['all']):
        die(f'the shards hold {len(dealt)} jobs ({len(set(dealt))} distinct) of the {len(first["all"])} of the list: none may be missed or run twice')
    os.makedirs(out, exist_ok=True)
    entries, rows = [], []
    for index in range(1, count + 1):
        folder, info = shards[index]
        listed = {e['key']: e for e in load_json(os.path.join(folder, '_jobs.json'), f'the job list of {folder}')['jobs']}
        if sorted(listed) != sorted(info['jobs']):
            die(f"{folder}: its job list ({len(listed)} jobs) is not the shard's {len(info['jobs'])} jobs")
        files = sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(folder, '*.json')) if not os.path.basename(f).startswith('_'))
        if files != sorted(info['jobs']):
            gone = sorted(set(info['jobs']) - set(files))
            stray = sorted(set(files) - set(info['jobs']))
            die(f"{folder} (shard {index} of {count}) has no result for {', '.join(gone) or 'no job'}" + (f' and holds {", ".join(stray)}, which is not its job' if stray else ''))
        seconds = {}
        for key in files:
            shutil.copyfile(os.path.join(folder, key + '.json'), os.path.join(out, key + '.json'))
            seconds[key] = load_json(os.path.join(folder, key + '.json'), 'a job file').get('seconds') or 0
        entries.extend(listed.values())
        rows.append((index, len(files), sum(seconds.values()), max(seconds, key=seconds.get), max(seconds.values())))
    entries.sort(key=lambda e: e['key'])
    body = {'format': load_json(os.path.join(shards[1][0], '_jobs.json'), 'a job list').get('format'), 'only': None, 'count': len(entries),
            'jobs_sha256': first['jobs_sha256'], 'jobs': entries}
    with open(os.path.join(out, '_jobs.json'), 'w') as f:
        json.dump(body, f, indent=1)
    for index, n, total, longest, longest_s in rows:
        print(f'shard {index}/{count}: {n:2d} jobs, {total:7.1f} job-s; longest {longest} ({longest_s:.1f} s)')
    print(f'shard.py: joined {count} shards, {len(entries)} jobs, into {out}')


def main(argv):
    commands = {'plan': cmd_plan, 'select': cmd_select, 'merge': cmd_merge}
    if not argv or argv[0] not in commands:
        sys.exit(__doc__)
    commands[argv[0]](argv[1:])
    return 0


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    sys.exit(main(sys.argv[1:]))
