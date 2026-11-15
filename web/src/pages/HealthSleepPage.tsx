// 睡眠详情页：主睡眠摘要 + 分期构成 + 全部分段（主睡眠/午睡）+ 14 天趋势。
// 路由 /health/sleep?date=yyyy-MM-dd
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { healthApi, type HealthSleepSegment } from '../api/health';
import { addDays, dayLabel, fmtClock, fmtDateTime, fmtDuration, todayStr } from '../components/health/format';
import { IconChevronLeft, IconChevronRight, IconDroplet, IconHeart, IconMoon } from '../components/health/icons';
import { Banner, Card, Chip, EmptyState, SectionHeader, Spinner, btnGhostCls, iconBtnCls } from '../components/health/ui';
import { SleepTrendChart, STAGE_META } from '../components/health/charts';

/** 分期构成条（按时长比例） */
function StageBar({ deep, light, rem, awake }: { deep: number; light: number; rem: number; awake: number }) {
  const total = deep + light + rem + awake;
  if (total <= 0) return <div className="h-2.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />;
  const values = { deep, light, rem, awake };
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      {STAGE_META.map((s) => {
        const v = values[s.key];
        if (v <= 0) return null;
        return (
          <div
            key={s.key}
            style={{ width: `${(v / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.label} ${fmtDuration(v)}`}
          />
        );
      })}
    </div>
  );
}

function StageLegend({ deep, light, rem, awake }: { deep: number; light: number; rem: number; awake: number }) {
  const total = deep + light + rem + awake;
  const values = { deep, light, rem, awake };
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
      {STAGE_META.map((s) => {
        const v = values[s.key];
        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
        return (
          <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-zinc-500 dark:text-zinc-400">{s.label}</span>
            <span className="ml-auto tabular-nums text-zinc-700 dark:text-zinc-300">{fmtDuration(v)}</span>
            <span className="w-9 shrink-0 text-right tabular-nums text-zinc-400">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function SegmentCard({ seg }: { seg: HealthSleepSegment }) {
  const isMain = seg.kind === 'main';
  return (
    <Card className="p-4">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Chip tone={isMain ? 'accent' : 'neutral'}>{isMain ? '主睡眠' : '午睡'}</Chip>
        <span className="text-sm font-medium tabular-nums">
          {fmtDateTime(seg.bedtime)} → {fmtClock(seg.wakeUpTime)}
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums text-violet-600 dark:text-violet-400">
          {fmtDuration(seg.duration)}
        </span>
      </div>
      <StageBar deep={seg.deepMin} light={seg.lightMin} rem={seg.remMin} awake={seg.awakeMin} />
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400 dark:text-zinc-500">
        <span>深睡 {fmtDuration(seg.deepMin)}</span>
        <span>浅睡 {fmtDuration(seg.lightMin)}</span>
        <span>REM {fmtDuration(seg.remMin)}</span>
        <span>清醒 {fmtDuration(seg.awakeMin)}（{seg.awakeCount} 次）</span>
        {seg.avgHr !== null && (
          <span className="inline-flex items-center gap-1">
            <IconHeart size={12} className="text-rose-400" /> {seg.avgHr} bpm
          </span>
        )}
        {seg.avgSpo2 !== null && (
          <span className="inline-flex items-center gap-1">
            <IconDroplet size={12} className="text-cyan-400" /> {seg.avgSpo2}%
          </span>
        )}
      </div>
    </Card>
  );
}

export function HealthSleepPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayStr();
  const rawDate = searchParams.get('date');
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today;

  const detailQ = useQuery({
    queryKey: ['health', 'sleep', date],
    queryFn: () => healthApi.sleep(date),
  });

  const trendFrom = addDays(date, -13);
  const trendQ = useQuery({
    queryKey: ['health', 'daily', trendFrom, date],
    queryFn: () => healthApi.daily(trendFrom, date),
  });

  const trendData = useMemo(
    () =>
      (trendQ.data ?? []).map((d) => ({
        date: d.date,
        label: dayLabel(d.date),
        duration: d.sleepDuration,
        score: d.sleepScore,
      })),
    [trendQ.data],
  );

  const daily = detailQ.data?.daily ?? null;
  const segments = detailQ.data?.segments ?? [];
  const main = segments.find((s) => s.kind === 'main') ?? null;
  const napCount = segments.filter((s) => s.kind !== 'main').length;

  const bedtime = main?.bedtime ?? daily?.bedtime ?? null;
  const wakeTime = main?.wakeUpTime ?? daily?.wakeTime ?? null;
  const stages = {
    deep: daily?.sleepDeep ?? main?.deepMin ?? 0,
    light: daily?.sleepLight ?? main?.lightMin ?? 0,
    rem: daily?.sleepRem ?? main?.remMin ?? 0,
    awake: daily?.sleepAwake ?? main?.awakeMin ?? 0,
  };

  const weekday = new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' });
  const goDate = (d: string) => setSearchParams({ date: d });
  const hasData = daily !== null || segments.length > 0;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      {/* 页头 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to="/health" className={iconBtnCls} aria-label="返回健康" title="返回健康">
            <IconChevronLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">睡眠详情</h1>
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              {date} {weekday}
              {napCount > 0 ? ` · 含 ${napCount} 段午睡，主睡眠取最长段` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => goDate(addDays(date, -1))} className={iconBtnCls} aria-label="前一天" title="前一天">
            <IconChevronLeft size={16} />
          </button>
          {date !== today && (
            <button type="button" onClick={() => goDate(today)} className={`${btnGhostCls} px-3 py-1.5 text-xs`}>
              今天
            </button>
          )}
          <button
            type="button"
            onClick={() => goDate(addDays(date, 1))}
            disabled={date >= today}
            className={iconBtnCls}
            aria-label="后一天"
            title="后一天"
          >
            <IconChevronRight size={16} />
          </button>
        </div>
      </div>

      {detailQ.isLoading ? (
        <div className="flex items-center justify-center py-24 text-zinc-400">
          <Spinner size={22} />
        </div>
      ) : detailQ.isError ? (
        <Banner tone="danger">
          加载失败：{(detailQ.error as Error).message}
          <button type="button" onClick={() => detailQ.refetch()} className="ml-2 font-medium underline underline-offset-2">
            重试
          </button>
        </Banner>
      ) : !hasData ? (
        <Card>
          <EmptyState
            icon={<IconMoon size={32} />}
            title="该日没有睡眠数据"
            hint="可能未佩戴设备入睡，或数据尚未同步。试试切换日期，或返回健康页手动同步。"
            action={
              <Link to="/health" className={`${btnGhostCls} px-3 py-1.5 text-xs`}>
                返回健康页
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* 主睡眠摘要 */}
          <Card className="p-5">
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex items-center gap-4">
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full -rotate-90">
                    <circle cx="40" cy="40" r="34" fill="none" strokeWidth="7" className="stroke-zinc-100 dark:stroke-zinc-800" />
                    <circle
                      cx="40"
                      cy="40"
                      r="34"
                      fill="none"
                      strokeWidth="7"
                      strokeLinecap="round"
                      stroke="#8b5cf6"
                      strokeDasharray={`${((daily?.sleepScore ?? 0) / 100) * 213.6} 213.6`}
                    />
                  </svg>
                  <div className="text-center">
                    <div className="text-xl font-bold tabular-nums leading-none">{daily?.sleepScore ?? '—'}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-400">评分</div>
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums tracking-tight">
                    {fmtDuration(daily?.sleepDuration ?? main?.duration)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    {bedtime && wakeTime ? `${fmtDateTime(bedtime)} 入睡 → ${fmtClock(wakeTime)} 醒来` : '总睡眠时长'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(daily?.sleepAvgHr ?? main?.avgHr) !== null && (daily?.sleepAvgHr ?? main?.avgHr) !== undefined && (
                      <Chip tone="danger">
                        <IconHeart size={11} /> 平均心率 {daily?.sleepAvgHr ?? main?.avgHr} bpm
                      </Chip>
                    )}
                    {(daily?.sleepAvgSpo2 ?? main?.avgSpo2) !== null && (daily?.sleepAvgSpo2 ?? main?.avgSpo2) !== undefined && (
                      <Chip tone="info">
                        <IconDroplet size={11} /> 平均血氧 {daily?.sleepAvgSpo2 ?? main?.avgSpo2}%
                      </Chip>
                    )}
                  </div>
                </div>
              </div>
              <div className="min-w-[240px] flex-1 space-y-3">
                <StageBar {...stages} />
                <StageLegend {...stages} />
              </div>
            </div>
          </Card>

          {/* 全部分段 */}
          {segments.length > 0 && (
            <div>
              <SectionHeader
                icon={<IconMoon size={16} className="text-violet-500 dark:text-violet-400" />}
                title="睡眠分段"
                sub={`${segments.length} 段`}
              />
              <div className="space-y-3">
                {segments.map((seg) => (
                  <SegmentCard key={seg.id} seg={seg} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 14 天趋势 */}
      <Card className="mt-4 p-5">
        <SectionHeader
          icon={<IconMoon size={16} className="text-violet-500 dark:text-violet-400" />}
          title="近 14 天睡眠趋势"
          sub="柱为时长 · 线为评分 · 点击切换日期"
        />
        {trendQ.isLoading ? (
          <div className="flex items-center justify-center py-10 text-zinc-400">
            <Spinner size={18} />
          </div>
        ) : trendData.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-400">近 14 天暂无睡眠数据</p>
        ) : (
          <SleepTrendChart data={trendData} onSelectDate={goDate} />
        )}
      </Card>
    </div>
  );
}