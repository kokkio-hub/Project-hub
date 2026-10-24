import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { Attachment } from '../src/shared/types.js';
import { migrate } from '../src/server/db/index.js';
import { migrations } from '../src/server/db/migrations.js';
import { signRequest } from '../src/server/lib/s3.js';
import { addPerson, createProject, createTask, makeApp, setupAdmin, type Client } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function upload(agent: Client, taskId: number, name: string, body: Buffer) {
  return agent
    .post(`/api/tasks/${taskId}/attachments`)
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', encodeURIComponent(name))
    .send(body);
}

describe('attachments', () => {
  it('uploads, lists, downloads and removes files', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const task = await createTask(admin, p.id);

    const image = (await upload(admin, task.id, 'screenshot.png', PNG).expect(201)).body.attachment as Attachment;
    expect(image).toMatchObject({ filename: 'screenshot.png', mimeType: 'image/png', size: PNG.length, isImage: true });
    const doc = (await upload(admin, task.id, 'Offerte – €2.500.pdf', Buffer.from('%PDF-1.4 test')).expect(201)).body
      .attachment as Attachment;
    expect(doc).toMatchObject({ filename: 'Offerte – €2.500.pdf', isImage: false });
    expect((await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task.attachmentCount).toBe(2);

    const inline = await admin.get(`/api/attachments/${image.id}/file`).buffer(true).expect(200);
    expect(inline.headers['content-type']).toBe('image/png');
    expect(inline.headers['content-disposition']).toMatch(/^inline/);
    expect(inline.headers['content-security-policy']).toContain('sandbox');
    const download = await admin.get(`/api/attachments/${doc.id}/file`).buffer(true).expect(200);
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(download.headers['content-disposition']).toContain("filename*=UTF-8''Offerte%20%E2%80%93%20%E2%82%AC2.500.pdf");

    const files = fs.readdirSync(t.config.attachmentsDir);
    expect(files).toHaveLength(2);
    await admin.delete(`/api/attachments/${doc.id}`).expect(204);
    expect(fs.readdirSync(t.config.attachmentsDir)).toHaveLength(1);
    expect((await admin.get(`/api/tasks/${task.id}/attachments`).expect(200)).body.attachments).toHaveLength(1);
  });

  it('never shows a file inline just because it is called .png', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const task = await createTask(admin, p.id);
    const fake = (await upload(admin, task.id, 'evil.png', Buffer.from('<script>alert(1)</script>')).expect(201)).body.attachment;
    expect(fake.isImage).toBe(false);
    const svg = (await upload(admin, task.id, 'logo.svg', Buffer.from('<svg onload="alert(1)"/>')).expect(201)).body.attachment;
    const res = await admin.get(`/api/attachments/${svg.id}/file`).expect(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('refuses files that are too big, and guests can look but not upload', async () => {
    const t = makeApp({ maxUploadBytes: 100 });
    const { admin } = await setupAdmin(t);
    const { agent: guest, user: guestUser } = await addPerson(t, admin, 'Gina Guest', 'guest');
    const { agent: outsider } = await addPerson(t, admin, 'Otto Outsider');
    const p = await createProject(admin, { visibility: 'private' });
    await admin.put(`/api/projects/${p.id}/members`).send({ userIds: [guestUser.id] }).expect(200);
    const task = await createTask(admin, p.id);
    await upload(admin, task.id, 'big.bin', Buffer.alloc(500)).expect(413);
    expect(fs.readdirSync(t.config.attachmentsDir)).toHaveLength(0);

    const small = (await upload(admin, task.id, 'small.txt', Buffer.from('hello')).expect(201)).body.attachment;
    await upload(guest, task.id, 'mine.txt', Buffer.from('hi')).expect(403);
    await guest.get(`/api/attachments/${small.id}/file`).expect(200);
    await guest.delete(`/api/attachments/${small.id}`).expect(403);
    await outsider.get(`/api/attachments/${small.id}/file`).expect(404);
  });

  it('removes files from disk when a task is emptied from the trash', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const task = await createTask(admin, p.id);
    await upload(admin, task.id, 'a.txt', Buffer.from('a')).expect(201);
    await admin.delete(`/api/tasks/${task.id}`).expect(204);
    expect(fs.readdirSync(t.config.attachmentsDir)).toHaveLength(1);
    await admin.delete('/api/trash').expect(204);
    expect(fs.readdirSync(t.config.attachmentsDir)).toHaveLength(0);
  });
});

describe('S3 request signing', () => {
  it('matches the AWS Signature Version 4 example', () => {
    // From the Amazon S3 documentation, "Example: GET Object".
    const headers = signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      date: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

/** A pretend S3 bucket, reached through the fetch the backup client uses. */
function fakeBucket() {
  const objects = new Map<string, { body: Buffer; modified: string }>();
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url.host}${url.pathname}${url.search}`);
    const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
    if (!auth.startsWith('AWS4-HMAC-SHA256 Credential=key-id/')) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    const key = decodeURIComponent(url.pathname.slice(1));
    if (method === 'PUT') {
      objects.set(key, { body: Buffer.from(init!.body as Uint8Array), modified: new Date().toISOString() });
      return new Response('', { status: 200 });
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const items = [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>${v.modified}</LastModified><Size>${v.body.length}</Size></Contents>`)
        .join('');
      return new Response(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`, { status: 200 });
    }
    const found = objects.get(key);
    return found ? new Response(new Uint8Array(found.body), { status: 200 }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
  }) as typeof fetch;
  return { objects, requests, fetch: fetchImpl };
}

describe('off-site backups', () => {
  const backup = {
    endpoint: 'https://t3.storageapi.dev',
    bucket: 'my-bucket',
    region: 'auto',
    accessKeyId: 'key-id',
    secretAccessKey: 'secret',
    prefix: 'project-hub/',
    pathStyle: false,
  };

  it('uploads a compressed copy of the database and new attachments, and prunes old copies', async () => {
    const bucket = fakeBucket();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-hub-backup-'));
    const t = makeApp({ backup, databasePath: path.join(dir, 'project-hub.db') }, { backupFetch: bucket.fetch });
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin, { name: 'Backed up' });
    const task = await createTask(admin, p.id);
    await upload(admin, task.id, 'shot.png', PNG).expect(201);

    // Three-month-old copies beyond the newest seven get removed.
    for (let i = 0; i < 9; i++) {
      bucket.objects.set(`project-hub/database/project-hub-2020-01-0${i + 1}-00-00-00.db.gz`, { body: Buffer.from('old'), modified: '2020-01-01T00:00:00Z' });
    }

    expect((await admin.get('/api/admin/status').expect(200)).body.backup).toMatchObject({ configured: true, target: 'my-bucket at t3.storageapi.dev', lastSuccessAt: null });
    const result = await t.ctx.backups.run();
    expect(result.attachments).toBe(1);
    expect(result.removed).toBe(3);
    expect(bucket.requests[0]).toMatch(/^PUT my-bucket\.t3\.storageapi\.dev\/project-hub\/database\/project-hub-.*\.db\.gz$/);

    const copy = bucket.objects.get(result.key)!;
    const restoredFile = path.join(dir, 'restored.db');
    fs.writeFileSync(restoredFile, gunzipSync(copy.body));
    const restored = new Database(restoredFile, { readonly: true });
    expect(restored.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'Backed up' }]);
    restored.close();

    expect([...bucket.objects.keys()].filter((k) => k.includes('/attachments/'))).toHaveLength(1);
    const status = (await admin.get('/api/admin/status').expect(200)).body.backup;
    expect(status).toMatchObject({ lastFile: result.key, lastError: null });

    // Attachments are uploaded only once.
    const again = await t.ctx.backups.run();
    expect(again.attachments).toBe(0);
    expect(t.ctx.backups.isDue(new Date())).toBe(false);
  });

  it('records why a backup failed', async () => {
    const bucket = fakeBucket();
    const t = makeApp({ backup: { ...backup, accessKeyId: 'wrong' } }, { backupFetch: bucket.fetch });
    const { admin } = await setupAdmin(t);
    await expect(t.ctx.backups.run()).rejects.toThrow(/AccessDenied/);
    const status = (await admin.get('/api/admin/status').expect(200)).body.backup;
    expect(status.lastError).toMatch(/refused the request \(403 AccessDenied\)/);
  });

  it('is only available to admins, and explains when it isn’t set up', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: member } = await addPerson(t, admin, 'Mia Member');
    await member.get('/api/admin/status').expect(403);
    expect((await admin.get('/api/admin/status').expect(200)).body.backup.configured).toBe(false);
    await admin.post('/api/admin/backup').expect(400);
  });
});

describe('database upgrade', () => {
  it('upgrades an existing database, keeps its data and saves a copy first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-hub-upgrade-'));
    const db = new Database(path.join(dir, 'project-hub.db'));
    db.pragma('foreign_keys = ON');
    for (let i = 0; i < 2; i++) {
      db.exec(migrations[i] as string);
      db.pragma(`user_version = ${i + 1}`);
    }
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (email, name, password_hash, role, created_at, updated_at) VALUES ('a@x.com', 'A', 'h', 'admin', ?, ?)").run(now, now);
    db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('s', 1, ?, ?, ?)").run(now, now, now);
    db.prepare("INSERT INTO projects (name, owner_id, created_by, created_at, updated_at) VALUES ('P', 1, 1, ?, ?)").run(now, now);
    db.prepare("INSERT INTO tasks (project_id, title, status, assignee_id, created_by, created_at, updated_at) VALUES (1, 'T', 'review', 1, 1, ?, ?)").run(now, now);

    migrate(db, { backupDir: path.join(dir, 'backups') });

    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
    const task = db.prepare('SELECT t.status, c.name, c.stage FROM tasks t JOIN project_columns c ON c.id = t.column_id').get();
    expect(task).toEqual({ status: 'review', name: 'In review', stage: 'review' });
    expect(fs.readdirSync(path.join(dir, 'backups'))).toEqual([expect.stringMatching(/^before-upgrade-v2-.*\.db$/)]);
    // References still work after the users table was rebuilt.
    db.prepare('DELETE FROM users WHERE id = 1').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT assignee_id FROM tasks').get()).toEqual({ assignee_id: null });
    db.close();
  });
});
