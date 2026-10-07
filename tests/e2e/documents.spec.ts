import "dotenv/config";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { existsSync } from "node:fs";
import { expect, test, request as pwRequest, type Browser, type Page } from "@playwright/test";
import { demo, loginAs } from "./helpers";

const minimalPdf = (label: string) =>
  Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      `4 0 obj << /Length ${44 + label.length} >> stream`,
      `BT /F1 18 Tf 20 70 Td (${label}) Tj ET`,
      "endstream endobj",
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n"),
    "latin1",
  );

async function storageKeyOf(docId: string, version: number) {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.global_access','on',true)");
    const r = await c.query("select storage_key from document_versions where document_id = $1 and version = $2", [docId, version]);
    await c.query("commit");
    return r.rows[0]?.storage_key as string;
  } finally {
    await c.end();
  }
}

const shotsDir = "/tmp/claude-0/shots";

/**
 * Logs in once per demo user and reuses the session (OTP sending is rate-limited per phone and per IP,
 * and other suites log in concurrently). A cached session is re-validated before use.
 */
async function sessionPage(browser: Browser, key: string, viewport?: { width: number; height: number } | null): Promise<Page> {
  const file = `/tmp/claude-0/e2e-docs-${key}-${demo().users[key].id}.json`;
  const opts = viewport ? { viewport } : {};
  if (existsSync(file)) {
    const ctx = await browser.newContext({ ...opts, storageState: file });
    const page = await ctx.newPage();
    const res = await page.request.get("/api/files/00000000-0000-4000-8000-000000000000");
    if (res.status() !== 401) return page;
    await ctx.close();
  }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await loginAs(page, key);
  await ctx.storageState({ path: file });
  return page;
}

async function uploadViaUi(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, title?: string) {
  if (title) await page.getByLabel("عنوان الوثيقة").fill(title);
  await page.getByTestId("document-file-input").setInputFiles(file);
}

test.describe.serial("secure document vault", () => {
  const W = () => demo().waqfs.A;
  const stamp = Date.now().toString(36);
  const title = `عقد صيانة تجريبي ${stamp}`;
  const v1 = minimalPdf(`Waqfak e2e v1 ${stamp}`);
  const v2 = minimalPdf(`Waqfak e2e v2 ${stamp}`);
  let docId = "";
  let shareUrl = "";

  test("nazir uploads a PDF; it is listed, previewable and encrypted on disk", async ({ browser, viewport }) => {
    const page = await sessionPage(browser, "nazir", viewport);
    await page.goto(`/app/w/${W()}/documents`);
    await expect(page.getByRole("heading", { level: 1, name: "الوثائق" })).toBeVisible();
    await uploadViaUi(page, { name: "maintenance-contract.pdf", mimeType: "application/pdf", buffer: v1 }, title);
    await page.locator("select[name=docType]").selectOption("contract");
    await page.getByRole("button", { name: "ارفع الوثيقة" }).click();
    await expect(page.getByRole("status").filter({ hasText: "رُفعت" })).toBeVisible();
    const link = page.getByRole("link", { name: title });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/);
    docId = page.url().split("/").pop()!;

    // inline preview (iframe → API)
    const frame = page.locator(`iframe[data-src*="/api/files/${docId}"]`);
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("src", /^blob:/);
    const res = await page.request.get(`/api/files/${docId}?disposition=inline`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["content-disposition"]).toContain("filename*=UTF-8''");
    expect(Buffer.from(await res.body()).equals(v1)).toBe(true);

    // ciphertext at rest
    const key = await storageKeyOf(docId, 1);
    expect(key).toMatch(new RegExp(`^w/${W()}/`));
    const onDisk = readFileSync(path.join(process.env.STORAGE_DIR ?? "./storage", "blobs", key));
    expect(onDisk.equals(v1)).toBe(false);
    expect(onDisk.includes("%PDF")).toBe(false);
  });

  test("a new version becomes current", async ({ browser, viewport }) => {
    const page = await sessionPage(browser, "nazir", viewport);
    await page.goto(`/app/w/${W()}/documents/${docId}`);
    await page.getByTestId("document-file-input").setInputFiles({ name: "maintenance-contract-signed.pdf", mimeType: "application/pdf", buffer: v2 });
    await page.getByLabel("ملاحظة التغيير").fill("نسخة موقّعة");
    await page.getByRole("button", { name: "ارفع النسخة" }).click();
    await expect(page.getByRole("status").filter({ hasText: "رُفعت النسخة الجديدة" })).toBeVisible();
    await expect(page.getByText("maintenance-contract-signed.pdf").first()).toBeVisible();
    const res = await page.request.get(`/api/files/${docId}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/^attachment/);
    expect(Buffer.from(await res.body()).equals(v2)).toBe(true);
  });

  test("disguised and active-content files are rejected", async ({ browser, viewport }) => {
    const page = await sessionPage(browser, "nazir", viewport);
    // HTML renamed to .pdf → refused before storage
    const fake = await page.request.post("/api/files", {
      multipart: { waqfId: W(), title: "ملف مزيف", file: { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>") } },
    });
    expect(fake.status()).toBe(415);
    expect((await fake.json()).error).toContain("لا يطابق امتداده");

    // and the uploader shows the Arabic error
    await page.goto(`/app/w/${W()}/documents`);
    await uploadViaUi(page, { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><body>x</body></html>") });
    await page.getByRole("button", { name: "ارفع الوثيقة" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "لا يطابق امتداده" })).toBeVisible();

    // PDF with JavaScript → stored as rejected, never served
    const js = await page.request.post("/api/files", {
      multipart: { waqfId: W(), title: `PDF نشط ${stamp}`, file: { name: "active.pdf", mimeType: "application/pdf", buffer: Buffer.from(minimalPdf("x").toString("latin1").replace("/Type /Catalog", "/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), "latin1") } },
    });
    expect(js.status()).toBe(422);
    const body = await js.json();
    expect(body.error).toContain("JavaScript");
    expect((await page.request.get(`/api/files/${body.id}`)).status()).toBe(409);

    // unauthenticated
    const anon = await pwRequest.newContext({ baseURL: test.info().project.use.baseURL });
    expect((await anon.post("/api/files", { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: v1 } } })).status()).toBe(401);
    await anon.dispose();
  });

  test("outsider cannot fetch the document", async ({ browser }) => {
    const page = await sessionPage(browser, "outsider");
    const res = await page.request.get(`/api/files/${docId}`);
    expect([403, 404]).toContain(res.status());
    expect(res.headers()["content-type"]).toContain("application/json");
    await page.context().close();
  });

  test("share link works without login and stops after revocation", async ({ browser, viewport }) => {
    const page = await sessionPage(browser, "nazir", viewport);
    await page.goto(`/app/w/${W()}/documents/${docId}`);
    await page.getByRole("button", { name: "أنشئ رابط مشاركة" }).click();
    const urlBox = page.getByTestId("share-url");
    await expect(urlBox).toBeVisible();
    shareUrl = new URL(await urlBox.inputValue()).pathname;
    expect(shareUrl).toMatch(/^\/s\/[A-Za-z0-9_-]{20,}$/);

    const anon = await pwRequest.newContext({ baseURL: test.info().project.use.baseURL });
    const pageRes = await anon.get(shareUrl);
    expect(pageRes.status()).toBe(200);
    expect(await pageRes.text()).toContain(title);
    const dl = await anon.get(`${shareUrl}/file`, { maxRedirects: 0 });
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-type"]).toBe("application/pdf");
    expect(Buffer.from(await dl.body()).equals(v2)).toBe(true);

    await page.reload();
    await page.getByRole("button", { name: "ألغِ الرابط" }).first().click();
    await expect(page.getByText("ملغى").first()).toBeVisible();

    const after = await anon.get(`${shareUrl}/file`, { maxRedirects: 0 });
    expect(after.status()).toBe(303);
    expect(await (await anon.get(shareUrl)).text()).toContain("أُلغي هذا الرابط");
    await anon.dispose();

    // the access log recorded the anonymous download
    await page.reload();
    await expect(page.getByText("زائر عبر رابط مشاركة").first()).toBeVisible();
  });

  test("screenshots", async ({ browser, viewport }, info) => {
    mkdirSync(shotsDir, { recursive: true });
    const page = await sessionPage(browser, "nazir", viewport);
    await page.goto(`/app/w/${W()}/documents`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${shotsDir}/docs-list-${info.project.name}.png`, fullPage: true });
    await page.goto(`/app/w/${W()}/documents/${docId}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${shotsDir}/docs-detail-${info.project.name}.png`, fullPage: true });
    const anon = await page.context().browser()!.newContext({ viewport: page.viewportSize()! });
    const p2 = await anon.newPage();
    await p2.goto("/s/invalid-token-for-screenshot-000000");
    await p2.screenshot({ path: `${shotsDir}/docs-share-invalid-${info.project.name}.png` });
    await anon.close();
  });
});
