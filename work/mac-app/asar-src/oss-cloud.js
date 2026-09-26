const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const BACKUP_MAGIC = Buffer.from('WENJIAN_BACKUP_V1\n', 'ascii');
const DEFAULT_PREFIX = 'wenjian/';
const DEFAULT_PART_SIZE = 16 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 15 * 1000;
const TRANSFER_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PARTS = 10000;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SNAPSHOT_NAME = /^(\d{8}T\d{6}Z)-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([a-f0-9]{64})\.wenjian-backup$/;

function validateOssConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请填写 OSS 设置。');
  const region = input.region;
  const bucket = input.bucket;
  if (typeof region !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(region)) throw new Error('OSS 地域格式不正确。');
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('OSS 存储桶名称格式不正确。');
  const expectedEndpoint = `https://oss-${region}.aliyuncs.com`;
  const suppliedEndpoint = input.endpoint || expectedEndpoint;
  if (typeof suppliedEndpoint !== 'string') throw new Error('OSS 公网地址格式不正确。');
  let endpoint;
  try { endpoint = new URL(suppliedEndpoint.includes('://') ? suppliedEndpoint : `https://${suppliedEndpoint}`); }
  catch { throw new Error('OSS 公网地址格式不正确。'); }
  if (endpoint.protocol !== 'https:' || endpoint.origin !== expectedEndpoint || endpoint.pathname !== '/' ||
      endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw new Error('请使用与 OSS 地域一致的阿里云 HTTPS 公网地址。');
  }
  const rawPrefix = input.prefix === undefined || input.prefix === null || input.prefix === '' ? DEFAULT_PREFIX : input.prefix;
  if (typeof rawPrefix !== 'string' || rawPrefix.length > 500 || rawPrefix.startsWith('/') ||
      /[\x00-\x1f\x7f?#\\]/.test(rawPrefix) || rawPrefix.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('OSS 目录前缀格式不正确。');
  }
  const prefix = `${rawPrefix.replace(/\/+$/, '')}/`;
  if (prefix.includes('//')) throw new Error('OSS 目录前缀格式不正确。');
  if (typeof input.accessKeyId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.accessKeyId) ||
      typeof input.accessKeySecret !== 'string' || input.accessKeySecret.length < 8 ||
      input.accessKeySecret.length > 256 || /[\r\n]/.test(input.accessKeySecret)) {
    throw new Error('OSS 访问密钥格式不正确。');
  }
  if (input.securityToken !== undefined && (typeof input.securityToken !== 'string' ||
      input.securityToken.length < 1 || input.securityToken.length > 8192 || /[\r\n]/.test(input.securityToken))) {
    throw new Error('OSS 临时凭证格式不正确。');
  }
  return {
    region, bucket, endpoint: expectedEndpoint, prefix,
    accessKeyId: input.accessKeyId, accessKeySecret: input.accessKeySecret,
    ...(input.securityToken ? { securityToken: input.securityToken } : {})
  };
}

function uriEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodedPath(value) {
  return value.split('/').map(uriEncode).join('/');
}

function queryString(query = {}) {
  return Object.entries(query)
    .map(([name, value]) => [uriEncode(name), value === null ? null : uriEncode(String(value))])
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, value]) => value === null ? name : `${name}=${value}`)
    .join('&');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function signV4({ method, bucket, key, query, headers, region, accessKeyId, accessKeySecret, timestamp }) {
  const date = timestamp.slice(0, 8);
  const scope = `${date}/${region}/oss/aliyun_v4_request`;
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()]));
  const additional = Object.keys(normalized).filter((name) => name === 'content-length' || name === 'content-disposition').sort();
  const signedNames = Object.keys(normalized).filter((name) => name.startsWith('x-oss-') ||
    name === 'content-type' || name === 'content-md5' || additional.includes(name)).sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${normalized[name]}\n`).join('');
  const canonicalUri = encodedPath(`/${bucket}/${key || ''}`);
  const canonicalRequest = [method, canonicalUri, queryString(query), canonicalHeaders, additional.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const hashedRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = `OSS4-HMAC-SHA256\n${timestamp}\n${scope}\n${hashedRequest}`;
  const signingKey = hmac(hmac(hmac(hmac(`aliyun_v4${accessKeySecret}`, date), region), 'oss'), 'aliyun_v4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  const extra = additional.length ? `,AdditionalHeaders=${additional.join(';')}` : '';
  return `OSS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}${extra},Signature=${signature}`;
}

function progress(callback, transferred, total) {
  if (typeof callback === 'function') {
    try { callback({ transferred, total }); } catch { /* Progress display must not break an archive. */ }
  }
}

function safeHttpError(status) {
  let message;
  if (status === 403) message = 'OSS 拒绝访问，请检查密钥及存储桶权限。';
  else if (status === 404) message = 'OSS 存储桶或归档不存在。';
  else if (status === 409) message = '云端已存在同名归档，本次上传已取消。';
  else if (status === 400) message = 'OSS 请求无效，请检查地域和存储桶设置。';
  else if (status >= 500) message = 'OSS 服务暂时不可用，请稍后再试。';
  else message = `OSS 请求失败（HTTP ${status}）。`;
  const error = new Error(message);
  error.status = status;
  error.retryable = status === 429 || status >= 500;
  return error;
}

async function retryTransient(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (!error.retryable || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

async function defaultTransport({ method, hostname, requestPath, headers, body, downloadPath, expectedSize, onProgress, signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname, port: 443, method, path: requestPath, headers, signal, timeout: timeoutMs }, async (response) => {
      const statusCode = response.statusCode || 0;
      if (downloadPath && statusCode >= 200 && statusCode < 300) {
        const hash = crypto.createHash('sha256');
        let size = 0;
        const meter = new Transform({
          transform(chunk, encoding, callback) {
            size += chunk.length;
            if (expectedSize !== undefined && size > expectedSize) return callback(new Error('下载文件超过预期大小。'));
            hash.update(chunk);
            progress(onProgress, size, expectedSize ?? size);
            callback(null, chunk);
          }
        });
        try {
          await pipeline(response, meter, fs.createWriteStream(downloadPath, { flags: 'wx', mode: 0o600 }));
          resolve({ statusCode, headers: response.headers, body: Buffer.alloc(0), download: { size, sha256: hash.digest('hex') } });
        } catch (error) { reject(error); }
        return;
      }
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of response) {
          size += chunk.length;
          if (size > MAX_XML_BYTES) throw new Error('OSS 响应过大。');
          chunks.push(chunk);
        }
        resolve({ statusCode, headers: response.headers, body: Buffer.concat(chunks) });
      } catch (error) { reject(error); }
    });
    request.on('timeout', () => {
      const error = new Error('timeout');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(body);
  });
}

function decodeXml(value) {
  return value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi, (match, numeric, named) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === 'x' ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
      return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named.toLowerCase()] || match;
  });
}

function xmlTag(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

function xmlBlocks(xml, tag) {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g');
  return [...xml.matchAll(expression)].map((match) => match[1]);
}

function decodeOssKey(value, encoded) {
  if (!encoded) return value;
  try { return decodeURIComponent(value); } catch { throw new Error('OSS 返回了无法识别的文件名。'); }
}

async function hashHandle(handle, total) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, total));
  let offset = 0;
  while (offset < total) {
    const amount = Math.min(buffer.length, total - offset);
    const { bytesRead } = await handle.read(buffer, 0, amount, offset);
    if (!bytesRead) throw new Error('本地备份文件读取不完整。');
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest('hex');
}

async function readPart(handle, offset, size) {
  const buffer = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const result = await handle.read(buffer, read, size - read, offset + read);
    if (!result.bytesRead) throw new Error('本地备份文件读取不完整。');
    read += result.bytesRead;
  }
  return buffer;
}

function parseSnapshotKey(key, prefix) {
  const directory = `${prefix}snapshots/`;
  if (typeof key !== 'string' || !key.startsWith(directory)) return null;
  const match = SNAPSHOT_NAME.exec(key.slice(directory.length));
  return match ? { sha256: match[3] } : null;
}

function createOssArchiveClient(rawConfig, options = {}) {
  const config = validateOssConfig(rawConfig);
  const hostname = `${config.bucket}.${new URL(config.endpoint).hostname}`;
  const transport = options.transport || defaultTransport;
  const clock = options.clock || (() => new Date());
  const partSize = options.partSize || DEFAULT_PART_SIZE;
  const metadataTimeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS;
  if (!Number.isSafeInteger(partSize) || partSize < 100 * 1024 || partSize > 1024 * 1024 * 1024) {
    throw new Error('OSS 分片大小不正确。');
  }
  if (!Number.isSafeInteger(metadataTimeoutMs) || metadataTimeoutMs < 1 || metadataTimeoutMs > 60000) {
    throw new Error('OSS 信息请求时限不正确。');
  }

  async function send(method, key = '', query = {}, { headers = {}, body, downloadPath, expectedSize, onProgress } = {}) {
    const timestamp = clock().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const signedHeaders = {
      'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-oss-date': timestamp,
      ...headers
    };
    if (config.securityToken) signedHeaders['x-oss-security-token'] = config.securityToken;
    if (body !== undefined) signedHeaders['content-length'] = String(body.length);
    signedHeaders.authorization = signV4({
      method, bucket: config.bucket, key, query, headers: signedHeaders, region: config.region,
      accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret, timestamp
    });
    const queryPart = queryString(query);
    const requestPath = `/${encodedPath(key)}${queryPart ? `?${queryPart}` : ''}`;
    const isMetadata = method === 'HEAD' || (method === 'GET' && !key);
    const controller = isMetadata ? new AbortController() : null;
    const timeoutMs = isMetadata ? metadataTimeoutMs : TRANSFER_IDLE_TIMEOUT_MS;
    let deadlineTimer;
    const deadline = isMetadata ? new Promise((_, reject) => {
      deadlineTimer = setTimeout(() => {
        controller.abort();
        const error = new Error('timeout');
        error.code = 'ETIMEDOUT';
        reject(error);
      }, timeoutMs);
    }) : null;
    let result;
    try {
      const request = transport({ method, hostname, requestPath, headers: signedHeaders, body, downloadPath,
        expectedSize, onProgress, timeoutMs, signal: controller?.signal });
      result = deadline ? await Promise.race([request, deadline]) : await request;
    } catch (cause) {
      const timedOut = controller?.signal.aborted || cause?.code === 'ETIMEDOUT';
      const error = new Error(timedOut ? 'OSS 连接超时，请检查网络或公网地址。' : '无法完成 OSS 连接，请检查网络后重试。');
      if (timedOut) error.code = 'ETIMEDOUT';
      error.retryable = !timedOut;
      throw error;
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
    if (!result || !Number.isInteger(result.statusCode)) throw new Error('OSS 返回了无法识别的响应。');
    if (result.statusCode < 200 || result.statusCode >= 300) throw safeHttpError(result.statusCode);
    return {
      ...result,
      headers: Object.fromEntries(Object.entries(result.headers || {}).map(([name, value]) => [name.toLowerCase(), value])),
      body: Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body || '')
    };
  }

  async function head(key) {
    const result = await retryTransient(() => send('HEAD', key));
    const size = Number(result.headers['content-length']);
    const sha256 = result.headers['x-oss-meta-wenjian-sha256'];
    if (!Number.isSafeInteger(size) || size < 1 || !SHA256.test(sha256 || '')) {
      throw new Error('云端归档缺少完整性信息。');
    }
    const metadataSize = Number(result.headers['x-oss-meta-wenjian-size']);
    if (metadataSize !== size) throw new Error('云端归档大小与清单不一致。');
    const modified = new Date(result.headers['last-modified'] || '');
    if (Number.isNaN(modified.getTime())) throw new Error('云端归档缺少保存时间。');
    return { size, sha256, createdAt: modified.toISOString() };
  }

  async function uploadSnapshot({ filePath, onProgress } = {}) {
    if (typeof filePath !== 'string' || !filePath.endsWith('.wenjian-backup')) throw new Error('请选择问间完整备份文件。');
    const handle = await fsp.open(filePath, 'r');
    let uploadId = null;
    let key = null;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < BACKUP_MAGIC.length + 9) throw new Error('备份文件不完整。');
      if (Math.ceil(stat.size / partSize) > MAX_PARTS) throw new Error('备份文件超过 OSS 分片上传上限。');
      const magic = await readPart(handle, 0, BACKUP_MAGIC.length);
      if (!magic.equals(BACKUP_MAGIC)) throw new Error('不是问间完整备份文件。');
      const sha256 = await hashHandle(handle, stat.size);
      const compactTime = clock().toISOString().replace(/[-:]|\.\d{3}/g, '');
      key = `${config.prefix}snapshots/${compactTime}-${crypto.randomUUID()}-${sha256}.wenjian-backup`;
      const initialized = await send('POST', key, { uploads: null }, {
        headers: {
          'content-type': 'application/octet-stream',
          'x-oss-forbid-overwrite': 'true',
          'x-oss-meta-wenjian-sha256': sha256,
          'x-oss-meta-wenjian-size': String(stat.size)
        }, body: Buffer.alloc(0)
      });
      uploadId = xmlTag(initialized.body.toString('utf8'), 'UploadId');
      if (!uploadId || uploadId.length > 512 || /[\x00-\x1f\x7f]/.test(uploadId)) throw new Error('OSS 未返回有效的上传编号。');
      const uploadedParts = [];
      progress(onProgress, 0, stat.size);
      for (let offset = 0, number = 1; offset < stat.size; offset += partSize, number += 1) {
        const size = Math.min(partSize, stat.size - offset);
        const bytes = await readPart(handle, offset, size);
        const md5 = crypto.createHash('md5').update(bytes).digest();
        const result = await retryTransient(() => send('PUT', key, { partNumber: number, uploadId }, {
          headers: { 'content-md5': md5.toString('base64') }, body: bytes
        }));
        const etag = String(result.headers.etag || '').replace(/^"|"$/g, '');
        if (!/^[a-f0-9]{32}$/i.test(etag) || etag.toLowerCase() !== md5.toString('hex')) {
          throw new Error('OSS 分片校验失败，上传已取消。');
        }
        uploadedParts.push({ number, etag: `"${etag}"` });
        progress(onProgress, offset + size, stat.size);
      }
      if ((await hashHandle(handle, stat.size)) !== sha256 || (await handle.stat()).size !== stat.size) {
        throw new Error('上传过程中本地备份发生变化，请重新生成备份。');
      }
      const completion = Buffer.from(`<CompleteMultipartUpload>${uploadedParts.map((part) =>
        `<Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`);
      try {
        const completed = await send('POST', key, { uploadId }, {
          headers: { 'content-type': 'application/xml', 'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private' },
          body: completion
        });
        if (!xmlTag(completed.body.toString('utf8'), 'CompleteMultipartUploadResult')) {
          throw new Error('OSS 未确认归档上传完成。');
        }
      } catch (error) {
        if (!error.retryable) throw error;
        // OSS can finish assembling after the connection drops. Check the unique key
        // before deciding that the upload failed and aborting its remaining parts.
        try {
          const maybeComplete = await head(key);
          if (maybeComplete.sha256 !== sha256 || maybeComplete.size !== stat.size) throw error;
        } catch { throw error; }
      }
      uploadId = null;
      const remote = await head(key);
      if (remote.sha256 !== sha256 || remote.size !== stat.size) throw new Error('云端归档校验失败。');
      return { key, size: stat.size, sha256, createdAt: remote.createdAt };
    } catch (error) {
      if (uploadId && key) await send('DELETE', key, { uploadId }).catch(() => {});
      throw error;
    } finally {
      await handle.close();
    }
  }

  async function listSnapshots({ limit = 100 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('归档列表数量不正确。');
    const prefix = `${config.prefix}snapshots/`;
    const snapshots = [];
    let token = null;
    let pages = 0;
    do {
      const result = await retryTransient(() => send('GET', '', {
        'list-type': 2, prefix, 'max-keys': 1000, 'encoding-type': 'url',
        ...(token ? { 'continuation-token': token } : {})
      }));
      const xml = result.body.toString('utf8');
      const encoded = xmlTag(xml, 'EncodingType') === 'url';
      for (const block of xmlBlocks(xml, 'Contents')) {
        const keyText = xmlTag(block, 'Key');
        const size = Number(xmlTag(block, 'Size'));
        const date = new Date(xmlTag(block, 'LastModified') || '');
        if (keyText === null || !Number.isSafeInteger(size) || size < 1 || Number.isNaN(date.getTime())) continue;
        const key = decodeOssKey(keyText, encoded);
        const parsed = parseSnapshotKey(key, config.prefix);
        if (parsed) snapshots.push({ key, size, sha256: parsed.sha256, createdAt: date.toISOString() });
      }
      const truncated = xmlTag(xml, 'IsTruncated');
      if (truncated !== 'true' && truncated !== 'false') throw new Error('OSS 归档列表格式不正确。');
      token = truncated === 'true' ? decodeOssKey(xmlTag(xml, 'NextContinuationToken') || '', encoded) : null;
      pages += 1;
      if ((truncated === 'true' && !token) || pages > 1000) throw new Error('OSS 归档列表分页不完整。');
    } while (token);
    snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.key.localeCompare(a.key));
    return snapshots.slice(0, limit);
  }

  async function downloadSnapshot({ key, destination, onProgress } = {}) {
    const parsed = parseSnapshotKey(key, config.prefix);
    if (!parsed) throw new Error('请选择有效的云端问间归档。');
    if (typeof destination !== 'string' || !destination.endsWith('.wenjian-backup')) {
      throw new Error('请选择问间备份的保存位置。');
    }
    const remote = await head(key);
    if (remote.sha256 !== parsed.sha256) throw new Error('云端归档校验信息不一致。');
    const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.partial-${crypto.randomUUID()}`);
    try {
      progress(onProgress, 0, remote.size);
      const result = await send('GET', key, {}, { downloadPath: temporary, expectedSize: remote.size, onProgress });
      if (!result.download || result.download.size !== remote.size || result.download.sha256 !== remote.sha256) {
        throw new Error('下载文件校验失败，已取消保存。');
      }
      await fsp.link(temporary, destination);
      await fsp.unlink(temporary);
      return { key, destination, size: remote.size, sha256: remote.sha256 };
    } catch (error) {
      await fsp.unlink(temporary).catch(() => {});
      if (error && error.code === 'EEXIST') throw new Error('保存位置已有同名备份文件。');
      throw error;
    }
  }

  return { uploadSnapshot, listSnapshots, downloadSnapshot };
}

module.exports = { validateOssConfig, createOssArchiveClient, signV4 };
