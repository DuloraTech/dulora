/**
 * 小米运动健康协议 — RC4 加密与请求签名。
 * 移植自 mi-fitness 0.2.0（https://pypi.org/project/mi-fitness/，作者 MistEO）crypto.py。
 * 衍生作品，SPDX-License-Identifier: GPL-3.0-only
 *
 * 协议要点（与 App 端 ua4.c / z94.b / d8k 行为对齐）：
 * - RC4 丢弃前 1024 字节密钥流；多个参数值共用一条连续密钥流
 * - nonce = b64(随机8字节 + epoch分钟数4字节BE)
 * - signedNonce = b64(SHA256(b64dec(ssecurity) + b64dec(nonce)))
 * - 签名消息 = METHOD&/path&k=v…(key字典序)&signedNonce，纯 SHA1（非 HMAC）→ b64
 */
import crypto from 'node:crypto';

/** RC4 加解密（对称），skip 为丢弃的密钥流字节数 */
export function rc4Crypt(key: Buffer, data: Buffer, skip = 1024): Buffer {
  if (key.length === 0) throw new Error('RC4 key must not be empty');
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;

  // KSA
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }

  // PRGA：先丢弃 skip 字节密钥流
  let i = 0;
  j = 0;
  for (let n = 0; n < skip; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }

  const out = Buffer.alloc(data.length);
  for (let idx = 0; idx < data.length; idx++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
    out[idx] = data[idx] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/** 生成请求 nonce：b64(随机8字节 + epoch分钟数4字节BE) */
export function generateNonce(nowMs: number = Date.now()): string {
  const randomPart = crypto.randomBytes(8);
  const timePart = Buffer.alloc(4);
  timePart.writeUInt32BE(Math.floor(nowMs / 1000 / 60));
  return Buffer.concat([randomPart, timePart]).toString('base64');
}

/** signedNonce = b64(SHA256(b64dec(ssecurity) + b64dec(nonce)))，其原始字节即 RC4 密钥 */
export function computeSignedNonce(ssecurity: string, nonce: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(Buffer.concat([Buffer.from(ssecurity, 'base64'), Buffer.from(nonce, 'base64')]))
    .digest();
  return hash.toString('base64');
}

/** 纯 SHA1 → Base64（App 用 MessageDigest("SHA1")，不是 HMAC） */
function sha1B64(message: string): string {
  return crypto.createHash('sha1').update(message, 'utf-8').digest('base64');
}

/** 签名消息：METHOD&/path&k1=v1&…(key字典序)&signedNonce */
function buildSigMessage(
  method: string,
  urlPath: string,
  params: Record<string, string>,
  signedNonce: string,
): string {
  const parts: string[] = [method.toUpperCase()];
  parts.push(urlPath.startsWith('/') ? urlPath : `/${urlPath}`);
  for (const k of Object.keys(params).sort()) {
    parts.push(`${k}=${params[k]}`);
  }
  parts.push(signedNonce);
  return parts.join('&');
}

/**
 * 用连续 RC4 流加密多个值：所有 value 按 key 排序后拼接成一条流加密，
 * 再按各 value 的 UTF-8 字节长切分、逐个 base64。
 */
function rc4StreamEncryptValues(
  keyBytes: Buffer,
  sortedEntries: Array<[string, string]>,
): Record<string, string> {
  const allBytes = Buffer.concat(sortedEntries.map(([, v]) => Buffer.from(v, 'utf-8')));
  const encryptedAll = rc4Crypt(keyBytes, allBytes);
  const result: Record<string, string> = {};
  let pos = 0;
  for (const [k, v] of sortedEntries) {
    const vlen = Buffer.byteLength(v, 'utf-8');
    result[k] = encryptedAll.subarray(pos, pos + vlen).toString('base64');
    pos += vlen;
  }
  return result;
}

/** 用 signedNonce 派生密钥加密明文（紧凑 JSON 字符串） */
export function encryptData(signedNonce: string, plaintext: string): string {
  const key = Buffer.from(signedNonce, 'base64');
  return rc4Crypt(key, Buffer.from(plaintext, 'utf-8')).toString('base64');
}

/** 用 signedNonce 派生密钥解密密文 */
export function decryptData(signedNonce: string, ciphertextB64: string): string {
  const key = Buffer.from(signedNonce, 'base64');
  return rc4Crypt(key, Buffer.from(ciphertextB64, 'base64')).toString('utf-8');
}

/**
 * 构建完整的加密请求参数：
 * 1. data = 业务参数紧凑 JSON
 * 2. rc4_hash__ = SHA1(原始参数签名消息) → b64，加入参数树
 * 3. 所有值按 key 排序、共用 RC4 流加密
 * 4. signature = SHA1(加密后参数签名消息) → b64
 * 5. 返回 {各加密参数, signature, _nonce}
 *
 * opts.nonce 仅用于测试注入确定性 nonce。
 */
export function buildEncryptedParams(
  method: string,
  urlPath: string,
  ssecurity: string,
  params?: Record<string, unknown> | null,
  opts: { nonce?: string } = {},
): Record<string, string> {
  const nonce = opts.nonce ?? generateNonce();
  const snonce = computeSignedNonce(ssecurity, nonce);
  const snonceBytes = Buffer.from(snonce, 'base64');

  const rawTree: Record<string, string> = {};
  if (params) {
    // JSON.stringify 默认紧凑、非 ASCII 原样输出，
    // 等价于 Python json.dumps(separators=(",",":"), ensure_ascii=False)
    rawTree.data = JSON.stringify(params);
  }

  const rc4Hash = sha1B64(buildSigMessage(method, urlPath, rawTree, snonce));
  rawTree.rc4_hash__ = rc4Hash;

  const sortedEntries = Object.entries(rawTree).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const encryptedValues = rc4StreamEncryptValues(snonceBytes, sortedEntries);

  const signature = sha1B64(buildSigMessage(method, urlPath, encryptedValues, snonce));
  return { ...encryptedValues, signature, _nonce: nonce };
}

/** 解密 API 响应：同一 nonce 派生密钥，RC4 解密整个响应体 → JSON */
export function decryptResponse(ssecurity: string, nonce: string, ciphertextB64: string): unknown {
  const snonce = computeSignedNonce(ssecurity, nonce);
  const plaintext = decryptData(snonce, ciphertextB64);
  try {
    return JSON.parse(plaintext);
  } catch {
    return plaintext;
  }
}