/**
 * 小米运动健康协议 — 认证（扫码登录 / STS 交换 / passToken 续期）。
 * 移植自 mi-fitness 0.2.0（https://pypi.org/project/mi-fitness/，作者 MistEO）
 * auth/qr.py、auth/sts.py、auth/passtoken.py、auth/_helpers.py、auth/manager.py（部分）。
 * 衍生作品，SPDX-License-Identifier: GPL-3.0-only
 *
 * 仅移植自查模式所需路径：扫码登录绕过密码/短信/图形验证码风控。
 */
import crypto from 'node:crypto';
import { XiaomiHttp } from './http';
import { AuthError, QrCancelledError, QrTimeoutError } from './errors';
import { emptyToken, type XiaomiToken } from './types';

// region 常量（对应 SDK const.py）
export const XIAOMI_LOGIN_URL = 'https://account.xiaomi.com/pass/serviceLogin';
export const XIAOMI_QR_LOGIN_URL = 'https://account.xiaomi.com/longPolling/loginUrl';
export const STS_HEALTH_URL = 'https://sts-hlth.io.mi.com/healthapp/sts';
export const SERVICE_SID_HEALTH = 'miothealth';

export const DEFAULT_USER_AGENT = 'Android-12-3.53.1-vivo-V2284A';
export const DEFAULT_LOGIN_USER_AGENT =
  'Dalvik/2.1.0 (Linux; U; Android 12; V2284A Build/ab8c0d1.1) ' +
  'APP/mi.health APPV/353001 MK/VjIyODRB ' +
  'SDKV/5.3.0.release.68 CPN/com.mi.health PassportSDK/';

const COOKIE_DOMAINS = ['xiaomi.com', 'mi.com'];
// endregion

/** 登录流程专用 HTTP 客户端 */
export function createLoginHttp(): XiaomiHttp {
  return new XiaomiHttp({
    userAgent: DEFAULT_LOGIN_USER_AGENT,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeoutMs: 30_000,
  });
}

/** 生成设备标识（首次生成后必须持久化，更换会触发新设备风控） */
export function newDeviceId(): string {
  return `an_${crypto.randomBytes(16).toString('hex')}`;
}

/** 解析小米 &&&START&&& 前缀 JSON 响应 */
export function parseMiResponse(text: string): Record<string, unknown> {
  let body = text;
  if (body.startsWith('&&&START&&&')) body = body.slice('&&&START&&&'.length);
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('not an object');
  } catch {
    throw new AuthError(`响应解析失败: ${text.slice(0, 200)}`);
  }
}

function setCookieForDomains(http: XiaomiHttp, name: string, value: string): void {
  for (const domain of COOKIE_DOMAINS) http.cookies.set(name, value, domain);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new QrCancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new QrCancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// region 扫码登录
export interface QrInfo {
  /** 二维码图片 URL（小米 CDN，Web 直接 <img> 展示） */
  qrImageUrl: string;
  /** 备用浏览器登录链接 */
  loginUrl: string;
  /** 长轮询 URL */
  longPollingUrl: string;
  /** 二维码有效期（秒） */
  timeoutSec: number;
}

/** Step 1：获取二维码信息（需先写入 deviceId cookie） */
export async function fetchQrInfo(http: XiaomiHttp, deviceId: string): Promise<QrInfo> {
  setCookieForDomains(http, 'deviceId', deviceId);
  const resp = await http.request('GET', XIAOMI_QR_LOGIN_URL, {
    params: {
      _qrsize: '480',
      qs: `%3Fsid%3D${SERVICE_SID_HEALTH}%26_json%3Dtrue`,
      callback: STS_HEALTH_URL,
      _hasLogo: 'false',
      sid: SERVICE_SID_HEALTH,
      serviceParam: '',
      _locale: 'zh_CN',
      _dc: String(Date.now()),
    },
  });
  if (resp.status !== 200) throw new AuthError(`获取二维码失败: HTTP ${resp.status}`);
  const data = parseMiResponse(await resp.text());
  const qrImageUrl = String(data.qr ?? '');
  const longPollingUrl = String(data.lp ?? '');
  if (!qrImageUrl || !longPollingUrl) throw new AuthError('获取二维码失败: 响应缺少 qr/lp 字段');
  return {
    qrImageUrl,
    loginUrl: String(data.loginUrl ?? ''),
    longPollingUrl,
    timeoutSec: Number(data.timeout) > 0 ? Number(data.timeout) : 300,
  };
}

/** 跟随 location 重定向，从 set-cookie 提取 serviceToken（含兜底路径） */
async function extractServiceToken(http: XiaomiHttp, location: string): Promise<string> {
  const resp = await http.request('GET', location);
  for (const header of resp.headers.getSetCookie()) {
    const match = /serviceToken=([^;]+)/.exec(header);
    if (match) return match[1];
  }
  // 兜底 1：重定向 Location 的 query
  const nextLocation = resp.headers.get('location') ?? location;
  try {
    const qs = new URL(nextLocation).searchParams;
    const fromQuery = qs.get('serviceToken');
    if (fromQuery) return fromQuery;
  } catch {
    /* 非法 URL 忽略 */
  }
  // 兜底 2：cookie jar
  const fromJar = http.cookies.get('serviceToken');
  if (fromJar) return fromJar;
  throw new AuthError('未能获取 serviceToken');
}

/** Step 2：长轮询等待扫码，返回登录响应 JSON（含 ssecurity/location 等） */
export async function waitForQrScan(
  http: XiaomiHttp,
  info: QrInfo,
  opts: { signal?: AbortSignal; pollIntervalMs?: number; maxWaitMs?: number } = {},
): Promise<Record<string, unknown>> {
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const maxWaitMs = opts.maxWaitMs ?? 300_000;
  const deadline = Date.now() + Math.min(info.timeoutSec * 1000, maxWaitMs);

  for (;;) {
    if (opts.signal?.aborted) throw new QrCancelledError();
    if (Date.now() > deadline) throw new QrTimeoutError('二维码扫码超时，请重新获取');

    let resp: Response;
    try {
      // 长轮询：单次 60s 超时、不重试（对齐 SDK 绕过 RetryAsyncClient）
      resp = await http.request('GET', info.longPollingUrl, { timeoutMs: 60_000, retry: false, signal: opts.signal });
    } catch (err) {
      if (opts.signal?.aborted) throw new QrCancelledError();
      // 超时/网络错误：继续等待
      await sleep(pollIntervalMs, opts.signal);
      continue;
    }
    if (resp.status !== 200) {
      await sleep(pollIntervalMs, opts.signal);
      continue;
    }
    return parseMiResponse(await resp.text());
  }
}

/** Step 3：从登录响应提取完整凭证 */
export async function extractCredentials(
  http: XiaomiHttp,
  data: Record<string, unknown>,
  base: XiaomiToken = emptyToken(),
): Promise<XiaomiToken> {
  const ssecurity = String(data.ssecurity ?? '');
  if (!ssecurity) throw new AuthError('登录响应缺少 ssecurity');
  const token: XiaomiToken = {
    ...base,
    ssecurity,
    userId: String(data.userId ?? ''),
    passToken: String(data.passToken ?? ''),
    cUserId: String(data.cUserId ?? ''),
  };
  const location = String(data.location ?? '');
  if (location) {
    token.serviceToken = await extractServiceToken(http, location);
  }
  return token;
}
// endregion

// region STS 交换
/** STS 安全令牌交换（非致命，失败仅返回 false） */
export async function stsExchange(http: XiaomiHttp, token: XiaomiToken): Promise<boolean> {
  try {
    const resp = await http.request('GET', STS_HEALTH_URL, {
      params: {
        d: token.deviceId,
        ticket: '0',
        pwd: '0',
        p_ts: String(Date.now()),
        fid: '0',
        p_lm: '2',
        p_ur: 'CN',
      },
    });
    return (await resp.text()).trim() === 'ok';
  } catch {
    return false;
  }
}
// endregion

// region passToken 续期
/** Python urllib quote() 等价（保留 '/'） */
function quoteB64(s: string): string {
  return encodeURIComponent(s).replace(/%2F/g, '/');
}

/**
 * 用 passToken 免扫码换取新 serviceToken/ssecurity（401 自动续期）。
 * 返回更新后的 token；失败抛 AuthError。
 */
export async function refreshWithPassToken(http: XiaomiHttp, token: XiaomiToken): Promise<XiaomiToken> {
  if (!token.passToken) throw new AuthError('passToken 为空，无法自动续期');
  if (!token.userId) throw new AuthError('userId 为空，无法自动续期');

  setCookieForDomains(http, 'passToken', token.passToken);
  setCookieForDomains(http, 'deviceId', token.deviceId);
  setCookieForDomains(http, 'userId', token.userId);

  const resp = await http.request('GET', XIAOMI_LOGIN_URL, {
    params: { _json: 'true', sid: SERVICE_SID_HEALTH },
  });
  if (resp.status !== 200) throw new AuthError(`passToken 续期失败: HTTP ${resp.status}`);
  const data = parseMiResponse(await resp.text());

  const ssecurity = String(data.ssecurity ?? '');
  if (!ssecurity) {
    throw new AuthError(`passToken 换取凭证失败：serviceLogin 未返回 ssecurity（字段: ${Object.keys(data).sort().join(', ')}）`);
  }

  const next: XiaomiToken = { ...token, ssecurity, cUserId: String(data.cUserId ?? token.cUserId) };
  const location = String(data.location ?? '');
  if (location) {
    const nonceVal = String(data.nonce ?? '');
    const signText = `nonce=${nonceVal}&${ssecurity}`;
    const sha1 = crypto.createHash('sha1').update(signText, 'utf-8').digest('base64');
    const clientSign = quoteB64(sha1);
    next.serviceToken = await extractServiceToken(http, `${location}&clientSign=${clientSign}`);
  }
  return next;
}
// endregion