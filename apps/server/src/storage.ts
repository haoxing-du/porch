import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Config } from './config';
export class Storage {
  private s3?: S3Client;
  constructor(private cfg: Config) {
    if (cfg.s3)
      this.s3 = new S3Client({
        region: cfg.s3.region,
        endpoint: cfg.s3.endpoint,
        forcePathStyle: !!cfg.s3.endpoint,
      });
  }
  async put(key: string, data: Buffer) {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.cfg.s3!.bucket,
          Key: key,
          Body: data,
          ContentType: 'application/octet-stream',
        }),
      );
      return;
    }
    await mkdir(this.cfg.uploadDir, { recursive: true });
    await writeFile(join(this.cfg.uploadDir, key), data, { flag: 'wx', mode: 0o600 });
  }
  async get(key: string) {
    if (this.s3) {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.cfg.s3!.bucket, Key: key }),
      );
      if (!result.Body) throw new Error('Stored attachment is missing.');
      return Buffer.from(await result.Body.transformToByteArray());
    }
    return readFile(join(this.cfg.uploadDir, key));
  }
  async remove(key: string) {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.s3!.bucket, Key: key }));
      return;
    }
    await unlink(join(this.cfg.uploadDir, key));
  }
}
