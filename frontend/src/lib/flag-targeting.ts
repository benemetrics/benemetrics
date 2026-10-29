import type { TargetingRule } from "./data";

export const targetingOperators: TargetingRule["operator"][] = [
  "is one of",
  "is not one of",
  "contains",
  "ends with",
  "greater than",
];

// The backend rule shape (protocol/feature-flags.ts): scalar values for
// contains/ends_with/greater_than, arrays for in/not_in.
export interface ApiTargetingRule {
  attribute: string;
  operator: string;
  value: unknown;
  variantKey?: string;
}

const toApiOperator: Record<TargetingRule["operator"], string> = {
  "is one of": "in",
  "is not one of": "not_in",
  contains: "contains",
  "ends with": "ends_with",
  "greater than": "greater_than",
};

const toUiOperator: Record<string, TargetingRule["operator"]> = {
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
  ends_with: "ends with",
  greater_than: "greater than",
};

export function toUiRules(rules: ApiTargetingRule[]): TargetingRule[] {
  return rules.map((rule, index) => {
    const raw = Array.isArray(rule.value) ? rule.value : [rule.value];
    return {
      id: String(index),
      attribute: rule.attribute,
      operator: toUiOperator[rule.operator] ?? "is one of",
      values: raw.map((value) => String(value)),
      variant: rule.variantKey ?? "treatment",
    };
  });
}

export function toApiRules(rules: TargetingRule[]): ApiTargetingRule[] {
  return rules.map((rule) => {
    const scalar =
      rule.values.length === 1 ? rule.values[0] : (rule.values[0] ?? "");
    return {
      attribute: rule.attribute,
      operator: toApiOperator[rule.operator],
      value:
        rule.operator === "is one of" || rule.operator === "is not one of"
          ? rule.values
          : scalar,
      variantKey: rule.variant,
    };
  });
}

export function parseTargetValues(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export function matchesTargetingRule(
  rule: TargetingRule,
  attributes: Record<string, string>,
): boolean {
  const value = attributes[rule.attribute];
  if (value === undefined || !rule.values.length) return false;
  switch (rule.operator) {
    case "is one of":
      return rule.values.includes(value);
    case "is not one of":
      return !rule.values.includes(value);
    case "contains":
      return rule.values.some((target) => value.includes(target));
    case "ends with":
      return rule.values.some((target) => value.endsWith(target));
    case "greater than":
      return (
        value.trim() !== "" &&
        Number.isFinite(Number(value)) &&
        rule.values.some(
          (target) =>
            Number.isFinite(Number(target)) && Number(value) > Number(target),
        )
      );
  }
}

export function targetedVariant(
  rules: TargetingRule[],
  attributes: Record<string, string>,
): string | undefined {
  return rules.find((rule) => matchesTargetingRule(rule, attributes))?.variant;
}
