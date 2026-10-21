"""Features of every lifted belt-fed window (first status waiting for space on a full machine, products taken at E+1,
input no longer waiting for space at L) in one recording; prints one JSON line per case. E is the first enabled sample
of the input's window, L the take from its machine, F the first growth of the input's hand: F - L = 0 is "in the tick
of the take", 1 "a tick later".

usage: python3 features.py <recording.json> | python3 summarize.py recipe,taker_sink,taker_opened,F_L"""
import json, sys
def expand(x, N):
    if not x: return [''] * N
    if isinstance(x[0], list):
        out = [''] * N
        for k, (st, v) in enumerate(x):
            en = x[k + 1][0] if k + 1 < len(x) else N
            for t in range(st, min(en, N)): out[t] = v
        return out
    return list(x)
DIS = 'disabled_by_control_behavior'
rec = sys.argv[1]
r = json.load(open(rec)); N = r['sample_count']
ins = {i['id']: i for i in r['inserters']}
st = {i['id']: expand(i['samples']['status'], N) for i in r['inserters']}
hi = {i['id']: expand(i['samples'].get('held_item', []), N) for i in r['inserters']}
machines = {m['id']: m for m in r['machines']}
belts = {b['id']: b for b in (r.get('config', {}) or {}).get('belts', [])}
def enables(i):
    s = st[i]
    return [t for t in range(1, N) if s[t] != DIS and s[t - 1] == DIS]
for I in r['inserters']:
    if I['source']['type'] != 'belt' or I['sink']['type'] != 'machine' or DIS not in st[I['id']]: continue
    M = machines[I['sink']['id']]; ms = expand(M['samples']['status'], N)
    takers = [T for T in r['inserters'] if T['source']['type'] == 'machine' and T['source']['id'] == M['id']]
    h = I['samples']['held_count']; lane = I['samples'].get('pickup_lane_items')
    for E in enables(I['id']):
        if not st[I['id']][E].startswith('waiting_for_space') or ms[E] != 'full_output' or E + 3 >= N: continue
        L = E + 1
        lifters = [T for T in takers if T['samples']['held_count'][L] > T['samples']['held_count'][L - 1]]
        if not lifters or ms[L] == 'full_output' or st[I['id']][L].startswith('waiting_for_space'): continue
        F = next((t for t in range(L, min(N, L + 40)) if h[t] > h[t - 1]), None)
        if F is None or F - L > 1: continue
        T = lifters[0]
        out_items = M['samples']['outputs']
        lane_series = {k: v[E - 6:L + 2] for k, v in lane.items()} if isinstance(lane, dict) else None
        print(json.dumps({
            'rec': rec.split('/')[-1][:60], 'dir': rec.split('/')[-5] if 'script-output' in rec else rec.split('/')[-2], 'ins': I['id'], 'machine': M['id'], 'recipe': M['recipe'],
            'E': E, 'F_L': F - L, 'in_at_L': st[I['id']][L], 'taker': T['id'], 'taker_sink': T['sink']['type'],
            'taker_opened': st[T['id']][E - 1] == DIS, 'taker_took': T['samples']['held_count'][L] - T['samples']['held_count'][L - 1],
            'out_before': {k: v[L - 1] for k, v in out_items.items()}, 'out_after': {k: v[L] for k, v in out_items.items()},
            'inputs_E': {k: v[E] for k, v in M['samples']['inputs'].items()}, 'inputs_L': {k: v[L] for k, v in M['samples']['inputs'].items()},
            'cp_E': M['samples']['crafting_progress'][E], 'pf_E': M['samples']['products_finished'][E] - M['samples']['products_finished'][E - 1],
            'm_status_L': ms[L], 'unit_in': I.get('unit_number'), 'unit_taker': T.get('unit_number'),
            'layout': I['source'].get('pickup_layout'), 'near_lane': I['source'].get('near_lane'), 'item': hi[I['id']][F],
            'lane': lane_series, 'stack': I.get('stack_size'), 'pickup_length': I['source'].get('pickup_length'),
        }))
