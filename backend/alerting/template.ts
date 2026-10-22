/**
 * The alert message templates.
 *
 * A template is plain text with `{{variable}}` placeholders:
 *
 *   "{{rule.name}}: {{metric}} is {{value}} (threshold {{threshold}})"
 *
 * An unknown placeholder is left as it is, so a message never loses
 * information because of a typo.
 */
export interface TemplateVars {
  rule: { name: string };
  metric: string | null;
  value: number | null;
  threshold: number | null;
  operator: string | null;
  windowSeconds: number | null;
  appId: string | null;
  projectId?: string | null;
  issue?: { fingerprint: string; title: string } | null;
}

function lookup(vars: TemplateVars, path: string): string | undefined {
  const value = path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      vars as unknown,
    );
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : String(value);
}

export function renderTemplate(
  template: string | null | undefined,
  vars: TemplateVars,
): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
    const value = lookup(vars, path);
    return value === undefined ? match : value;
  });
}
