import 'dotenv/config';
import { resolve } from 'node:path';
import { z } from 'zod';
export interface Config {
  databaseUrl: string;
  origin: string;
  production: boolean;
  devAuth: boolean;
  uploadDir: string;
  port: number;
  host: string;
  githubId?: string;
  githubSecret?: string;
  maxFileBytes: number;
  maxMessageChars: number;
  s3?: { bucket: string; endpoint?: string; region: string };
}
export function config(): Config {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
  const devAuth = process.env.DEV_AUTH === 'true';
  const host = process.env.HOST ?? '127.0.0.1';
  if (
    devAuth &&
    (production ||
      !['localhost', '127.0.0.1'].includes(new URL(origin).hostname) ||
      !['127.0.0.1', 'localhost', '::1'].includes(host))
  )
    throw new Error('Development sign-in requires a local, non-production server.');
  if (
    production &&
    (!process.env.GITHUB_CLIENT_ID ||
      !process.env.GITHUB_CLIENT_SECRET ||
      !origin.startsWith('https://'))
  )
    throw new Error('Production requires HTTPS and GitHub OAuth credentials.');
  return {
    databaseUrl: z.string().min(1).parse(process.env.DATABASE_URL),
    origin,
    production,
    devAuth,
    host,
    port: Number(process.env.PORT ?? 3001),
    uploadDir: resolve(process.env.UPLOAD_DIR ?? '.local/uploads'),
    githubId: process.env.GITHUB_CLIENT_ID,
    githubSecret: process.env.GITHUB_CLIENT_SECRET,
    maxFileBytes: Number(process.env.MAX_FILE_BYTES ?? 20971520),
    maxMessageChars: Number(process.env.MAX_MESSAGE_CHARS ?? 8000),
    ...(process.env.S3_BUCKET
      ? {
          s3: {
            bucket: process.env.S3_BUCKET,
            endpoint: process.env.S3_ENDPOINT,
            region: process.env.AWS_REGION ?? 'us-east-1',
          },
        }
      : {}),
  };
}
