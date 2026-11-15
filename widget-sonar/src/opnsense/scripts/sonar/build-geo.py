#!/usr/bin/env python3
# Copyright (C) 2026 Igor Toledo <contato@igor.eti.br>
# All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
#
# 1. Redistributions of source code must retain the above copyright notice,
#    this list of conditions and the following disclaimer.
#
# 2. Redistributions in binary form must reproduce the above copyright
#    notice, this list of conditions and the following disclaimer in the
#    documentation and/or other materials provided with the distribution.
#
# THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES,
# INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
# AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
# AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
# OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
# POSSIBILITY OF SUCH DAMAGE.
#
"""Builds widget/Sonar-geo.bin: compact IPv4 -> country table, from the OPNsense GeoIP lists
(/usr/local/share/GeoIP/alias/<CC>-IPv4, generated from the GeoLite2-Country configured on the firewall).

Format (little-endian):
  'SGEO' | u32 n | u16 ncc | ncc x 2 ASCII bytes (country code; index 0 = '--' unknown)
  n x u32 range start | n x u8 country index
Range i goes from start[i] to start[i+1]-1. Ranges without a country get index 0.

Usage: python3 scripts/build-geo.py <folder with *-IPv4> [output=widget/Sonar-geo.bin]
"""
import ipaddress
import pathlib
import struct
import sys

src = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else pathlib.Path(__file__).resolve().parent.parent / "widget/Sonar-geo.bin")

countries = ["--"]
ranges = []  # (start, end, idx)
for f in sorted(src.glob("*-IPv4")):
    cc = f.name.split("-")[0].upper()
    if len(cc) != 2:
        continue
    countries.append(cc)
    idx = len(countries) - 1
    for line in f.read_text().split():
        try:
            n = ipaddress.IPv4Network(line.strip(), strict=False)
        except ValueError:
            continue
        ranges.append((int(n.network_address), int(n.broadcast_address), idx))

ranges.sort()
# merges contiguous ranges of the same country and fills gaps with 0
starts, idxs = [], []
cursor = 0
for start, end, idx in ranges:
    if start < cursor:        # overlap: skip the already covered beginning
        if end < cursor:
            continue
        start = cursor
    if start > cursor:
        if not idxs or idxs[-1] != 0:
            starts.append(cursor); idxs.append(0)
    if idxs and idxs[-1] == idx:
        pass                  # same range continues
    else:
        starts.append(start); idxs.append(idx)
    cursor = end + 1
if cursor <= 0xFFFFFFFF:
    starts.append(cursor); idxs.append(0)

if len(countries) > 255:
    sys.exit("more than 255 countries: widen the index to u16")
with open(out, "wb") as o:
    o.write(b"SGEO")
    o.write(struct.pack("<IH", len(starts), len(countries)))
    o.write("".join(countries).encode("ascii"))
    o.write(struct.pack(f"<{len(starts)}I", *starts))
    o.write(bytes(idxs))
print(f"{out}: {len(starts)} ranges, {len(countries) - 1} countries, {out.stat().st_size / 1024:.0f} KiB")
