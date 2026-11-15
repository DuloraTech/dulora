/**
 * 小米运动健康协议 — HTTP 客户端（cookie jar + 幂等重试）。
 * 移植自 mi-fitness 0.2.0（https://pypi.org/project/mi-fitness/，作者 MistEO）http.py / auth/_helpers.py。
 * 衍生作品，SPDX-License-Identifier: GPL-3.0-only
 *
 * 对齐 SDK 行为：
 * - 不自动跟随重定向（serviceToken 需从重定向响应的 set-cookie 提取）
 * - 仅 GET 等幂等方法重试（429/5xx/网络错误，指数退避，最多 3 次）
 * - 响应 set-cookie 自动并入 cookie jar
 */
import { ApiError } from './errors';

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/** 极简 cookie jar：按域后缀匹配（xiaomi.com / mi.com 覆盖全部子域） */
export class CookieJar {
  private store = new Map<string, Map<string, string>>();

  set(name: string, value: string, domain: string): void {
    const d = domain.toLowerCase().replace(/^\./, '');
    let bucket = this.store.get(d);
    if (!bucket) {
      bucket = new Map();
      this.store.set(d, bucket);
    }
    bucket.set(name, value);
  }

  get(name: string): string | undefined {
    for (const bucket of this.store.values()) {
      const v = bucket.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  /** 收集适用于目标 URL 的全部 cookie */
  headerFor(url: URL): string {
    const host = url.hostname.toLowerCase();
    const pairs: string[] = [];
    for (const [domain, bucket] of this.store) {
      if (host === domain || host.endsWith(`.${domain}`)) {
        for (const [name, value] of bucket) pairs.push(`${name}=${value}`);
      }
    }
    return pairs.join('; ');
  }

  /** 吸收响应 set-cookie（处理 Domain 属性与过期删除） */
  absorb(url: URL, setCookies: string[]): void {
    for (const header of setCookies) {
      const parts = header.split(';');
      const first = parts[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      let domain = url.hostname.toLowerCase();
      let expired = false;
      for (const attr of parts.slice(1)) {
        const [rawKey, ...rawVal] = attr.split('=');
        const key = rawKey.trim().toLowerCase();
        const val = rawVal.join('=').trim();
        if (key === 'domain' && val) domain = val.toLowerCase().replace(/^\./, '');
        if (key === 'max-age' && Number(val) <= 0) expired = true;
        if (key === 'expires' && val) {
          const t = Date.parse(val);
          if (Number.isFinite(t) && t < Date.now()) expired = true;
        }
      }
      const d = domain.replace(/^\./, '');
      if (expired || value === '') {
        this.store.get(d)?.delete(name);
      } else {
        this.set(name, value, d);
      }
    }
  }
}

export interface XiaomiHttpOptions {
  userAgent: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retryAttempts?: number;
}

export interface RequestOptions {
  params?: Record<string, string>;
  form?: Record<string, string>;
  /** 额外 cookie（与 jar 合并，优先于 jar） */
  cookies?: Record<string, string>;
  timeoutMs?: number;
  /** 默认仅 GET 重试；长轮询显式关闭 */
  retry?: boolean;
  signal?: AbortSignal;
}

function backoffMs(attempt: number): number {
  return Math.min(2000, Math.max(200, 500 * 2 ** (attempt - 1)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class XiaomiHttp {
  readonly cookies = new CookieJar();

  constructor(private readonly opts: XiaomiHttpOptions) {}

  async request(method: string, url: string, o: RequestOptions = {}): Promise<Response> {
    const target = new URL(url);
    if (o.params) {
      for (const [k, v] of Object.entries(o.params)) target.searchParams.set(k, v);
    }

    const jarCookie = this.cookies.headerFor(target);
    const extraCookie = Object.entries(o.cookies ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const cookie = [jarCookie, extraCookie].filter(Boolean).join('; ');

    const headers: Record<string, string> = {
      'user-agent': this.opts.userAgent,
      ...this.opts.headers,
    };
    if (cookie) headers.cookie = cookie;

    let body: string | undefined;
    if (o.form) {
      body = new URLSearchParams(o.form).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }

    const upper = method.toUpperCase();
    const allowRetry = (o.retry ?? upper === 'GET') && upper === 'GET';
    const attempts = allowRetry ? (this.opts.retryAttempts ?? 3) : 1;
    const timeoutMs = o.timeoutMs ?? this.opts.timeoutMs ?? 30_000;

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const signals = [AbortSignal.timeout(timeoutMs)];
      if (o.signal) signals.push(o.signal);
      try {
        const resp = await fetch(target.toString(), {
          method: upper,
          headers,
          body,
          redirect: 'manual',
          signal: AbortSignal.any(signals),
        });
        this.cookies.absorb(target, resp.headers.getSetCookie());
        if (attempt < attempts && RETRY_STATUSES.has(resp.status)) {
          await sleep(backoffMs(attempt));
          continue;
        }
        return resp;
      } catch (err) {
        // 外部取消不重试，直接抛出
        if (o.signal?.aborted) throw err;
        lastError = err;
        if (attempt < attempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
      }
    }
    throw new ApiError(`网络请求失败: ${upper} ${target.pathname}: ${String(lastError)}`);
  }
}