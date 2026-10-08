/**
 * Blob storage for the document vault. Blobs are always written already encrypted (AES-256-GCM,
 * see modules/documents/service.ts), so a storage provider never sees plaintext.
 *
 * Providers (process.env.STORAGE_PROVIDER):
 *  - "local" (default): files under env.STORAGE_DIR/blobs/<key>.
 *  - "s3": S3-compatible object storage. Reads S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID,
 *          S3_SECRET_ACCESS_KEY (AWS S3, Cloudflare R2, MinIO or any S3-compatible provider).
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

/** S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, or a Saudi-region provider). Objects are already AES-GCM encrypted. */
export class S3Storage implements StorageAdapter {
  readonly name = "s3";
  private clientP: Promise<{ c: import("@aws-sdk/client-s3").S3Client; m: typeof import("@aws-sdk/client-s3") }> | null = null;
  private get bucket() {
    if (!env.S3_BUCKET) throw new Error("S3_BUCKET is not set");
    return env.S3_BUCKET;
  }
  private client() {
    this.clientP ??= import("@aws-sdk/client-s3").then((m) => {
      if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) throw new Error("S3 credentials are not set");
      const c = new m.S3Client({
        region: env.S3_REGION ?? "auto",
        endpoint: env.S3_ENDPOINT || undefined,
        forcePathStyle: !!env.S3_ENDPOINT,
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      });
      return { c, m };
    });
    return this.clientP;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const { c, m } = await this.client();
    await c.send(new m.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: "application/octet-stream", ServerSideEncryption: env.S3_ENDPOINT ? undefined : "AES256" }));
  }
  async get(key: string): Promise<Buffer> {
    const { c, m } = await this.client();
    const r = await c.send(new m.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    const { c, m } = await this.client();
    await c.send(new m.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (instance) return instance;
  instance = env.STORAGE_PROVIDER === "s3" ? new S3Storage() : new LocalDiskStorage(env.STORAGE_DIR);
  return instance;
}
