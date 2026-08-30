// Rendering an App's templates for one instance.
//
// Deliberately not Helm. A chart's templating is a whole language with a runtime, and the
// point here is that a template is a YAML file you can read: the only substitution is
// `${name}`, looked up in the App's values merged with the instance's overrides. Anything
// unmatched is left exactly as written rather than blanked, so a `${...}` that belongs to
// whatever the YAML configures survives being rendered.

export interface Template {
  name: string;
  content: string;
}

const VARIABLE = /\$\{\s*([A-Za-z0-9_.-]+)\s*\}/g;

export function substitute(source: string, values: Record<string, unknown>): string {
  return (source || '').replace(VARIABLE, (match, key) => {
    const value = values[key];

    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * The values one instance renders with: the App's defaults, the instance's overrides on top,
 * and three the pair always knows about themselves.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeValues(app: any, instance: any): Record<string, unknown> {
  const namespace = instance?.spec?.namespace || app?.spec?.defaultNamespace || 'default';

  return {
    ...(app?.spec?.values || {}),
    ...(instance?.spec?.values || {}),
    app:      app?.metadata?.name || instance?.spec?.app || '',
    instance: instance?.metadata?.name || '',
    namespace,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderTemplates(app: any, instance: any): Template[] {
  const values = mergeValues(app, instance);

  return (app?.spec?.templates || []).map((template: Template, i: number) => ({
    name:    substitute(template?.name || `resource-${ i }.yaml`, values),
    content: substitute(template?.content || '', values),
  }));
}
