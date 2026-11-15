/**
 * 加密协议黄金向量测试：与 mi-fitness 0.2.0 原版 crypto.py 输出逐字节比对。
 * 向量生成方式见 __fixtures__/crypto-vectors.json 的 _provenance 字段。
 * 运行：npm test（node --import tsx --test）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  rc4Crypt,
  generateNonce,
  computeSignedNonce,
  buildEncryptedParams,
  encryptData,
  decryptData,
  decryptResponse,
} from './crypto';

interface VectorFile {
  ssecurity: string;
  nonce: string;
  signed_nonce: string;
  vectors: Array<Record<string, unknown> & { name: string }>;
}

// npm test 的 cwd 为 server/
const fixture = JSON.parse(
  fs.readFileSync('app/modules/health/xiaomi/__fixtures__/crypto-vectors.json', 'utf-8'),
) as VectorFile;

function vector(name: string): Record<string, unknown> {
  const v = fixture.vectors.find((x) => x.name === name);
  assert.ok(v, `缺少向量: ${name}`);
  return v;
}

test('RC4(skip=1024) 与原版 SDK 逐字节一致', () => {
  const v = vector('rc4_basic');
  const key = Buffer.from(v.key_b64 as string, 'base64');
  const plain = Buffer.from(v.plaintext as string, 'utf-8');
  const expected = Buffer.from(v.ciphertext_b64 as string, 'base64');
  assert.deepEqual(rc4Crypt(key, plain), expected);
  // 对称解密回环
  assert.deepEqual(rc4Crypt(key, expected), plain);
});

test('RC4 skip 参数生效（skip=0 与 skip=1024 输出不同）', () => {
  const key = Buffer.from('0123456789abcdef');
  const data = Buffer.from('hello xiaomi health');
  assert.notDeepEqual(rc4Crypt(key, data, 0), rc4Crypt(key, data, 1024));
});

test('computeSignedNonce 与原版一致', () => {
  assert.equal(computeSignedNonce(fixture.ssecurity, fixture.nonce), fixture.signed_nonce);
});

test('generateNonce 结构：8 随机字节 + 4 字节 BE 分钟数', () => {
  const nowMs = 1_700_000_000_123;
  const nonce = generateNonce(nowMs);
  const raw = Buffer.from(nonce, 'base64');
  assert.equal(raw.length, 12);
  assert.equal(raw.readUInt32BE(8), Math.floor(nowMs / 1000 / 60));
  // 随机段不相等
  assert.notDeepEqual(Buffer.from(generateNonce(nowMs), 'base64').subarray(0, 8), raw.subarray(0, 8));
});

for (const name of ['aggregated_steps', 'unicode_post', 'no_params']) {
  test(`buildEncryptedParams 黄金向量: ${name}`, () => {
    const v = vector(name);
    const enc = buildEncryptedParams(
      v.method as string,
      v.path as string,
      fixture.ssecurity,
      v.params as Record<string, unknown> | null,
      { nonce: fixture.nonce },
    );
    assert.deepEqual(enc, v.enc);
  });
}

test('buildEncryptedParams 确定性：同 nonce 同输出，不同 nonce 不同输出', () => {
  const params = { key: 'steps', limit: 7 };
  const a = buildEncryptedParams('GET', '/app/v1/data/get_latest_fitness_data', fixture.ssecurity, params, { nonce: fixture.nonce });
  const b = buildEncryptedParams('GET', '/app/v1/data/get_latest_fitness_data', fixture.ssecurity, params, { nonce: fixture.nonce });
  assert.deepEqual(a, b);
  const otherNonce = generateNonce();
  const c = buildEncryptedParams('GET', '/app/v1/data/get_latest_fitness_data', fixture.ssecurity, params, { nonce: otherNonce });
  assert.notEqual(c.data, a.data);
  assert.notEqual(c.signature, a.signature);
  assert.equal(c._nonce, otherNonce);
});

test('响应解密黄金向量', () => {
  const v = vector('response_decrypt');
  const result = decryptResponse(fixture.ssecurity, fixture.nonce, v.ciphertext as string);
  assert.deepEqual(result, v.expected);
});

test('encryptData/decryptData 中文回环', () => {
  const snonce = fixture.signed_nonce;
  const plaintext = JSON.stringify({ message: '睡眠数据·测试', values: [1, 2, 3] });
  const cipher = encryptData(snonce, plaintext);
  assert.equal(decryptData(snonce, cipher), plaintext);
});

test('decryptResponse 非 JSON 时返回原始字符串', () => {
  const snonce = fixture.signed_nonce;
  const cipher = encryptData(snonce, 'ok');
  assert.equal(decryptResponse(fixture.ssecurity, fixture.nonce, cipher), 'ok');
});