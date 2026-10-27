import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

// Almacenamiento de objetos PRIVADO (S3 compatible; local VersityGW, ADR-0001).
// - Sin URLs públicas ni firmadas: la API lee el objeto y lo entrega solo tras autorizar (la clave de
//   objeto no concede acceso). El bucket no tiene política pública.
// - No hay transacción entre S3 y PostgreSQL: los llamadores siguen staging + compensación (ver
//   geometry-imports.ts) y un barrido elimina objetos sin fila.

export interface ObjectStoreConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; lastModified: Date | null }>>;
  close(): void;
}

export const OBJECT_STORE = Symbol('OBJECT_STORE');

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private ready: Promise<void> | null = null;

  constructor(private readonly cfg: ObjectStoreConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Crea el bucket privado si no existe (una vez por proceso). */
  private ensureBucket() {
    this.ready ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
      }
    })().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  /** Libera los sockets del cliente (cierre ordenado de la API y de los scripts). */
  close() {
    this.client.destroy();
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    await this.ensureBucket();
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async exists(key: string) {
    await this.ensureBucket();
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw e;
    }
  }

  async delete(key: string) {
    await this.ensureBucket();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async list(prefix: string) {
    await this.ensureBucket();
    const keys: Array<{ key: string; lastModified: Date | null }> = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) keys.push({ key: o.Key, lastModified: o.LastModified ?? null });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}
