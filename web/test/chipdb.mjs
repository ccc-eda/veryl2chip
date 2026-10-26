// Writes the IceStorm chip database embedded in dist/chipdb.js back to a
// text file (for veryl-eda's CLI where IceStorm is not installed, e.g. CI):
//   node test/chipdb.mjs OUT.txt
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'chipdb.js'), 'utf8');
const b64 = /VERYL_CHIPDB_GZ_B64 = "([A-Za-z0-9+/=]+)"/.exec(src)[1];
fs.writeFileSync(process.argv[2] ?? 'chipdb-5k.txt', gunzipSync(Buffer.from(b64, 'base64')));
