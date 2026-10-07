/**
 * Blob storage for the document vault. Blobs are always written already encrypted (AES-256-GCM,
 * see modules/documents/service.ts), so a storage provider never sees plaintext.
 *
 * Providers (process.env.STORAGE_PROVIDER):
 *  - "local" (default): files under env.STORAGE_DIR/blobs/<key>.
 *  - "s3": S3-compatible object storage. Reads S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID,
 *          S3_SECRET_ACCESS_KEY. Not wired yet (no SDK in the dependency set): it fails loudly.
 *
 * Keys look like `w/<waqfId>/<uuid>` for waqf documents and `u/<userId>/<uuid>` for personal / request docs.
 */
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../env";

export interface StorageAdapter {
  readonly name: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-z]\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/** Validates a storage key so that it can never escape the storage root. */
export function assertKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error(`invalid storage key: ${key}`);
}

export function newStorageKey(scope: { waqfId?: string | null; userId: string }) {
  return scope.waqfId ? `w/${scope.waqfId}/${randomUUID()}` : `u/${scope.userId}/${randomUUID()}`;
}

export class LocalDiskStorage implements StorageAdapter {
  readonly name = "local";
  private root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir, "blobs");
  }
  pathFor(key: string) {
    assertKey(key);
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("storage path escapes root");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.pathFor(key);
    await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, p); // atomic publish
  }
  async get(key: string) {
    return readFile(this.pathFor(key));
  }
  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}

export class S3Storage implements StorageAdapter {
  readonly name = "s3";
  private cfg = {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  };
  private fail(): never {
    const missing = Object.entries(this.cfg).filter(([, v]) => !v).map(([k]) => k);
    throw new Error(
      `S3 storage is not configured${missing.length ? ` (missing: ${missing.join(", ")})` : ""}: the S3 client is not implemented yet. ` +
        "Unset STORAGE_PROVIDER to use local disk, or implement S3Storage with a signed-request client.",
    );
  }
  async put(_key: string, _data: Buffer): Promise<void> {
    this.fail();
  }
  async get(_key: string): Promise<Buffer> {
    this.fail();
  }
  async delete(_key: string): Promise<void> {
    this.fail();
  }
}

let instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (instance) return instance;
  instance = process.env.STORAGE_PROVIDER === "s3" ? new S3Storage() : new LocalDiskStorage(env.STORAGE_DIR);
  return instance;
}
