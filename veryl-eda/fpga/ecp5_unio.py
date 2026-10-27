#!/usr/bin/env python3
"""nextpnr-ecp5 --write output -> a netlist yosys' ECP5 models can read: the IO buffers
(TRELLIS_IO, whose routed parameters the models do not know) and global clock buffers
(DCCA) become wires and the unconnected LUT inputs of TRELLIS_COMB read 1 as in the
slice, so the packed logic (TRELLIS_COMB / TRELLIS_FF / CCU2 halves) can be proven
equivalent to the mapped netlist. Every flip-flop's output gets the net name `ff<cell>`
(nextpnr keeps the cell names), so yosys' equiv_make pairs the states of both netlists.
usage: ecp5_unio.py routed.json out.json      (the routed netlist)
       ecp5_unio.py --names mapped.json out.json   (only the flip-flop names)"""
import json, sys

names_only = sys.argv[1] == '--names'
src, dst = sys.argv[-2], sys.argv[-1]
j = json.load(open(src))
mod = j['modules']['top'] if 'top' in j['modules'] else list(j['modules'].values())[0]
cells = mod['cells']
alias = {}  # bit -> bit
for name, c in list(cells.items()):
    if names_only:
        break
    if c['type'] == 'DCCA':  # global clock buffer (clock enable always on): a wire
        alias[c['connections']['CLKO'][0]] = c['connections']['CLKI'][0]
        del cells[name]
        continue
    if c['type'] != 'TRELLIS_IO':
        continue
    conn = c['connections']
    pad = conn['B'][0]
    if conn.get('O'):        # input buffer: O follows the pad
        alias[conn['O'][0]] = pad
    if conn.get('I'):        # output buffer: the pad is the driven net
        alias[pad] = conn['I'][0]
    del cells[name]


def res(b):
    seen = 0
    while b in alias and seen < 8:
        b = alias[b]
        seen += 1
    return b


for name, c in cells.items():
    for p, bits in c['connections'].items():
        c['connections'][p] = [res(b) for b in bits]
    # SD selects the flip-flop's data: "1" DI (the LUT output), "0" the M input
    if c['type'] == 'TRELLIS_FF' and 'SD' in c['parameters']:
        if c['parameters'].pop('SD').strip() == '0':
            c['connections']['DI'] = c['connections'].get('M', ['0'])
    # an unconnected LUT input reads 1 in the ECP5 slice (nextpnr folds constant inputs
    # into INITVAL that way); an unconnected carry-in is 0
    if c['type'] == 'TRELLIS_COMB':
        for p in 'ABCD':
            if not c['connections'].get(p):
                c['connections'][p] = ['1']
                c['port_directions'][p] = 'input'
        if not c['connections'].get('FCI'):
            c['connections']['FCI'] = ['0']
            c['port_directions']['FCI'] = 'input'
    if c['type'] == 'TRELLIS_FF':
        mod['netnames']['ff' + name.replace('$', '_')] = {'hide_name': 0, 'bits': c['connections']['Q'], 'attributes': {}}
for p in mod['ports'].values():
    p['bits'] = [res(b) for b in p['bits']]
for n in mod['netnames'].values():
    n['bits'] = [res(b) for b in n['bits']]
json.dump(j, open(dst, 'w'))
