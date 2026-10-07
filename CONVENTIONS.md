# Waqfak — engineering conventions (read before writing code)

Next.js **16.4** (App Router, Turbopack, React 19.3). APIs differ from older versions: read
`node_modules/next/dist/docs/` for anything you are unsure about. `params`, `searchParams`, `cookies()`,
`headers()` are **async**. Middleware is `src/proxy.ts`. No `cacheComponents`; pages are dynamic.

## Ground rules
- **Never run `npm install`** or edit `package.json`. Available libs: drizzle-orm, pg, zod 4, lucide-react,
  clsx, otplib, qrcode, file-type, playwright-core (PDF via Chromium), @node-rs/argon2. Need something else → write it yourself or report it.
- **Do not edit shared foundation files**: `src/server/db/schema/**`, `src/server/db/sql/**`, `src/server/engines/**`,
  `src/server/authz/**`, `src/server/auth/**`, `src/server/lib/**`, `src/components/ui/**`, `src/app/globals.css`,
  `src/app/layout.tsx`, `src/server/modules/_shared.ts`, `scripts/seed.ts`, `scripts/seed-demo.ts`. If you truly need a change
  there (new column, new permission), do NOT make it; list it under "Requests to integrator" in your final report and work around it
  (jsonb fields such as `intake`, `meta`, `scope`, `settings` exist on many tables).
- Only create/edit files inside the paths your brief assigns you. Shared registries you may **append** to: `src/config/nav.ts` (only your own section).
- **No secrets in code.** Read config from `src/server/env.ts`. No real personal data; demo data is fictional and marked "(تجريبي)".
- Arabic-first UI, RTL. Write clear, plain Arabic copy (active verbs, sentence case, no filler). Errors say what happened and how to fix.
- Every page must work at 360px width. Use logical CSS (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`), never `left/right`.

## Data access (security model — non-negotiable)
- All DB access goes through `withContext(auth.db, tx => …)` (or helpers below). PostgreSQL RLS isolates waqfs
  via `app_can_access_waqf(waqf_id)`. `withSystem` (global access) is only for: auth flows, public catalog reads
  (services, content, settings), background jobs, and seeds. **Never** use `withSystem` to read waqf data on behalf of a user.
- Server components: `const auth = await requireAuth()`; then `read(auth, tx => …)` from `@/server/modules/_shared`.
- Waqf pages: `const access = await requireWaqf(auth, id, "<perm>")` (redirects if no access). Check finer permissions with `waqfCan(access, perm)`.
- Staff pages (`/admin/**`): `await requireStaff("<perm>")` (enforces MFA). Staff see a waqf's data only if assigned
  (open service request) or with a global-access role — RLS enforces this, so query normally.
- Beneficiary-only members (`access.isBeneficiaryOnly`) must only see their own entitlement: never the full beneficiary list.
- Sensitive fields (national IDs, IBANs, addresses) are encrypted with `encryptString` / stored with `lookupHash`; display masked.

## Mutations (server actions)
- Files: `src/server/modules/<area>/actions.ts` with `"use server"` at top; queries in `src/server/modules/<area>/queries.ts` (`import "server-only"`).
- Action signature for forms: `export async function x(prev: ActionState, fd: FormData): Promise<ActionState>` used with `useActionState`.
- Wrap with `waqfAction(waqfId, perm, async ({auth, access, tx, ip, userAgent}) => {...}, revalidatePath)` or `userAction(fn, {perm, revalidate})`.
  Validate input with zod via `parseForm(schema, fd)` (return `r.state` on failure). Throw `UserError("…")` for user-facing failures.
- Every state change writes `audit(tx, { actorUserId, action: "<area>.<verb>", entityType, entityId, waqfId, ip, userAgent, before, after })`.
- Notify users with `notify(userId, templateKey, vars, { waqfId, link, tx })` (templates in `src/server/seed/data/system.ts`; if a key is missing, notify is a no-op — list needed templates in your report).
- Regulatory consequences: call `emitWaqfEvent(tx, { waqfId, event, date, refId })` and after profile changes `syncWaqfObligations(tx, waqfId)` (`@/server/modules/compliance/events`).
- Numbers: `nextNumber(tx, "REQ")` → `REQ-000123` (prefixes: WQF, REQ, INV, CTR, MTG, RES, CMP, TSK, DOC, AST).
- `redirect()` inside actions is fine (toState rethrows Next errors).

## UI kit (`@/components/ui`, `@/components/ui/form`)
`PageHeader{title,description,actions,crumbs}`, `Panel`, `Stat`, `Badge{tone}`, `Alert{tone,title}`, `EmptyState{icon,title,action}`,
`DataTable{rows,columns:[{key,label,render:(r)=>node,className?,hideOnMobile?}],rowKey:(r)=>string,empty}`, `DefinitionList`, `Steps`,
`ProgressBar`, `Button/ButtonLink{variant: primary|secondary|ghost|danger|seal, size}`, `Skeleton/LoadingBlock`.
Forms: `Field{label,name,hint,error,required}` wrapping `Input/Textarea/Select{options}/Checkbox`, `SubmitButton{pendingText}`, `FormMessage{state}`.
Formatting: `@/lib/utils` → `fmtSAR, fmtDate, fmtHijri, fmtBoth (regulatory dates show both calendars), fmtDateTime, relDays, daysUntil`, label maps.
Tones: critical (red, violations/overdue), fine (orange, penalties), warn, ok, info, neutral, ink, seal.
Design language: ink `#1f2e4d`, seal `#a8823a`, olive `#5b7746`, stone `#eef0ec`; IBM Plex Sans Arabic for UI, Noto Naskh (`.naskh`) for deed/legal text;
`.deed-paper` for document-like surfaces. Restraint: no gradients, no decorative numbering, no card-grid everywhere. Icons: lucide-react.
Add `loading.tsx` for heavy routes; `error.tsx` exists at shell level.

## Routes (URL contracts — link to these even if another team builds them)
Public: `/`, `/services`, `/services/[code]`, `/packages`, `/for/waqif`, `/for/nazir`, `/for/beneficiary`, `/for/entities`, `/library`, `/library/[slug]`,
`/regulations`, `/faq`, `/glossary`, `/tools/[tool]`, `/contact`, `/about`, `/legal/[page]` (terms, privacy, cookies, ai, accessibility, disclaimer),
`/assessment` (anonymous start), `/assessment/[id]` (take), `/assessment/[id]/result`, `/r/[token]` (shared report).
Auth: `/login`, `/signup`, `/verify`, `/login/mfa`, `/recover`.
Portal: `/app` (dashboard), `/app/waqfs`, `/app/waqfs/new`, `/app/w/[id]/<segment>` (segments in `src/config/nav.ts`),
`/app/b/[waqfId]` (beneficiary view), `/app/establish` (new waqf wizard), `/app/establish/[draftId]`, `/app/wills`, `/app/requests`, `/app/requests/new?service=&waqf=&rec=`,
`/app/requests/[id]`, `/app/services`, `/app/billing`, `/app/billing/[invoiceId]`, `/app/tasks`, `/app/calendar`, `/app/assessments`, `/app/notifications`,
`/app/profile`, `/app/security`, `/app/privacy`, `/app/invitations/[token]`, `/app/w/[id]/governance/meetings/[mid]`.
Admin: see `ADMIN_NAV` in `src/config/nav.ts`; detail pages `/admin/requests/[id]`, `/admin/waqfs/[id]`, `/admin/clients/[id]`, etc.
Files API: `GET /api/files/[documentId]?v=<versionId>&disposition=inline|attachment`, `POST /api/files` (multipart).

## Demo data & testing
- `npm run db:seed-demo -- --reset` recreates demo users/waqfs; credentials land in `storage/demo-credentials.json`.
  Users: admin, ops, emp1, emp2, mlro, editor (staff: email+password+TOTP), nazir (waqf A), waqif (founder+nazir of B),
  chair/member1/member2/secretary (board of C), beneficiary (B), outsider (no waqf). Waqfs: A public medium, B private small, C public large board.
  emp1 is assigned a request on A; emp2 on C.
- To add demo data for your area: create `scripts/demo/<NN>-<area>.ts` exporting `default async (tx, ctx: DemoCtx)` (see seed-demo.ts). Mark names "(تجريبي)".
- E2E: `tests/e2e/<area>.spec.ts`, helpers `loginAs(page, "nazir")`, `signup(page)`, `demo()`. Dev server is already running on :3000 — do **not** start another
  and do **not** kill it. Run: `npx playwright test tests/e2e/<file> --project=desktop` (and `--project=mobile`).
- Unit tests: `tests/<area>.test.ts` with vitest (`npx vitest run tests/<file>`).
- Typecheck: `npx tsc --noEmit` — fix errors in **your** files; ignore errors in files owned by others (other teams work concurrently).
- Scripts that import server modules must run with `npx tsx --conditions=react-server <file>`.
- Verify pages visually with a Playwright screenshot (desktop 1366 and mobile 412) before you finish.

## Final report (your last message)
1. Files created/changed. 2. What works (tested how). 3. What is stubbed/pending and why. 4. Requests to integrator (schema/permission/template/foundation changes). 5. Compliance items touched (REQ codes).
