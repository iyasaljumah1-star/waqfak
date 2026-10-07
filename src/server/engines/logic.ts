/**
 * Minimal, safe JSON-logic evaluator used by the rules engine, conditional questions and obligation applicability.
 * Rules are data (stored in the database, edited in admin) — never executed as code.
 *
 * Supported: var, ==, !=, ===, !==, >, >=, <, <=, and, or, !, !!, in, missing, if, +, -, *, /, max, min, some_true.
 */
export type Logic = unknown;
export type Facts = Record<string, unknown>;

function getVar(facts: Facts, path: string, fallback: unknown) {
  if (path === "" || path == null) return facts;
  let cur: unknown = facts;
  for (const part of String(path).split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return fallback ?? null;
  }
  return cur ?? fallback ?? null;
}

const num = (v: unknown) => (typeof v === "number" ? v : v === null || v === undefined || v === "" ? NaN : Number(v));
const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

export function evaluate(rule: Logic, facts: Facts): unknown {
  if (rule === null || typeof rule !== "object") return rule;
  if (Array.isArray(rule)) return rule.map((r) => evaluate(r, facts));
  const keys = Object.keys(rule as object);
  if (keys.length !== 1) throw new Error(`invalid logic node: ${JSON.stringify(rule)}`);
  const op = keys[0];
  const rawArgs = (rule as Record<string, unknown>)[op];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];

  switch (op) {
    case "var": {
      const [p, fb] = args;
      return getVar(facts, String(evaluate(p, facts) ?? ""), fb);
    }
    case "and": {
      let last: unknown = true;
      for (const a of args) {
        last = evaluate(a, facts);
        if (!truthy(last)) return last;
      }
      return last;
    }
    case "or": {
      let last: unknown = false;
      for (const a of args) {
        last = evaluate(a, facts);
        if (truthy(last)) return last;
      }
      return last;
    }
    case "if": {
      for (let i = 0; i + 1 < args.length; i += 2) if (truthy(evaluate(args[i], facts))) return evaluate(args[i + 1], facts);
      return args.length % 2 === 1 ? evaluate(args[args.length - 1], facts) : null;
    }
    case "!":
      return !truthy(evaluate(args[0], facts));
    case "!!":
      return truthy(evaluate(args[0], facts));
    case "missing":
      return args.map((a) => String(evaluate(a, facts))).filter((k) => {
        const v = getVar(facts, k, null);
        return v === null || v === undefined || v === "";
      });
    case "some_true":
      return args.some((a) => truthy(evaluate(a, facts)));
  }

  const vals = args.map((a) => evaluate(a, facts));
  switch (op) {
    case "==":
      // eslint-disable-next-line eqeqeq
      return vals[0] == vals[1];
    case "!=":
      // eslint-disable-next-line eqeqeq
      return vals[0] != vals[1];
    case "===":
      return vals[0] === vals[1];
    case "!==":
      return vals[0] !== vals[1];
    case ">":
      return num(vals[0]) > num(vals[1]);
    case ">=":
      return num(vals[0]) >= num(vals[1]);
    case "<":
      return vals.length === 3 ? num(vals[0]) < num(vals[1]) && num(vals[1]) < num(vals[2]) : num(vals[0]) < num(vals[1]);
    case "<=":
      return vals.length === 3 ? num(vals[0]) <= num(vals[1]) && num(vals[1]) <= num(vals[2]) : num(vals[0]) <= num(vals[1]);
    case "in": {
      const [needle, hay] = vals;
      if (Array.isArray(hay)) return hay.includes(needle as never);
      if (typeof hay === "string") return hay.includes(String(needle));
      return false;
    }
    case "+":
      return vals.reduce((a: number, b) => a + num(b), 0);
    case "-":
      return vals.length === 1 ? -num(vals[0]) : num(vals[0]) - num(vals[1]);
    case "*":
      return vals.reduce((a: number, b) => a * num(b), 1);
    case "/":
      return num(vals[0]) / num(vals[1]);
    case "max":
      return Math.max(...vals.map(num));
    case "min":
      return Math.min(...vals.map(num));
    default:
      throw new Error(`unsupported operator: ${op}`);
  }
}

export const test = (rule: Logic, facts: Facts): boolean => (rule == null ? true : truthy(evaluate(rule, facts)));

/** Validates a rule before it is saved from the admin panel (throws on unknown operators). */
export function validateLogic(rule: Logic): string | null {
  try {
    evaluate(rule, {});
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
