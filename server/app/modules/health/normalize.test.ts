/**
 * 归一化测试：时区对齐（修复参考项目 UTC 偏移）、主睡眠提取、字段映射。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSync, type SyncPayload } from './normalize';
import type { RawDataItem, RawLatestItem } from './xiaomi/types';

const TZ = 'Asia/Shanghai';

function item(key: string, time: number, value: unknown): RawDataItem {
  return {
    sid: 'miothealth',
    tag: 'daily_report',
    key,
    time,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    updateTime: time,
    watermark: '',
  };
}

function payload(partial: Partial<SyncPayload>): SyncPayload {
  return { aggregated: {}, fitness: {}, latest: [], ...partial };
}

// 1699977600 = 2023-11-15 00:00:00 +08（= 2023-11-14 16:00 UTC）
const DAY_START = 1699977600;

test('日期按 Asia/Shanghai 归一化（跨零点不偏移）', () => {
  const result = normalizeSync(
    payload({
      aggregated: {
        steps: [
          item('steps', DAY_START, { steps: 100 }), // +08 的 11-15 00:00
          item('steps', DAY_START - 1, { steps: 200 }), // +08 的 11-14 23:59:59（UTC 仍是 11-14）
        ],
      },
    }),
    TZ,
  );
  assert.equal(result.daily.get('2023-11-15')?.steps, 100);
  assert.equal(result.daily.get('2023-11-14')?.steps, 200);
});

test('步数/距离/卡路里映射', () => {
  const result = normalizeSync(
    payload({ aggregated: { steps: [item('steps', DAY_START, { steps: 12345, distance: 8000, calories: 400 })] } }),
    TZ,
  );
  const row = result.daily.get('2023-11-15');
  assert.equal(row?.steps, 12345);
  assert.equal(row?.distanceM, 8000);
  assert.equal(row?.activityCalories, 400);
});

test('心率区间与静息心率映射', () => {
  const result = normalizeSync(
    payload({
      aggregated: {
        heart_rate: [
          item('heart_rate', DAY_START, {
            avg_hr: 75,
            avg_rhr: 60,
            max_hr: 130,
            min_hr: 50,
            abnormal_hr_count: 1,
            warm_up_hr_zone_duration: 300,
            fat_burning_hr_zone_duration: 20,
            aerobic_hr_zone_duration: 5,
            anaerobic_hr_zone_duration: 0,
            extreme_hr_zone_duration: 0,
          }),
        ],
      },
    }),
    TZ,
  );
  const row = result.daily.get('2023-11-15');
  assert.equal(row?.avgHr, 75);
  assert.equal(row?.restingHr, 60);
  assert.equal(row?.hrWarmUpMin, 300);
  assert.equal(row?.hrFatBurnMin, 20);
  assert.equal(row?.abnormalHrCount, 1);
});

test('睡眠：最长段为主睡眠，午睡不污染入睡/醒来，全分段保留', () => {
  const nap = { bedtime: DAY_START + 13 * 3600, wake_up_time: DAY_START + 13 * 3600 + 1800, duration: 30, sleep_deep_duration: 0, sleep_light_duration: 30 };
  const main = { bedtime: DAY_START + 0 * 3600, wake_up_time: DAY_START + 7 * 3600, duration: 420, sleep_deep_duration: 120, sleep_light_duration: 180, sleep_rem_duration: 100, sleep_awake_duration: 20, awake_count: 3, avg_hr: 60, avg_spo2: 97 };
  const result = normalizeSync(
    payload({
      aggregated: {
        sleep: [
          item('sleep', DAY_START, {
            total_duration: 450,
            sleep_score: 80,
            sleep_deep_duration: 120,
            sleep_light_duration: 210,
            sleep_rem_duration: 100,
            sleep_awake_duration: 20,
            avg_hr: 60,
            avg_spo2: 97,
            segment_details: [nap, main], // 故意把午睡放前面
          }),
        ],
      },
    }),
    TZ,
  );
  const row = result.daily.get('2023-11-15');
  assert.equal(row?.sleepScore, 80);
  assert.equal(row?.sleepDuration, 450);
  assert.equal(row?.bedtime, main.bedtime);
  assert.equal(row?.wakeTime, main.wake_up_time);
  const segs = result.segments.get('2023-11-15');
  assert.equal(segs?.length, 2);
  assert.equal(segs?.filter((s) => s.kind === 'main').length, 1);
  assert.equal(segs?.find((s) => s.kind === 'main')?.duration, 420);
  assert.equal(segs?.find((s) => s.kind === 'nap')?.duration, 30);
});

test('血氧摘要映射', () => {
  const result = normalizeSync(
    payload({ aggregated: { spo2: [item('spo2', DAY_START, { avg_spo2: 96, max_spo2: 99, min_spo2: 92 })] } }),
    TZ,
  );
  const row = result.daily.get('2023-11-15');
  assert.equal(row?.avgSpo2, 96);
  assert.equal(row?.maxSpo2, 99);
  assert.equal(row?.minSpo2, 92);
});

test('体重事件：体脂率仅原始测量有；非法体重跳过', () => {
  const result = normalizeSync(
    payload({
      fitness: {
        weight: [
          item('weight', DAY_START + 3600, { time: DAY_START + 3600, weight: 65.5, bmi: 22.0, body_fat_rate: 18.0 }),
          item('weight', DAY_START + 7200, { time: DAY_START + 7200, weight: 0 }),
        ],
      },
    }),
    TZ,
  );
  assert.equal(result.weights.length, 1);
  assert.equal(result.weights[0].weightKg, 65.5);
  assert.equal(result.weights[0].bodyFatPct, 18.0);
  assert.equal(result.weights[0].date, '2023-11-15');
});

test('latest 快照：目标 field 1/2/4 与血压别名', () => {
  const latest: RawLatestItem[] = [
    {
      time: DAY_START,
      key: 'goal',
      value: JSON.stringify({
        date_time: DAY_START,
        goal_items: [
          { field: 1, target_value: 8000, achieved_value: 5000 },
          { field: 2, target_value: 300, achieved_value: 200 },
          { field: 4, target_value: 30, achieved_value: 10 },
          { field: 99, target_value: 1, achieved_value: 1 },
        ],
      }),
    },
    { time: DAY_START, key: 'blood_pressure', value: JSON.stringify({ systolic_pressure: 120, diastolic_pressure: 80, pulse: 72, time: DAY_START }) },
    { time: DAY_START, key: 'weight', value: JSON.stringify({ weight: 65.0, time: DAY_START }) },
  ];
  const result = normalizeSync(payload({ latest }), TZ);
  const row = result.daily.get('2023-11-15');
  assert.equal(row?.stepsGoal, 8000);
  assert.equal(row?.stepsGoalAchieved, 5000);
  assert.equal(row?.caloriesGoal, 300);
  assert.equal(row?.intensityGoal, 30);
  assert.equal(row?.systolic, 120);
  assert.equal(row?.diastolic, 80);
  assert.equal(row?.pulse, 72);
  assert.equal(row?.weightKg, 65.0);
});

test('压力候选字段映射 + raw 兜底', () => {
  const result = normalizeSync(
    payload({ aggregated: { stress: [item('stress', DAY_START, { avg_stress: 45, relax_duration: 120, mild_duration: 60, moderate_duration: 30, severe_duration: 5 })] } }),
    TZ,
  );
  const row = result.daily.get('2023-11-15');
  assert.equal(row?.stressAvg, 45);
  assert.equal(row?.stressRelaxMin, 120);
  assert.equal(row?.stressSevereMin, 5);
  assert.ok(row?.raw?.includes('avg_stress'));
});

test('脏数据跳过：time 缺失/非法 JSON 不崩', () => {
  const result = normalizeSync(
    payload({
      aggregated: {
        steps: [item('steps', 0, { steps: 1 }), item('steps', DAY_START, 'not-json')],
      },
    }),
    TZ,
  );
  // time=0 跳过；非法 JSON 保留日期行但无 steps
  assert.equal(result.daily.size, 1);
  assert.equal(result.daily.get('2023-11-15')?.steps, undefined);
});

test('calories 独立指标兜底（steps 未带 calories 时）', () => {
  const result = normalizeSync(
    payload({ aggregated: { calories: [item('calories', DAY_START, { calories: 500, goal: 300 })] } }),
    TZ,
  );
  assert.equal(result.daily.get('2023-11-15')?.activityCalories, 500);
});