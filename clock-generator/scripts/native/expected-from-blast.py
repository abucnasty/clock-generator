#!/usr/bin/env python3
"""The expected clock hashes of a native run, from a blast (a cache entry, its jobs/ or a run folder): for every pickup,
over-hood and front job, "<case name> <first 12 hex of the selected clock's sha256>", the hash check.cjs computes from a
capture's or a preflight's generated-clock.json (both hash JSON.stringify({blueprint, schedule}) of the exported clock).

usage: expected-from-blast.py <blast> > expected-hashes.txt
"""
import glob, json, os, sys

d = sys.argv[1]
if os.path.exists(os.path.join(d, 'MANIFEST.json')):
    d = os.path.join(d, 'jobs')
for f in sorted(glob.glob(os.path.join(d, '*.json'))):
    if os.path.basename(f).startswith('_'):
        continue
    j = json.load(open(f))
    if j['group'] in ('pickup', 'overhood', 'front') and 'selected' in j:
        print(j['name'], j['selected']['clock_sha256'][:12])
