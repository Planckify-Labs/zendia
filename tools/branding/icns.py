# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Writes a macOS .icns from PNGs: icns.py out.icns TYPE=file.png ..."""

import struct
import sys

out, *pairs = sys.argv[1:]
entries = [(p.split("=", 1)[0], open(p.split("=", 1)[1], "rb").read()) for p in pairs]
body = b"".join(t.encode() + struct.pack(">I", 8 + len(d)) + d for t, d in entries)
open(out, "wb").write(b"icns" + struct.pack(">I", 8 + len(body)) + body)
