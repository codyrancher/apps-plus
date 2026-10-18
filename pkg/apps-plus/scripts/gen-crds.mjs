import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'service', 'crds');
const OUT = path.join(here, '..', 'crds.generated.ts');

const defs = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.yaml'))
  .sort()
  .map((f) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')));

fs.writeFileSync(OUT, `/* eslint-disable */
export const CRD_DEFINITIONS: Record<string, unknown>[] = ${ JSON.stringify(defs, null, 2) };
`);

console.log(`crds: ${ defs.length } definitions -> crds.generated.ts`);
