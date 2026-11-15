/**
 * 小米运动健康协议 — 加密 API 客户端（自查模式 own-uid 端点）。
 * 移植自 mi-fitness 0.2.0（https://pypi.org/project/mi-fitness/，作者 MistEO）
 * client/base.py、client/data.py（部分）、const.py。
 * 衍生作品，SPDX-License-Identifier: GPL-3.0-only
 *
 * 自查模式端点（参考项目 xiaomi-health-sync 运行期 patch 验证过，此处原生使用）：
 * - /app/v1/data/get_aggregated_fitness_data_by_time（按天聚合）
 * - /app/v1/data/get_latest_fitness_data（最新快照）
 * - /app/v1/data/get_fitness_data_by_time（原始测量事件）
 */
import { buildEncryptedParams, decryptResponse } from './crypto';
import { ApiError, AuthError, TokenExpiredError } from './errors';
import { XiaomiHttp } from './http';
import { DEFAULT_USER_AGENT } from './auth';
import { coerceDataItems, coerceLatestItems, type RawDataItem, type RawLatestItem, type XiaomiToken } from './types';

export const HEALTH_API_BASE = 'https://hlth.io.mi.com';

export const OWN_PATHS = {
  aggregated: '/app/v1/data/get_aggregated_fitness_data_by_time',
  latest: '/app/v1/data/get_latest_fitness_data',
  fitness: '/app/v1/data/get_fitness_data_by_time',
} as const;

/** 数据类型 key */
export const DATA_KEYS = {
  goal: 'goal',
  heartRate: 'heart_rate',
  sleep: 'sleep',
  bloodPressure: 'blood_pressure',
  steps: 'steps',
  calories: 'calories',
  validStand: 'valid_stand',
  intensity: 'intensity',
  weight: 'weight',
  spo2: 'spo2',
  /** 自查模式独有（亲情模式无）；字段需真机验证 */
  stress: 'stress',
} as const;

/** API 请求专用 HTTP 客户端 */
export function createApiHttp(): XiaomiHttp {
  return new XiaomiHttp({
    userAgent: DEFAULT_USER_AGENT,
    headers: { region_tag: 'cn', handleparams: 'true' },
    timeoutMs: 30_000,
  });
}

function extractApiMessage(result: Record<string, unknown>): string {
  for (const key of ['message', 'msg', 'desc', 'description']) {
    const v = result[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '未知错误';
}

export class MiHealthClient {
  constructor(
    public token: XiaomiToken,
    private readonly http: XiaomiHttp = createApiHttp(),
    private readonly baseUrl: string = HEALTH_API_BASE,
  ) {}

  /** 发送 RC4 加密请求并解密响应；401 抛 TokenExpiredError 由上层续期 */
  async request(
    method: 'GET' | 'POST',
    path: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.token.serviceToken || !this.token.ssecurity) {
      throw new AuthError('未登录：缺少 serviceToken/ssecurity');
    }
    const encParams = buildEncryptedParams(method, path, this.token.ssecurity, params);
    const nonce = encParams._nonce;
    const cookies = { cUserId: this.token.cUserId, serviceToken: this.token.serviceToken };
    const url = this.baseUrl.replace(/\/$/, '') + path;

    const resp = await this.http.request(method, url, {
      ...(method === 'GET' ? { params: encParams } : { form: encParams }),
      cookies,
    });
    if (resp.status === 401) throw new TokenExpiredError(`认证已过期: ${method} ${path} -> 401`);
    if (resp.status !== 200) {
      throw new ApiError(`API 请求失败: ${method} ${path} -> ${resp.status}`, { statusCode: resp.status });
    }

    const text = await resp.text();
    let result: unknown;
    try {
      result = decryptResponse(this.token.ssecurity, nonce, text);
    } catch (err) {
      throw new ApiError(`响应解密失败: ${String(err)}`, { statusCode: resp.status });
    }
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      throw new ApiError('解密后非 JSON 对象');
    }
    const obj = result as Record<string, unknown>;
    const code = Number(obj.code ?? -1);
    if (!Number.isFinite(code) || code !== 0) {
      throw new ApiError(`API 业务错误 (code=${obj.code}): ${extractApiMessage(obj)}`, {
        code: Number.isFinite(code) ? code : -1,
      });
    }
    return obj;
  }

  private ownParams(extra: Record<string, unknown>): Record<string, unknown> {
    return { relative_uid: Number(this.token.userId), ...extra };
  }

  /** 按天聚合数据（步数/睡眠/心率/血氧/压力…） */
  async getAggregated(
    key: string,
    startTime: number,
    endTime: number,
    opts: { tag?: string; limit?: number } = {},
  ): Promise<RawDataItem[]> {
    const resp = await this.request('GET', OWN_PATHS.aggregated, this.ownParams({
      key,
      tag: opts.tag ?? 'daily_report',
      start_time: startTime,
      end_time: endTime,
      limit: opts.limit ?? 30,
    }));
    const result = (resp.result ?? {}) as Record<string, unknown>;
    return coerceDataItems(result.data_list);
  }

  /** 原始测量事件（体重含体脂率、血压历史…） */
  async getFitness(key: string, startTime: number, endTime: number, limit = 30): Promise<RawDataItem[]> {
    const resp = await this.request('GET', OWN_PATHS.fitness, this.ownParams({
      key,
      start_time: startTime,
      end_time: endTime,
      limit,
    }));
    const result = (resp.result ?? {}) as Record<string, unknown>;
    return coerceDataItems(result.data_list);
  }

  /** 最新快照（血压/体重/目标…） */
  async getLatest(): Promise<RawLatestItem[]> {
    const resp = await this.request('GET', OWN_PATHS.latest, this.ownParams({}));
    const result = (resp.result ?? {}) as Record<string, unknown>;
    return coerceLatestItems(result.data_list);
  }
}

// region 时间窗（对齐 SDK _date_to_timestamps：UTC+8 自然日，中国无夏令时）
const CN_OFFSET_SEC = 8 * 3600;

/** yyyy-MM-dd → 当日 00:00:00 (+08) 的 epoch 秒 */
export function dayStartTs(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`非法日期: ${dateStr}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000 - CN_OFFSET_SEC;
}

/** 以 endDate 为结束日、向前 days 天的查询窗口（epoch 秒，含首尾） */
export function windowTs(endDate: string, days: number): { start: number; end: number } {
  const windowDays = Math.max(1, Math.trunc(days));
  const end = dayStartTs(endDate) + 86400 - 1;
  const start = end - 86400 * windowDays + 1;
  return { start, end };
}
// endregion