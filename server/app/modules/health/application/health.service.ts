/**
 * 健康数据服务：同步编排 + 定时调度 + 扫码登录 + 查询。
 * 协议层见 ./xiaomi（GPL-3.0 移植模块），归一化见 ./normalize。
 */
import { Service } from 'typedi';
import { BadRequestError, HttpError } from 'routing-controllers';
import { prisma } from '../../../shared/prisma';
import { dateInTz, isValidDateStr } from '../../../shared/day';
import { DEFAULT_TZ } from '../../../../configs/constants';
import {
  ApiError,
  AuthError,
  MiHealthClient,
  TokenExpiredError,
  createLoginHttp,
  refreshWithPassToken,
  windowTs,
  type RawDataItem,
  type RawLatestItem,
  type XiaomiToken,
} from '../xiaomi';
import { normalizeSync, type DailyFields, type SyncPayload } from '../normalize';
import { LoginSessionManager, type QrSessionView } from '../login-session';

const AGGREGATED_KEYS = ['steps', 'heart_rate', 'sleep', 'spo2', 'calories', 'intensity', 'valid_stand', 'stress'];
const FITNESS_KEYS = ['weight', 'blood_pressure'];
const TICK_MS = 15 * 60 * 1000;

export interface HealthConfigView {
  enabled: boolean;
  syncIntervalHours: number;
  syncDays: number;
}

export interface SyncSummary {
  daysRequested: number;
  daysWritten: number;
  weightEvents: number;
  sleepDates: number;
  warnings: string[];
}

function tokenFromAccount(a: {
  userId: string;
  cUserId: string;
  serviceToken: string;
  ssecurity: string;
  passToken: string;
  deviceId: string;
}): XiaomiToken {
  return {
    userId: a.userId,
    cUserId: a.cUserId,
    serviceToken: a.serviceToken,
    ssecurity: a.ssecurity,
    passToken: a.passToken,
    deviceId: a.deviceId,
  };
}

function friendly(err: unknown): never {
  if (err instanceof BadRequestError || err instanceof HttpError) throw err;
  if (err instanceof AuthError) throw new BadRequestError(err.message);
  if (err instanceof ApiError) throw new HttpError(502, `小米接口错误: ${err.message}`);
  throw new HttpError(500, err instanceof Error ? err.message : String(err));
}

@Service()
export class HealthService {
  private syncing = false;
  private schedulerStarted = false;
  private readonly sessions: LoginSessionManager;

  constructor() {
    this.sessions = new LoginSessionManager(async (token) => {
      await this.saveAccount(token);
      // 登录成功后自动触发首次同步（失败不影响登录结果）
      const config = await this.getConfig();
      this.sync({ days: config.syncDays }).catch((err) => {
        console.error('[dulora] 健康首次同步失败:', err instanceof Error ? err.message : err);
      });
    });
    this.startScheduler();
  }

  // region 配置
  async getConfig(): Promise<HealthConfigView> {
    const c = await prisma.healthConfig.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    return { enabled: c.enabled, syncIntervalHours: c.syncIntervalHours, syncDays: c.syncDays };
  }

  async updateConfig(patch: Partial<HealthConfigView>): Promise<HealthConfigView> {
    await prisma.healthConfig.upsert({
      where: { id: 1 },
      create: { id: 1, ...patch },
      update: patch,
    });
    return this.getConfig();
  }
  // endregion

  // region 账号
  private async saveAccount(token: XiaomiToken): Promise<void> {
    const data = {
      userId: token.userId,
      cUserId: token.cUserId,
      serviceToken: token.serviceToken,
      ssecurity: token.ssecurity,
      passToken: token.passToken,
      deviceId: token.deviceId,
      status: 'active',
    };
    await prisma.healthAccount.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  }

  private async getTimezone(): Promise<string> {
    const s = await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, timezone: DEFAULT_TZ },
      update: {},
    });
    return s.timezone;
  }

  async disconnect(): Promise<{ disconnected: boolean }> {
    this.sessions.cancelAllPending();
    await prisma.healthAccount.deleteMany({ where: { id: 1 } });
    return { disconnected: true };
  }
  // endregion

  // region 扫码登录
  async loginStart(): Promise<QrSessionView> {
    const account = await prisma.healthAccount.findUnique({ where: { id: 1 } });
    try {
      // 复用已持久化 deviceId，避免触发新设备风控
      return await this.sessions.start(account?.deviceId);
    } catch (err) {
      friendly(err);
    }
  }

  loginStatus(sessionId: string): QrSessionView {
    const view = this.sessions.get(sessionId);
    if (!view) throw new BadRequestError('扫码会话不存在或已过期');
    return view;
  }

  loginCancel(sessionId: string): { cancelled: boolean } {
    return { cancelled: this.sessions.cancel(sessionId) };
  }
  // endregion

  // region 状态与查询
  async status() {
    const [account, config, lastRun] = await Promise.all([
      prisma.healthAccount.findUnique({ where: { id: 1 } }),
      this.getConfig(),
      prisma.healthSyncRun.findFirst({ orderBy: { id: 'desc' } }),
    ]);
    let syncHealth: 'disconnected' | 'never_synced' | 'ok' | 'stale' | 'broken';
    if (!account) syncHealth = 'disconnected';
    else if (account.status !== 'active') syncHealth = 'broken';
    else if (!account.lastSyncAt) syncHealth = 'never_synced';
    else if (lastRun?.status === 'error') syncHealth = 'broken';
    else if (Date.now() - account.lastSyncAt.getTime() > 2 * config.syncIntervalHours * 3600_000) syncHealth = 'stale';
    else syncHealth = 'ok';

    return {
      // 凭证永不经过 API 返回
      account: account
        ? { userId: account.userId, status: account.status, connectedAt: account.connectedAt, lastSyncAt: account.lastSyncAt }
        : null,
      config,
      syncHealth,
      syncing: this.syncing,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            status: lastRun.status,
            daysRequested: lastRun.daysRequested,
            daysWritten: lastRun.daysWritten,
            error: lastRun.error,
          }
        : null,
    };
  }

  async daily(from?: string, to?: string) {
    const tz = await this.getTimezone();
    const toFinal = to && isValidDateStr(to) ? to : dateInTz(tz);
    const fromFinal =
      from && isValidDateStr(from) ? from : dateInTz(tz, new Date(Date.now() - 29 * 86400_000));
    if (fromFinal > toFinal) throw new BadRequestError('from 不能晚于 to');
    return prisma.healthDaily.findMany({
      where: { date: { gte: fromFinal, lte: toFinal } },
      orderBy: { date: 'asc' },
    });
  }

  async sleep(date: string) {
    if (!isValidDateStr(date)) throw new BadRequestError('非法日期，应为 yyyy-MM-dd');
    const [daily, segments] = await Promise.all([
      prisma.healthDaily.findUnique({ where: { date } }),
      prisma.healthSleepSegment.findMany({ where: { date }, orderBy: { bedtime: 'asc' } }),
    ]);
    return { daily, segments };
  }

  async weight(days = 90) {
    const tz = await this.getTimezone();
    const cutoff = dateInTz(tz, new Date(Date.now() - (Math.max(1, days) - 1) * 86400_000));
    return prisma.healthWeightLog.findMany({ where: { date: { gte: cutoff } }, orderBy: { time: 'asc' } });
  }
  // endregion

  // region 同步
  async sync(opts: { days?: number } = {}): Promise<SyncSummary> {
    if (this.syncing) throw new HttpError(409, '同步进行中，请稍后再试');
    const account = await prisma.healthAccount.findUnique({ where: { id: 1 } });
    if (!account) throw new BadRequestError('未连接小米账号，请先扫码登录');
    if (account.status !== 'active') throw new BadRequestError('登录已失效，请重新扫码');

    const config = await this.getConfig();
    const days = Math.min(90, Math.max(1, Math.trunc(opts.days ?? config.syncDays)));
    this.syncing = true;
    const run = await prisma.healthSyncRun.create({ data: { daysRequested: days } });
    try {
      const tz = await this.getTimezone();
      const { payload, warnings } = await this.fetchWithRefresh(tokenFromAccount(account), days, tz);
      const normalized = normalizeSync(payload, tz);
      const daysWritten = await this.persist(normalized.daily, normalized.segments, normalized.weights);
      const summary: SyncSummary = {
        daysRequested: days,
        daysWritten,
        weightEvents: normalized.weights.length,
        sleepDates: normalized.segments.size,
        warnings,
      };
      await prisma.healthAccount.update({ where: { id: 1 }, data: { lastSyncAt: new Date() } });
      await prisma.healthSyncRun.update({
        where: { id: run.id },
        data: { status: 'ok', finishedAt: new Date(), daysWritten },
      });
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.healthSyncRun.update({
        where: { id: run.id },
        data: { status: 'error', finishedAt: new Date(), error: message.slice(0, 500) },
      });
      friendly(err);
    } finally {
      this.syncing = false;
    }
  }

  /** 401 → passToken 免扫码续期 → 重试一次；续期失败置 needs_relogin */
  private async fetchWithRefresh(
    token: XiaomiToken,
    days: number,
    tz: string,
  ): Promise<{ payload: SyncPayload; warnings: string[] }> {
    try {
      return await this.fetchAll(new MiHealthClient(token), days, tz);
    } catch (err) {
      if (!(err instanceof TokenExpiredError)) throw err;
      let next: XiaomiToken;
      try {
        next = await refreshWithPassToken(createLoginHttp(), token);
      } catch {
        await prisma.healthAccount.update({ where: { id: 1 }, data: { status: 'needs_relogin' } });
        throw new BadRequestError('登录已过期且自动续期失败，请重新扫码');
      }
      await this.saveAccount(next);
      return await this.fetchAll(new MiHealthClient(next), days, tz);
    }
  }

  /** 逐指标拉取；单指标失败不阻塞整体（stress 等实验性 key 容错） */
  private async fetchAll(
    client: MiHealthClient,
    days: number,
    tz: string,
  ): Promise<{ payload: SyncPayload; warnings: string[] }> {
    const endDate = dateInTz(tz);
    const { start, end } = windowTs(endDate, days);
    const aggregated: Record<string, RawDataItem[]> = {};
    const fitness: Record<string, RawDataItem[]> = {};
    const warnings: string[] = [];

    for (const key of AGGREGATED_KEYS) {
      try {
        aggregated[key] = await client.getAggregated(key, start, end, { limit: days });
      } catch (err) {
        if (err instanceof TokenExpiredError) throw err;
        aggregated[key] = [];
        warnings.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const key of FITNESS_KEYS) {
      try {
        fitness[key] = await client.getFitness(key, start, end, Math.max(days, 30));
      } catch (err) {
        if (err instanceof TokenExpiredError) throw err;
        fitness[key] = [];
        warnings.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (warnings.length === AGGREGATED_KEYS.length + FITNESS_KEYS.length) {
      throw new ApiError(`全部指标拉取失败: ${warnings[0] ?? '未知错误'}`);
    }
    const latest: RawLatestItem[] = await client.getLatest();
    return { payload: { aggregated, fitness, latest }, warnings };
  }

  /** 按日 upsert；睡眠分段按日期整组替换；体重按测量时间 upsert */
  private async persist(
    daily: Map<string, DailyFields>,
    segments: Map<string, import('../normalize').NormalizedSegment[]>,
    weights: import('../normalize').NormalizedWeight[],
  ): Promise<number> {
    await prisma.$transaction(async (tx) => {
      for (const [date, fields] of daily) {
        await tx.healthDaily.upsert({ where: { date }, create: { date, ...fields }, update: fields });
      }
      for (const [date, segs] of segments) {
        await tx.healthSleepSegment.deleteMany({ where: { date } });
        await tx.healthSleepSegment.createMany({ data: segs });
      }
      for (const w of weights) {
        await tx.healthWeightLog.upsert({
          where: { time: w.time },
          create: w,
          update: { date: w.date, weightKg: w.weightKg, bmi: w.bmi, bodyFatPct: w.bodyFatPct },
        });
      }
    });
    return daily.size;
  }
  // endregion

  // region 定时调度
  private startScheduler(): void {
    if (this.schedulerStarted) return;
    this.schedulerStarted = true;
    const tick = () => {
      this.schedulerTick().catch((err) => {
        console.error('[dulora] 健康定时同步失败:', err instanceof Error ? err.message : err);
      });
    };
    // 启动 30s 后先检查一次（补上过期同步），之后每 15 分钟检查
    const initial = setTimeout(tick, 30_000);
    initial.unref();
    const timer = setInterval(tick, TICK_MS);
    timer.unref();
  }

  private async schedulerTick(): Promise<void> {
    const config = await this.getConfig();
    if (!config.enabled || this.syncing) return;
    const account = await prisma.healthAccount.findUnique({ where: { id: 1 } });
    if (!account || account.status !== 'active') return;
    const last = account.lastSyncAt?.getTime() ?? 0;
    if (Date.now() - last < config.syncIntervalHours * 3600_000) return;
    await this.sync({ days: config.syncDays });
  }
  // endregion
}