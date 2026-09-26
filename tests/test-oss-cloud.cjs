/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createOssArchiveClient, validateOssConfig, signV4 } = require('../work/mac-app/asar-src/oss-cloud');

const config = {
  region: 'cn-hangzhou', bucket: 'wenjian-private', prefix: 'my-notes/',
  accessKeyId: 'TESTKEY1234', accessKeySecret: 'private-test-secret'
};

function fakeOss() {
  const objects = new Map();
  const uploads = new Map();
  let nextUpload = 1;
  let aborted = 0;
  let failPart = false;
  let transientPartFailures = 0;
  let corruptDownload = false;
  const transport = async ({ method, requestPath, headers, body, downloadPath, onProgress }) => {
    assert.match(headers.authorization, /^OSS4-HMAC-SHA256 Credential=TESTKEY1234\//);
    assert.doesNotMatch(headers.authorization, /private-test-secret/);
    const url = new URL(`https://wenjian-private.oss-cn-hangzhou.aliyuncs.com${requestPath}`);
    const key = decodeURIComponent(url.pathname.slice(1));
    if (method === 'POST' && url.searchParams.has('uploads')) {
      const id = `UP${nextUpload++}`;
      uploads.set(id, { key, parts: new Map(), headers });
      return { statusCode: 200, headers: {}, body: `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>` };
    }
    if (method === 'PUT' && url.searchParams.has('partNumber')) {
      if (failPart && url.searchParams.get('partNumber') === '2') return { statusCode: 403, headers: {}, body: '' };
      if (transientPartFailures > 0 && url.searchParams.get('partNumber') === '2') {
        transientPartFailures -= 1;
        return { statusCode: 503, headers: {}, body: '' };
      }
      const upload = uploads.get(url.searchParams.get('uploadId'));
      assert.ok(upload);
      assert.equal(crypto.createHash('md5').update(body).digest('base64'), headers['content-md5']);
      upload.parts.set(Number(url.searchParams.get('partNumber')), body);
      return { statusCode: 200, headers: { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"` }, body: '' };
    }
    if (method === 'POST' && url.searchParams.has('uploadId')) {
      const id = url.searchParams.get('uploadId');
      const upload = uploads.get(id);
      assert.ok(upload);
      assert.equal(headers['x-oss-object-acl'], 'private');
      assert.equal(headers['x-oss-forbid-overwrite'], 'true');
      assert.match(body.toString(), /<CompleteMultipartUpload>/);
      const data = Buffer.concat([...upload.parts.entries()].sort(([a], [b]) => a - b).map(([, bytes]) => bytes));
      if (objects.has(key)) return { statusCode: 409, headers: {}, body: '' };
      const modified = new Date(Date.UTC(2026, 8, 25, 10, 0, objects.size));
      objects.set(key, { data, modified, sha256: upload.headers['x-oss-meta-wenjian-sha256'], size: upload.headers['x-oss-meta-wenjian-size'] });
      uploads.delete(id);
      return { statusCode: 200, headers: {}, body: '<CompleteMultipartUploadResult><ETag>combined</ETag></CompleteMultipartUploadResult>' };
    }
    if (method === 'DELETE' && url.searchParams.has('uploadId')) {
      aborted += 1;
      uploads.delete(url.searchParams.get('uploadId'));
      return { statusCode: 204, headers: {}, body: '' };
    }
    if (method === 'HEAD') {
      const object = objects.get(key);
      if (!object) return { statusCode: 404, headers: {}, body: '' };
      return { statusCode: 200, headers: {
        'content-length': String(object.data.length), 'x-oss-meta-wenjian-sha256': object.sha256,
        'x-oss-meta-wenjian-size': object.size, 'last-modified': object.modified.toUTCString()
      }, body: '' };
    }
    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const keys = [...objects.keys()].filter((item) => item.startsWith(url.searchParams.get('prefix'))).sort();
      const start = Number(url.searchParams.get('continuation-token') || 0);
      const keyAtPage = keys[start];
      const item = keyAtPage ? objects.get(keyAtPage) : null;
      const encodedKey = keyAtPage ? encodeURIComponent(keyAtPage) : '';
      const contents = item ? `<Contents><Key>${encodedKey}</Key><Size>${item.data.length}</Size><LastModified>${item.modified.toISOString()}</LastModified></Contents>` : '';
      const truncated = start + 1 < keys.length;
      return { statusCode: 200, headers: {}, body: `<ListBucketResult><EncodingType>url</EncodingType>${contents}<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + 1}</NextContinuationToken>` : ''}</ListBucketResult>` };
    }
    if (method === 'GET') {
      const object = objects.get(key);
      if (!object) return { statusCode: 404, headers: {}, body: '' };
      const data = Buffer.from(object.data);
      if (corruptDownload) data[data.length - 1] ^= 1;
      await fs.writeFile(downloadPath, data, { flag: 'wx', mode: 0o600 });
      onProgress?.({ transferred: data.length, total: data.length });
      return { statusCode: 200, headers: {}, body: '', download: { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') } };
    }
    throw new Error('Unexpected fake OSS request');
  };
  return { transport, objects, uploads, get aborted() { return aborted; }, set failPart(value) { failPart = value; },
    set transientPartFailures(value) { transientPartFailures = value; }, set corruptDownload(value) { corruptDownload = value; } };
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wenjian-oss-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'source.wenjian-backup');
  const data = Buffer.concat([Buffer.from('WENJIAN_BACKUP_V1\n'), crypto.randomBytes(300 * 1024)]);
  await fs.writeFile(filePath, data);
  return { dir, filePath, data };
}

test('validates region-matched HTTPS OSS config without exposing credentials in errors', () => {
  const normalized = validateOssConfig(config);
  assert.equal(normalized.endpoint, 'https://oss-cn-hangzhou.aliyuncs.com');
  assert.equal(normalized.prefix, 'my-notes/');
  assert.throws(() => validateOssConfig({ ...config, endpoint: 'https://evil.example' }), /阿里云 HTTPS/);
  assert.throws(() => validateOssConfig({ ...config, prefix: '../other/' }), /目录前缀/);
  assert.throws(() => validateOssConfig({ ...config, accessKeySecret: 'bad\nsecret' }), (error) => !error.message.includes('bad'));
});

test('V4 header signature uses canonicalized OSS bucket path and scoped credential', () => {
  const authorization = signV4({
    method: 'PUT', bucket: 'examplebucket', key: 'exampleobject', query: {}, region: 'cn-hangzhou',
    accessKeyId: 'TESTKEY1234', accessKeySecret: 'yourAccessKeySecret', timestamp: '20250411T064124Z',
    headers: {
      'content-disposition': 'attachment', 'content-length': '3', 'content-md5': 'ICy5YqxZB1uWSwcVLSNLcA==',
      'content-type': 'text/plain', 'x-oss-content-sha256': 'UNSIGNED-PAYLOAD', 'x-oss-date': '20250411T064124Z'
    }
  });
  assert.equal(authorization, 'OSS4-HMAC-SHA256 Credential=TESTKEY1234/20250411/cn-hangzhou/oss/aliyun_v4_request,AdditionalHeaders=content-disposition;content-length,Signature=d3694c2dfc5371ee6acd35e88c4871ac95a7ba01d3a2f476768fe61218590097');
});

test('multipart upload creates private immutable snapshots, lists by server time, downloads verified copy', async (t) => {
  const { dir, filePath, data } = await fixture(t);
  const fake = fakeOss();
  const client = createOssArchiveClient(config, { transport: fake.transport, partSize: 128 * 1024 });
  const events = [];
  const first = await client.uploadSnapshot({ filePath, onProgress: (event) => events.push(event) });
  const second = await client.uploadSnapshot({ filePath });
  assert.notEqual(first.key, second.key);
  assert.equal(first.size, data.length);
  assert.equal(first.sha256, crypto.createHash('sha256').update(data).digest('hex'));
  assert.deepEqual(events.at(-1), { transferred: data.length, total: data.length });
  const list = await client.listSnapshots();
  assert.deepEqual(list.map((item) => item.key), [second.key, first.key]);
  assert.equal(list[0].createdAt, '2026-09-25T10:00:01.000Z');
  const destination = path.join(dir, 'restored.wenjian-backup');
  const saved = await client.downloadSnapshot({ key: first.key, destination });
  assert.equal(saved.sha256, first.sha256);
  assert.deepEqual(await fs.readFile(destination), data);
});

test('corrupt download is rejected and temp files are removed', async (t) => {
  const { dir, filePath } = await fixture(t);
  const fake = fakeOss();
  const client = createOssArchiveClient(config, { transport: fake.transport, partSize: 128 * 1024 });
  const snapshot = await client.uploadSnapshot({ filePath });
  fake.corruptDownload = true;
  const destination = path.join(dir, 'corrupt.wenjian-backup');
  await assert.rejects(client.downloadSnapshot({ key: snapshot.key, destination }), /校验失败/);
  const names = await fs.readdir(dir);
  assert.ok(!names.some((name) => name.includes('partial-')));
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('download never overwrites an existing local backup', async (t) => {
  const { dir, filePath } = await fixture(t);
  const fake = fakeOss();
  const client = createOssArchiveClient(config, { transport: fake.transport, partSize: 128 * 1024 });
  const snapshot = await client.uploadSnapshot({ filePath });
  const destination = path.join(dir, 'existing.wenjian-backup');
  await fs.writeFile(destination, 'original backup');
  await assert.rejects(client.downloadSnapshot({ key: snapshot.key, destination }), /已有同名备份/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'original backup');
  assert.ok(!(await fs.readdir(dir)).some((name) => name.includes('partial-')));
});

test('part failure reports safe status and aborts incomplete upload', async (t) => {
  const { filePath } = await fixture(t);
  const fake = fakeOss();
  fake.failPart = true;
  const client = createOssArchiveClient(config, { transport: fake.transport, partSize: 128 * 1024 });
  await assert.rejects(client.uploadSnapshot({ filePath }), (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /OSS 拒绝访问/);
    assert.doesNotMatch(error.message, /private-test-secret|TESTKEY1234/);
    return true;
  });
  assert.equal(fake.aborted, 1);
  assert.equal(fake.uploads.size, 0);
  assert.equal(fake.objects.size, 0);
});

test('temporary OSS part failure retries without abandoning the snapshot', async (t) => {
  const { filePath } = await fixture(t);
  const fake = fakeOss();
  fake.transientPartFailures = 1;
  const client = createOssArchiveClient(config, { transport: fake.transport, partSize: 128 * 1024 });
  const snapshot = await client.uploadSnapshot({ filePath });
  assert.ok(fake.objects.has(snapshot.key));
  assert.equal(fake.aborted, 0);
});

test('metadata request deadline aborts a stalled connection before transfer timeout', async () => {
  let aborted = false;
  let providedTimeout = null;
  const transport = ({ signal, timeoutMs }) => {
    providedTimeout = timeoutMs;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('stalled request aborted'));
      }, { once: true });
    });
  };
  const client = createOssArchiveClient(config, { transport, metadataTimeoutMs: 25 });
  const started = Date.now();
  await assert.rejects(client.listSnapshots({ limit: 1 }), (error) => {
    assert.equal(error.code, 'ETIMEDOUT');
    assert.equal(error.retryable, false);
    assert.match(error.message, /连接超时/);
    return true;
  });
  assert.equal(providedTimeout, 25);
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 500);
});

test('snapshot HEAD uses the same short deadline', async () => {
  let method;
  const client = createOssArchiveClient(config, {
    metadataTimeoutMs: 20,
    transport: ({ method: requestMethod, signal }) => {
      method = requestMethod;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
  });
  const key = `my-notes/snapshots/20260925T100000Z-00000000-0000-4000-8000-000000000000-${'a'.repeat(64)}.wenjian-backup`;
  await assert.rejects(client.downloadSnapshot({ key, destination: path.join(os.tmpdir(), 'never-created.wenjian-backup') }), /连接超时/);
  assert.equal(method, 'HEAD');
});
