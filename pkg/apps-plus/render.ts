import { DEFAULT_CLUSTER_VALUES } from './config/cluster-template';

export interface Template {
  name: string;
  content: string;
}

const VARIABLE = /\$\{([A-Za-z0-9_.-]+)\}/g;

export const BUILT_IN_VALUES = ['app', 'install', 'cluster', 'namespace', 'cloudCredential', 'instance'];

export const DOCUMENTED_VALUES: { name: string; what: string }[] = [
  { name: 'app', what: 'the name of this app' },
  { name: 'install', what: 'the name of the installation being deployed' },
  { name: 'cluster', what: 'the cluster it is going to' },
  { name: 'namespace', what: 'the namespace the resources land in' },
];

function autoSatisfied(includeCluster: boolean): string[] {
  return includeCluster ? [...BUILT_IN_VALUES, ...Object.keys(DEFAULT_CLUSTER_VALUES)] : BUILT_IN_VALUES;
}

export function isSet(bag: Record<string, unknown> | undefined, key: string): boolean {
  const value = bag?.[key];

  return value !== undefined && value !== null && `${ value }`.trim() !== '';
}

export function referencedVariables(source: string): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(VARIABLE.source, 'g');
  let match = pattern.exec(source || '');

  while (match !== null) {
    found.add(match[1]);
    match = pattern.exec(source || '');
  }

  return [...found];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function appVariables(app: any, includeCluster = false): string[] {
  const found = new Set<string>(Object.keys(app?.spec?.values || {}));

  BUILT_IN_VALUES.forEach((name) => found.add(name));

  if (includeCluster) {
    referencedVariables(app?.spec?.clusterTemplate || '').forEach((name) => found.add(name));
  }

  return [...found];
}

export interface UndeclaredReference {
  file: string;
  names: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function undeclaredReferences(app: any): UndeclaredReference[] {
  if (app?.isHelmChart || app?.spec?.helm?.chart) {
    return [];
  }

  const declared = new Set([...Object.keys(app?.spec?.values || {}), ...BUILT_IN_VALUES]);

  return (app?.spec?.templates || [])
    .map((template: Template, i: number) => ({
      file:  template?.name || `resource-${ i }.yaml`,
      names: referencedVariables(template?.content || '').filter((name) => !declared.has(name)),
    }))
    .filter((reference: UndeclaredReference) => reference.names.length);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function undeclaredWarnings(app: any): { file: string; count: number; refs: string }[] {
  return undeclaredReferences(app).map(({ file, names }) => ({
    file,
    count: names.length,
    refs:  names.map((name) => `\${${ name }}`).join(', '),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requiredValues(app: any, includeCluster = false): string[] {
  return appVariables(app, includeCluster)
    .filter((name) => !autoSatisfied(includeCluster).includes(name))
    .filter((name) => !isSet(app?.spec?.values, name));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function missingValues(app: any, instance: any): string[] {
  const includeCluster = !!instance?.spec?.provisionCluster?.enabled;

  return requiredValues(app, includeCluster)
    .filter((name) => !isSet(instance?.spec?.values, name));
}

const WHOLE_SCALAR = /^([ \t]*)((?:[^\s#][^:\n]*:[ \t]+)|(?:- ))\$\{([A-Za-z0-9_.-]+)\}[ \t]*\r?$/;
const BLOCK_HEADER = /^([ \t]*)((?:- )*)([^\s#][^:\n]*:[ \t]*)?[|>][-+]?\d*[ \t]*(?:#.*)?\r?$/;

function blockIndent(header: RegExpExecArray): number {
  return header[1].length + (header[3] ? header[2].length : 0);
}

const NEEDS_QUOTES = /^$|^\s|\s$|: | #|^[?:-]\s|^[?:-]$|^[,[\]{}#&*!|>'"%@`]/;

const NOT_A_STRING = [
  /^(?:y|n|yes|no|true|false|on|off|null|~)$/i,
  /^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/,
  /^0o?[0-7]+$/i,
  /^[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.\d*)?$/,
  /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ].*)?$/,
];

function substituteScalar(indent: string, prefix: string, value: unknown, declaredString: boolean): string {
  const text = String(value);
  const head = `${ indent }${ prefix }`;

  if (!text.includes('\n')) {
    const quote = NEEDS_QUOTES.test(text) ||
      (declaredString && NOT_A_STRING.some((pattern) => pattern.test(text)));

    return head + (quote ? `'${ text.replace(/'/g, "''") }'` : text);
  }

  const inSequence = prefix.startsWith('- ');
  const body = indent + (inSequence ? '    ' : '  ');
  const indicator = prefix === '- ' ? 4 : 2;
  const trailing = (/\n+$/.exec(text) || [''])[0].length;
  const chomp = trailing === 0 ? '-' : (trailing === 1 ? '' : '+');
  const lines = text.replace(/\n+$/, '').split('\n');
  const extra = trailing > 1 ? new Array(trailing - 1).fill('') : [];

  return [`${ head }|${ indicator }${ chomp }`, ...lines.map((line) => (line ? body + line : '')), ...extra].join('\n');
}

function declaredStrings(values: Record<string, unknown> | undefined): Set<string> {
  return new Set([...BUILT_IN_VALUES, ...Object.entries(values || {})
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([key]) => key)]);
}

function plain(line: string, values: Record<string, unknown>): string {
  return line.replace(VARIABLE, (match, key) => {
    const value = values[key];

    return value === undefined || value === null ? match : String(value);
  });
}

export function substitute(source: string, values: Record<string, unknown>, declared?: Record<string, unknown>): string {
  const strings = declaredStrings(declared === undefined ? values : declared);
  let block: number | null = null;

  return (source || '').split('\n').map((line) => {
    const indent = (/^[ \t]*/.exec(line) as RegExpExecArray)[0].length;

    if (block !== null && (!line.trim() || indent > block)) {
      return plain(line, values);
    }

    const header = BLOCK_HEADER.exec(line);

    block = header ? blockIndent(header) : null;

    const whole = header ? null : WHOLE_SCALAR.exec(line);
    const value = whole ? values[whole[3]] : undefined;

    if (whole && value !== undefined && value !== null) {
      return substituteScalar(whole[1], whole[2], value, strings.has(whole[3]));
    }

    return plain(line, values);
  }).join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeValues(app: any, instance: any): Record<string, unknown> {
  const namespace = instance?.spec?.namespace || 'default';
  const declared = app?.spec?.values || {};

  return {
    ...declared,
    ...typedOverrides(declared, instance?.spec?.values),
    app:      app?.metadata?.name || instance?.spec?.app || '',
    install:  instance?.metadata?.name || '',
    instance: instance?.metadata?.name || '',
    cluster:  instance?.clusterName || instance?.spec?.provisionCluster?.name || instance?.metadata?.name || '',
    namespace,
  };
}

const BOOLEAN_WORDS: Record<string, boolean> = {
  true: true, yes: true, on: true, y: true, false: false, no: false, off: false, n: false,
};

export function typedOverrides(
  declared: Record<string, unknown>,
  overrides: Record<string, unknown> | undefined,
  blankDeclaresRequired = false,
): Record<string, unknown> {
  return Object.entries(overrides || {}).reduce((out: Record<string, unknown>, [key, value]) => {
    const base = declared[key];
    const typed = typeof base === 'number' || typeof base === 'boolean';
    const text = typeof value === 'string' ? value.trim() : '';

    if (typed && typeof value === 'string' && text === '') {
      if (blankDeclaresRequired) {
        out[key] = value;
      }

      return out;
    }

    if (typeof base === 'number' && text !== '' && !isNaN(Number(text))) {
      out[key] = Number(text);
    } else if (typeof base === 'boolean' && BOOLEAN_WORDS[text.toLowerCase()] !== undefined) {
      out[key] = BOOLEAN_WORDS[text.toLowerCase()];
    } else {
      out[key] = value;
    }

    return out;
  }, {});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderTemplates(app: any, instance: any): Template[] {
  const values = mergeValues(app, instance);

  return (app?.spec?.templates || []).map((template: Template, i: number) => ({
    name:    substitute(template?.name || `resource-${ i }.yaml`, values, app?.spec?.values),
    content: substitute(template?.content || '', values, app?.spec?.values),
  }));
}

export function flattenValues(
  input: Record<string, unknown> | undefined,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return out;
  }

  for (const [key, val] of Object.entries(input)) {
    const path = prefix ? `${ prefix }.${ key }` : key;

    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      if (Object.keys(val as Record<string, unknown>).length > 0) {
        flattenValues(val as Record<string, unknown>, path, out);
      }
    } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out[path] = val;
    }
  }

  return out;
}

export function unflattenValues(flat: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(flat || {})) {
    if (value === undefined) {
      continue;
    }

    const parts = rawKey.split('.').filter(Boolean);

    if (!parts.length) {
      continue;
    }

    let cursor: Record<string, unknown> = out;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];

      if (cursor[part] === null || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }

    cursor[parts[parts.length - 1]] = value;
  }

  return out;
}
