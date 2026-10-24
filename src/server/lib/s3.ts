import { createHash, createHmac } from 'node:crypto';
import type { BackupConfig } from '../config.js';

/**
 * A minimal client for S3-compatible storage (Railway buckets, Cloudflare R2,
 * Backblaze B2, AWS S3, MinIO...): put, get, delete and list objects, signed
 * with AWS Signature Version 4. No SDK needed.
 */

export class S3Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'S3Error';
  }
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, as SigV4 requires ("/" kept in paths). */
export function uriEncode(value: string, keepSlash = false): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, keepSlash ? '/' : '%2F');
}

export interface SignInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Defaults to now. */
  date?: Date;
}

/** Returns the headers to send, including Authorization. */
export function signRequest(input: SignInput): Record<string, string> {
  const date = input.date ?? new Date();
  const amzDate = date.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...input.headers,
    host: input.url.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map((h) => `${h}:${String(lower[h]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = input.url.pathname
    .split('/')
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join('/');
  const canonicalRequest = [input.method, path || '/', query, canonicalHeaders, signedHeaders, input.payloadHash].join('\n');
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export interface ListedObject {
  key: string;
  size: number;
  lastModified: string;
}

function xmlValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => decodeXml(m[1]!));
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface S3ClientOptions {
  fetch?: typeof fetch;
}

export class S3Client {
  private readonly doFetch: typeof fetch;

  constructor(
    readonly config: BackupConfig,
    options: S3ClientOptions = {},
  ) {
    this.doFetch = options.fetch ?? fetch;
  }

  /** "bucket at host", for messages. */
  get description(): string {
    return `${this.config.bucket} at ${new URL(this.config.endpoint).host}`;
  }

  private urlFor(key: string, query: Record<string, string> = {}): URL {
    const endpoint = new URL(this.config.endpoint);
    const encodedKey = key.split('/').map((s) => uriEncode(s)).join('/');
    const url = this.config.pathStyle
      ? new URL(`${endpoint.origin}/${this.config.bucket}/${encodedKey}`)
      : new URL(`${endpoint.protocol}//${this.config.bucket}.${endpoint.host}/${encodedKey}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url;
  }

  private async request(method: string, url: URL, body?: Buffer, headers: Record<string, string> = {}): Promise<Response> {
    const payloadHash = sha256(body ?? '');
    const signed = signRequest({
      method,
      url,
      // fetch adds Host and Content-Length itself; only Host has to be signed.
      headers,
      payloadHash,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
    });
    delete signed.host;
    let response: Response;
    try {
      response = await this.doFetch(url, {
        method,
        headers: signed,
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(5 * 60_000),
      });
    } catch (error) {
      throw new S3Error(`Couldn't reach the backup bucket at ${url.host}: ${error instanceof Error ? error.message : String(error)}`, 0);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const code = xmlValues(text, 'Code')[0];
      const message = xmlValues(text, 'Message')[0];
      throw new S3Error(
        `The backup bucket refused the request (${response.status}${code ? ` ${code}` : ''})${message ? `: ${message}` : '.'}`,
        response.status,
      );
    }
    return response;
  }

  async put(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const response = await this.request('PUT', this.urlFor(key), body, { 'content-type': contentType });
    await response.arrayBuffer();
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.request('GET', this.urlFor(key));
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', this.urlFor(key));
    await response.arrayBuffer();
  }

  /** Every object whose key starts with `prefix`. */
  async list(prefix: string): Promise<ListedObject[]> {
    const objects: ListedObject[] = [];
    let token: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const query: Record<string, string> = { 'list-type': '2', prefix };
      if (token) query['continuation-token'] = token;
      const response = await this.request('GET', this.urlFor('', query));
      const xml = await response.text();
      for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
        objects.push({
          key: xmlValues(block, 'Key')[0] ?? '',
          size: Number(xmlValues(block, 'Size')[0] ?? 0),
          lastModified: xmlValues(block, 'LastModified')[0] ?? '',
        });
      }
      const truncated = xmlValues(xml, 'IsTruncated')[0] === 'true';
      token = xmlValues(xml, 'NextContinuationToken')[0];
      if (!truncated || !token) break;
    }
    return objects;
  }
}
