/**
 * 健康数据归一化：小米原始数据项 → 按日汇总（与日记日期对齐）。
 *
 * 参考 xiaomi-health-sync（MIT）health_vault/sync.py 的归一化思路，重写为 TS：
 * - 日期按 Settings.timezone 归一化（修复参考项目 UTC 偏移 8 小时的问题）
 * - 睡眠取最长段为主睡眠（入睡/醒来），全部分段保留（main/nap）
 * - 体重是事件数据，体脂率仅在原始测量 JSON
 * - 血压从 latest 快照读（历史接口为空）
 * - 压力为自查模式独有，字段映射待真机验证（raw 保留原始 JSON 兜底）
 */
import { dateInTz } from '../../shared/day';
import { parseItemValue, type RawDataItem, type RawLatestItem } from './xiaomi/types';

/** HealthDaily 的可写字段（与 Prisma 模型对齐） */
export interface DailyFields {
  steps?: number;
  distanceM?: number;
  activityCalories?: number;
  intensityMinutes?: number;
  validStand?: number;
  stepsGoal?: number;
  stepsGoalAchieved?: number;
  caloriesGoal?: number;
  caloriesGoalAchieved?: number;
  intensityGoal?: number;
  intensityGoalAchieved?: number;
  sleepScore?: number;
  sleepDuration?: number;
  sleepDeep?: number;
  sleepLight?: number;
  sleepRem?: number;
  sleepAwake?: number;
  bedtime?: number;
  wakeTime?: number;
  sleepAvgHr?: number;
  sleepMaxHr?: number;
  sleepMinHr?: number;
  sleepAvgSpo2?: number;
  avgHr?: number;
  restingHr?: number;
  maxHr?: number;
  minHr?: number;
  abnormalHrCount?: number;
  hrWarmUpMin?: number;
  hrFatBurnMin?: number;
  hrAerobicMin?: number;
  hrAnaerobicMin?: number;
  hrExtremeMin?: number;
  avgSpo2?: number;
  maxSpo2?: number;
  minSpo2?: number;
  stressAvg?: number;
  stressMin?: number;
  stressMax?: number;
  stressRelaxMin?: number;
  stressMildMin?: number;
  stressModerateMin?: number;
  stressSevereMin?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  weightKg?: number;
  raw?: string;
}

export interface NormalizedSegment {
  date: string;
  kind: 'main' | 'nap';
  bedtime: number;
  wakeUpTime: number;
  duration: number;
  deepMin: number;
  lightMin: number;
  remMin: number;
  awakeMin: number;
  awakeCount: number;
  avgHr?: number;
  avgSpo2?: number;
}

export interface NormalizedWeight {
  time: number;
  date: string;
  weightKg: number;
  bmi?: number;
  bodyFatPct?: number;
}

export interface SyncPayload {
  /** key → 按天聚合数据项 */
  aggregated: Record<string, RawDataItem[]>;
  /** key → 原始测量事件 */
  fitness: Record<string, RawDataItem[]>;
  latest: RawLatestItem[];
}

export interface NormalizeResult {
  daily: Map<string, DailyFields>;
  /** 有睡眠数据的日期 → 分段（persist 时按日期整组替换） */
  segments: Map<string, NormalizedSegment[]>;
  weights: NormalizedWeight[];
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function int(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.trunc(n);
}

/** 候选字段名取第一个有效值（压力等未验证字段用） */
function pick(v: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const n = int(v[k]);
    if (n !== undefined) return n;
  }
  return undefined;
}

export function normalizeSync(payload: SyncPayload, timeZone: string): NormalizeResult {
  const daily = new Map<string, DailyFields>();
  const segments = new Map<string, NormalizedSegment[]>();
  const weights: NormalizedWeight[] = [];
  const rawByDate = new Map<string, Record<string, unknown>>();

  const dateOf = (ts: number): string | undefined =>
    ts > 0 ? dateInTz(timeZone, new Date(ts * 1000)) : undefined;

  const row = (date: string): DailyFields => {
    let r = daily.get(date);
    if (!r) {
      r = {};
      daily.set(date, r);
    }
    return r;
  };

  const keepRaw = (date: string, key: string, value: Record<string, unknown>): void => {
    let bag = rawByDate.get(date);
    if (!bag) {
      bag = {};
      rawByDate.set(date, bag);
    }
    bag[key] = value;
  };

  // region 按天聚合
  for (const [key, items] of Object.entries(payload.aggregated)) {
    for (const item of items) {
      const date = dateOf(item.time);
      if (!date) continue;
      const v = parseItemValue(item.value);
      const r = row(date);
      keepRaw(date, key, v);

      switch (key) {
        case 'steps':
          r.steps = int(v.steps) ?? r.steps;
          r.distanceM = num(v.distance) ?? r.distanceM;
          r.activityCalories = num(v.calories) ?? r.activityCalories;
          break;
        case 'calories':
          // steps 已带 calories 时不覆盖
          r.activityCalories = r.activityCalories ?? num(v.calories);
          break;
        case 'intensity':
          r.intensityMinutes = int(v.duration) ?? r.intensityMinutes;
          break;
        case 'valid_stand':
          r.validStand = int(v.count) ?? r.validStand;
          break;
        case 'heart_rate':
          r.avgHr = int(v.avg_hr) ?? r.avgHr;
          r.restingHr = int(v.avg_rhr) ?? r.restingHr;
          r.maxHr = int(v.max_hr) ?? r.maxHr;
          r.minHr = int(v.min_hr) ?? r.minHr;
          r.abnormalHrCount = int(v.abnormal_hr_count) ?? r.abnormalHrCount;
          r.hrWarmUpMin = int(v.warm_up_hr_zone_duration) ?? r.hrWarmUpMin;
          r.hrFatBurnMin = int(v.fat_burning_hr_zone_duration) ?? r.hrFatBurnMin;
          r.hrAerobicMin = int(v.aerobic_hr_zone_duration) ?? r.hrAerobicMin;
          r.hrAnaerobicMin = int(v.anaerobic_hr_zone_duration) ?? r.hrAnaerobicMin;
          r.hrExtremeMin = int(v.extreme_hr_zone_duration) ?? r.hrExtremeMin;
          break;
        case 'spo2':
          r.avgSpo2 = int(v.avg_spo2) ?? r.avgSpo2;
          r.maxSpo2 = int(v.max_spo2) ?? r.maxSpo2;
          r.minSpo2 = int(v.min_spo2) ?? r.minSpo2;
          break;
        case 'sleep': {
          r.sleepScore = int(v.sleep_score) ?? r.sleepScore;
          r.sleepDuration = int(v.total_duration) ?? r.sleepDuration;
          r.sleepDeep = int(v.sleep_deep_duration) ?? r.sleepDeep;
          r.sleepLight = int(v.sleep_light_duration) ?? r.sleepLight;
          r.sleepRem = int(v.sleep_rem_duration) ?? r.sleepRem;
          r.sleepAwake = int(v.sleep_awake_duration) ?? r.sleepAwake;
          r.sleepAvgHr = int(v.avg_hr) ?? r.sleepAvgHr;
          r.sleepMaxHr = int(v.max_hr) ?? r.sleepMaxHr;
          r.sleepMinHr = int(v.min_hr) ?? r.sleepMinHr;
          r.sleepAvgSpo2 = int(v.avg_spo2) ?? r.sleepAvgSpo2;

          const rawSegments = Array.isArray(v.segment_details) ? v.segment_details : [];
          const parsed: NormalizedSegment[] = [];
          for (const s of rawSegments) {
            if (s === null || typeof s !== 'object') continue;
            const seg = s as Record<string, unknown>;
            const duration = int(seg.duration) ?? 0;
            const bedtime = int(seg.bedtime) ?? 0;
            const wakeUpTime = int(seg.wake_up_time) ?? 0;
            if (duration <= 0 && bedtime <= 0) continue;
            parsed.push({
              date,
              kind: 'nap', // 最长段稍后标记为 main
              bedtime,
              wakeUpTime,
              duration,
              deepMin: int(seg.sleep_deep_duration) ?? 0,
              lightMin: int(seg.sleep_light_duration) ?? 0,
              remMin: int(seg.sleep_rem_duration) ?? 0,
              awakeMin: int(seg.sleep_awake_duration) ?? 0,
              awakeCount: int(seg.awake_count) ?? 0,
              avgHr: int(seg.avg_hr),
              avgSpo2: int(seg.avg_spo2),
            });
          }
          if (parsed.length > 0) {
            // 主睡眠 = 最长段（修复午睡污染入睡/醒来时间）
            let mainIdx = 0;
            for (let i = 1; i < parsed.length; i++) {
              if (parsed[i].duration > parsed[mainIdx].duration) mainIdx = i;
            }
            parsed[mainIdx].kind = 'main';
            r.bedtime = parsed[mainIdx].bedtime || r.bedtime;
            r.wakeTime = parsed[mainIdx].wakeUpTime || r.wakeTime;
            segments.set(date, parsed);
          }
          break;
        }
        case 'stress':
          // 自查模式独有；原始字段名未真机验证，按候选名宽松映射，raw 兜底
          r.stressAvg = pick(v, ['avg_stress', 'stress_avg', 'stress', 'avg']) ?? r.stressAvg;
          r.stressMin = pick(v, ['min_stress', 'stress_min', 'min']) ?? r.stressMin;
          r.stressMax = pick(v, ['max_stress', 'stress_max', 'max']) ?? r.stressMax;
          r.stressRelaxMin = pick(v, ['relax_duration', 'stress_relax_duration', 'relaxed_duration', 'relax_min']) ?? r.stressRelaxMin;
          r.stressMildMin = pick(v, ['mild_duration', 'stress_mild_duration', 'mild_min']) ?? r.stressMildMin;
          r.stressModerateMin = pick(v, ['moderate_duration', 'stress_moderate_duration', 'moderate_min']) ?? r.stressModerateMin;
          r.stressSevereMin = pick(v, ['severe_duration', 'stress_severe_duration', 'severe_min']) ?? r.stressSevereMin;
          break;
        default:
          // 未知 key 仅保留 raw
          break;
      }
    }
  }
  // endregion

  // region 原始测量事件
  for (const item of payload.fitness.weight ?? []) {
    const v = parseItemValue(item.value);
    const time = int(v.time) ?? item.time;
    const date = dateOf(time);
    const weightKg = num(v.weight);
    if (!date || weightKg === undefined || weightKg <= 0) continue;
    weights.push({ time, date, weightKg, bmi: num(v.bmi), bodyFatPct: num(v.body_fat_rate) });
    keepRaw(date, 'weight_event', v);
  }
  for (const item of payload.fitness.blood_pressure ?? []) {
    const v = parseItemValue(item.value);
    const time = int(v.time) ?? item.time;
    const date = dateOf(time);
    if (!date) continue;
    const r = row(date);
    r.systolic = int(v.systolic ?? v.systolic_pressure) ?? r.systolic;
    r.diastolic = int(v.diastolic ?? v.diastolic_pressure) ?? r.diastolic;
    r.pulse = int(v.pulse) ?? r.pulse;
    keepRaw(date, 'blood_pressure_event', v);
  }
  // endregion

  // region 最新快照（目标 / 体重 / 血压）
  for (const item of payload.latest) {
    const v = parseItemValue(item.value);
    const ts = int(v.date_time ?? v.time) ?? item.time;
    const date = dateOf(ts);
    if (!date) continue;
    const r = row(date);
    switch (item.key) {
      case 'goal': {
        const items = Array.isArray(v.goal_items) ? v.goal_items : [];
        for (const g of items) {
          if (g === null || typeof g !== 'object') continue;
          const goal = g as Record<string, unknown>;
          const target = num(goal.target_value);
          const achieved = num(goal.achieved_value);
          switch (int(goal.field)) {
            case 1:
              r.stepsGoal = target === undefined ? r.stepsGoal : Math.trunc(target);
              r.stepsGoalAchieved = achieved === undefined ? r.stepsGoalAchieved : Math.trunc(achieved);
              break;
            case 2:
              r.caloriesGoal = target ?? r.caloriesGoal;
              r.caloriesGoalAchieved = achieved ?? r.caloriesGoalAchieved;
              break;
            case 4:
              r.intensityGoal = target === undefined ? r.intensityGoal : Math.trunc(target);
              r.intensityGoalAchieved = achieved === undefined ? r.intensityGoalAchieved : Math.trunc(achieved);
              break;
          }
        }
        keepRaw(date, 'goal', v);
        break;
      }
      case 'weight': {
        const weightKg = num(v.weight);
        if (weightKg !== undefined && weightKg > 0) r.weightKg = weightKg;
        break;
      }
      case 'blood_pressure':
        r.systolic = int(v.systolic ?? v.systolic_pressure) ?? r.systolic;
        r.diastolic = int(v.diastolic ?? v.diastolic_pressure) ?? r.diastolic;
        r.pulse = int(v.pulse) ?? r.pulse;
        break;
    }
  }
  // endregion

  // raw 汇总写入（仅保留有数据的日期）
  for (const [date, bag] of rawByDate) {
    row(date).raw = JSON.stringify(bag);
  }

  return { daily, segments, weights };
}