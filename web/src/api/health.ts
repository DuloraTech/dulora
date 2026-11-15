// 健康数据模块 API（/api/health-data/*，后端见 server/app/controllers/health-data.controller.ts）。
// 独立信封请求实现，不改动 client.ts；仅复用其 ApiError 类型。
import { ApiError } from './client';

// region 类型（与后端 Prisma 模型 / DTO 对齐）
export interface HealthConfig {
  enabled: boolean;
  syncIntervalHours: number;
  syncDays: number;
}

export interface HealthAccountView {
  userId: string;
  status: 'active' | 'needs_relogin' | string;
  connectedAt: string;
  lastSyncAt: string | null;
}

export interface HealthSyncRunView {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error' | string;
  daysRequested: number;
  daysWritten: number;
  error: string | null;
}

export type SyncHealth = 'disconnected' | 'never_synced' | 'ok' | 'stale' | 'broken';

export interface HealthStatus {
  account: HealthAccountView | null;
  config: HealthConfig;
  syncHealth: SyncHealth;
  syncing: boolean;
  lastRun: HealthSyncRunView | null;
}

/** 每日健康汇总（字段均可空；date 为 yyyy-MM-dd，按服务端时区归一化） */
export interface HealthDaily {
  id: number;
  date: string;
  steps: number | null;
  distanceM: number | null;
  activityCalories: number | null;
  intensityMinutes: number | null;
  validStand: number | null;
  stepsGoal: number | null;
  stepsGoalAchieved: number | null;
  caloriesGoal: number | null;
  caloriesGoalAchieved: number | null;
  intensityGoal: number | null;
  intensityGoalAchieved: number | null;
  sleepScore: number | null;
  sleepDuration: number | null;
  sleepDeep: number | null;
  sleepLight: number | null;
  sleepRem: number | null;
  sleepAwake: number | null;
  bedtime: number | null;
  wakeTime: number | null;
  sleepAvgHr: number | null;
  sleepMaxHr: number | null;
  sleepMinHr: number | null;
  sleepAvgSpo2: number | null;
  avgHr: number | null;
  restingHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  abnormalHrCount: number | null;
  hrWarmUpMin: number | null;
  hrFatBurnMin: number | null;
  hrAerobicMin: number | null;
  hrAnaerobicMin: number | null;
  hrExtremeMin: number | null;
  avgSpo2: number | null;
  maxSpo2: number | null;
  minSpo2: number | null;
  stressAvg: number | null;
  stressMin: number | null;
  stressMax: number | null;
  stressRelaxMin: number | null;
  stressMildMin: number | null;
  stressModerateMin: number | null;
  stressSevereMin: number | null;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  weightKg: number | null;
  raw: string | null;
  updatedAt: string;
}

export interface HealthSleepSegment {
  id: number;
  date: string;
  kind: 'main' | 'nap' | string;
  bedtime: number;
  wakeUpTime: number;
  duration: number;
  deepMin: number;
  lightMin: number;
  remMin: number;
  awakeMin: number;
  awakeCount: number;
  avgHr: number | null;
  avgSpo2: number | null;
}

export interface HealthSleepDetail {
  daily: HealthDaily | null;
  segments: HealthSleepSegment[];
}

export interface HealthWeightLog {
  id: number;
  time: number;
  date: string;
  weightKg: number;
  bmi: number | null;
  bodyFatPct: number | null;
}

export interface SyncSummary {
  daysRequested: number;
  daysWritten: number;
  weightEvents: number;
  sleepDates: number;
  warnings: string[];
}

export type QrSessionStatus = 'pending' | 'success' | 'expired' | 'error' | 'cancelled';

export interface QrSession {
  id: string;
  status: QrSessionStatus;
  qrImageUrl?: string;
  loginUrl?: string;
  error?: string;
  createdAt: number;
}
// endregion

// region 信封请求（与 client.ts 同语义：{message,data}，401 跳登录）
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  let payload: { message?: string; data?: T } | null = null;
  if (res.status !== 204) {
    payload = await res.json().catch(() => null);
  }
  if (!res.ok) {
    const message = payload?.message ?? `请求失败（HTTP ${res.status}）`;
    if (res.status === 401) window.location.href = '/login';
    throw new ApiError(res.status, message);
  }
  return (payload?.data ?? null) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const qs = (params: Record<string, string | number | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};
// endregion

export const healthApi = {
  status: () => request<HealthStatus>('/api/health-data/status'),
  daily: (from?: string, to?: string) =>
    request<HealthDaily[]>(`/api/health-data/daily${qs({ from, to })}`),
  sleep: (date: string) => request<HealthSleepDetail>(`/api/health-data/sleep${qs({ date })}`),
  weight: (days?: number) => request<HealthWeightLog[]>(`/api/health-data/weight${qs({ days })}`),
  sync: (days?: number) => request<SyncSummary>('/api/health-data/sync', { method: 'POST', ...json({ days }) }),
  loginStart: () => request<QrSession>('/api/health-data/login/start', { method: 'POST' }),
  loginStatus: (session: string) =>
    request<QrSession>(`/api/health-data/login/status${qs({ session })}`),
  loginCancel: (sessionId: string) =>
    request<{ cancelled: boolean }>('/api/health-data/login/cancel', { method: 'POST', ...json({ sessionId }) }),
  disconnect: () => request<{ disconnected: boolean }>('/api/health-data/disconnect', { method: 'POST' }),
  getConfig: () => request<HealthConfig>('/api/health-data/config'),
  updateConfig: (patch: Partial<HealthConfig>) =>
    request<HealthConfig>('/api/health-data/config', { method: 'POST', ...json(patch) }),
};