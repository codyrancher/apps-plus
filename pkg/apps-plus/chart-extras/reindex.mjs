// Update one entry's digest in a Helm repo index.yaml in place, after its chart archive was
// repackaged. Everything else in the entry - urls (relative), created, annotations - is left
// exactly as the generator wrote it; only the digest changes, because only the bytes did.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require(process.env.JS_YAML || 'js-yaml');

const [indexPath, version, digest] = process.argv.slice(2);
const idx = yaml.load(fs.readFileSync(indexPath, 'utf8'));
const entries = idx.entries?.['apps-plus'] || [];
const entry = entries.find((e) => e.version === version);

if (!entry) {
  console.error(`reindex: apps-plus ${ version } is not in ${ indexPath }`);
  process.exit(1);
}

entry.digest = digest;
idx.generated = new Date().toISOString();
fs.writeFileSync(indexPath, yaml.dump(idx, { noRefs: true, lineWidth: -1 }));
console.log(`reindex: apps-plus ${ version } digest -> ${ digest }`);
