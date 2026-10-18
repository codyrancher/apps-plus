import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, '..', 'service', 'server.mjs');
const OUT = path.join(here, '..', 'service.generated.ts');

const source = fs.readFileSync(SOURCE, 'utf8');

fs.writeFileSync(OUT, `/* eslint-disable */
export const SERVICE_SOURCE = ${ JSON.stringify(source) };
`);

console.log(`service: ${ (source.length / 1024).toFixed(1) } KiB -> service.generated.ts`);
