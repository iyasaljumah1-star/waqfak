/** Token-level longest-common-subsequence diff, grouped into equal / replace / delete / insert operations. */

export type DiffOp =
  | { op: "equal"; a: [number, number]; b: [number, number] }
  | { op: "replace"; a: [number, number]; b: [number, number] }
  | { op: "delete"; a: [number, number]; b: [number, number] }
  | { op: "insert"; a: [number, number]; b: [number, number] };

/** Above this many cells the diff falls back to a windowed alignment (articles are far smaller in practice). */
const MAX_CELLS = 40_000_000;

export function diffTokens(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // Trim common prefix/suffix first: most articles differ in a few places only.
  let pre = 0;
  while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  const A = a.slice(pre, n - suf);
  const B = b.slice(pre, m - suf);
  const core = (A.length + 1) * (B.length + 1) <= MAX_CELLS ? lcsOps(A, B) : coarse(A, B);
  const ops: DiffOp[] = [];
  if (pre) ops.push({ op: "equal", a: [0, pre], b: [0, pre] });
  for (const o of core) ops.push({ ...o, a: [o.a[0] + pre, o.a[1] + pre], b: [o.b[0] + pre, o.b[1] + pre] } as DiffOp);
  if (suf) ops.push({ op: "equal", a: [n - suf, n], b: [m - suf, m] });
  return merge(ops);
}

function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ op: "insert", a: [0, 0], b: [0, m] }];
  if (m === 0) return [{ op: "delete", a: [0, n], b: [0, 0] }];
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const raw: DiffOp[] = [];
  let i = 0;
  let j = 0;
  const push = (op: DiffOp["op"], di: number, dj: number) => {
    const last = raw[raw.length - 1];
    if (last && last.op === op) {
      last.a[1] += di;
      last.b[1] += dj;
    } else raw.push({ op, a: [i, i + di], b: [j, j + dj] } as DiffOp);
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", 1, 1);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) {
      push("delete", 1, 0);
      i++;
    } else {
      push("insert", 0, 1);
      j++;
    }
  }
  if (i < n) push("delete", n - i, 0);
  if (j < m) push("insert", 0, m - j);
  return raw;
}

/** Fallback for very long inputs: the whole span is one replacement (reported, never silently accepted). */
function coarse(a: string[], b: string[]): DiffOp[] {
  return [{ op: "replace", a: [0, a.length], b: [0, b.length] }];
}

/** Adjacent delete+insert become one replace; contiguous ranges are joined. */
function merge(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const o of ops) {
    if (o.a[0] === o.a[1] && o.b[0] === o.b[1]) continue;
    const last = out[out.length - 1];
    if (last && last.op !== "equal" && o.op !== "equal") {
      last.a[1] = o.a[1];
      last.b[1] = o.b[1];
      const hasA = last.a[1] > last.a[0];
      const hasB = last.b[1] > last.b[0];
      (last as { op: DiffOp["op"] }).op = hasA && hasB ? "replace" : hasA ? "delete" : "insert";
      continue;
    }
    if (last && last.op === "equal" && o.op === "equal") {
      last.a[1] = o.a[1];
      last.b[1] = o.b[1];
      continue;
    }
    out.push({ ...o, a: [...o.a], b: [...o.b] } as DiffOp);
  }
  return out;
}
