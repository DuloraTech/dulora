/**
 * 客户端时间窗与数据项宽松解析测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStartTs, windowTs } from './client';
import { coerceDataItems, coerceLatestItems, parseItemValue } from './types';

test('dayStartTs 按 UTC+8 自然日', () => {
  // 2023-11-15 00:00:00 +08 == 2023-11-14 16:00:00 UTC == 1700006400? 验证：
  // 1700000000 = 2023-11-14 22:13:20 UTC = 2023-11-15 06:13:20 +08
  assert.equal(dayStartTs('2023-11-15'), 1699977600); // 2023-11-14T16:00:00Z
  assert.equal(dayStartTs('1970-01-01'), -28800);
});

test('windowTs 含首尾的 N 天窗口', () => {
  const { start, end } = windowTs('2023-11-15', 7);
  assert.equal(end, dayStartTs('2023-11-15') + 86399);
  assert.equal(start, end - 86400 * 7 + 1);
  assert.equal(end - start + 1, 86400 * 7);
  // days 至少为 1
  const one = windowTs('2023-11-15', 0);
  assert.equal(one.end - one.start + 1, 86400);
});

test('dayStartTs 拒绝非法日期', () => {
  assert.throws(() => dayStartTs('2023-1-5'));
  assert.throws(() => dayStartTs(''));
});

test('coerceDataItems 宽松解析：value 对象/数字 watermark/脏数据', () => {
  const items = coerceDataItems([
    { sid: 's', tag: 'daily_report', key: 'steps', time: 1700000000, value: { steps: 10 }, update_time: 1700000100, watermark: 42 },
    { key: 'sleep', time: '1700000000', value: '{"total_duration":420}' },
    null,
    'garbage',
    { key: 'x', value: null },
  ]);
  assert.equal(items.length, 3);
  assert.equal(items[0].value, '{"steps":10}');
  assert.equal(items[0].watermark, '42');
  assert.equal(items[1].time, 1700000000);
  assert.equal(items[2].value, '');
});

test('coerceLatestItems 与 parseItemValue', () => {
  const items = coerceLatestItems([
    { time: 1, key: 'weight', value: { weight: 65.5 } },
    { time: 2, key: 'spo2', value: '{"spo2":97}' },
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(parseItemValue(items[0].value), { weight: 65.5 });
  assert.deepEqual(parseItemValue(items[1].value), { spo2: 97 });
  assert.deepEqual(parseItemValue('not json'), {});
  assert.deepEqual(parseItemValue('[1,2]'), {});
});