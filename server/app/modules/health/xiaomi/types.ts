/**
 * 小米运动健康协议 — 类型定义。
 * 移植自 mi-fitness 0.2.0（https://pypi.org/project/mi-fitness/，作者 MistEO）。
 * 衍生作品，SPDX-License-Identifier: GPL-3.0-only
 */

/** 登录凭证（对应 SDK AuthToken，持久化于 HealthAccount） */
export interface XiaomiToken {
  userId: string;
  cUserId: string;
  serviceToken: string;
  ssecurity: string;
  passToken: string;
  deviceId: string;
}

export function emptyToken(): XiaomiToken {
  return { userId: '', cUserId: '', serviceToken: '', ssecurity: '', passToken: '', deviceId: '' };
}

/** 聚合/原始测量数据项（get_aggregated_fitness_data_by_time / get_fitness_data_by_time） */
export interface RawDataItem {
  sid: string;
  tag: string;
  key: string;
  time: number;
  /** JSON 字符串（服务端偶尔直接返回对象，coerce 后统一为字符串） */
  value: string;
  updateTime: number;
  watermark: string;
}

/** 最新快照数据项（get_latest_fitness_data） */
export interface RawLatestItem {
  time: number;
  key: string;
  value: string;
}

function coerceValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function coerceInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** 宽松解析 data_list：跳过单条脏数据（对齐 SDK _parse_model_list 行为） */
export function coerceDataItems(raw: unknown): RawDataItem[] {
  if (!Array.isArray(raw)) return [];
  const items: RawDataItem[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    items.push({
      sid: String(e.sid ?? ''),
      tag: String(e.tag ?? ''),
      key: String(e.key ?? ''),
      time: coerceInt(e.time),
      value: coerceValue(e.value),
      updateTime: coerceInt(e.update_time),
      watermark: e.watermark === null || e.watermark === undefined ? '' : String(e.watermark),
    });
  }
  return items;
}

export function coerceLatestItems(raw: unknown): RawLatestItem[] {
  if (!Array.isArray(raw)) return [];
  const items: RawLatestItem[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    items.push({ time: coerceInt(e.time), key: String(e.key ?? ''), value: coerceValue(e.value) });
  }
  return items;
}

/** 解析数据项 value JSON；失败或非对象返回 {}（对齐 SDK parse_value） */
export function parseItemValue(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}