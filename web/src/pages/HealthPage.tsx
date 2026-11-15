// 健康仪表盘：状态概览 + 今日卡片 + 趋势图表 + 数据源管理。
// 数据源：/api/health-data/*（小米运动健康同步，后端 modules/health）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { healthApi, type HealthDaily, type SyncHealth } from '../api/health';
import { addDays, dayLabel, fmtClock, fmtDuration, fmtNum, timeAgo, todayStr } from '../components/health/format';
import {
  IconActivity,
  IconAlert,
  IconDroplet,
  IconGauge,
  IconHeart,
  IconHeartPulse,
  IconMoon,
  IconRefresh,
  IconScale,
  IconZap,
} from '../components/health/icons';
import {
  Banner,
  Card,
  Chip,
  EmptyState,
  ProgressBar,
  Segmented,
  SectionHeader,
  Spinner,
  StatCard,
  btnPrimaryCls,
  type ChipTone,
} from '../components/health/ui';
import {
  HeartRateChart,
  LegendChips,
  SleepStagesChart,
  Spo2Chart,
  StepsChart,
  StressChart,
  WeightChart,
  STAGE_META,
} from '../components/health/charts';
import { DataSourcePanel } from '../components/health/DataSourcePanel';
import { QrLoginDialog } from '../components/health/QrLoginDialog';

const RANGE_OPTIONS = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
] as const;

const SYNC_HEALTH_META: Record<SyncHealth, { tone: ChipTone; label: string }> = {
  disconnected: { tone: 'neutral', label: '未连接' },
  never_synced: { tone: 'info', label: '待首次同步' },
  ok: { tone: 'ok', label: '已同步' },
  stale: { tone: 'warn', label: '同步过期' },
  broken: { tone: 'danger', label: '同步异常' },
};

export function HealthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [range, setRange] = useState<number>(30);
  const [loginOpen, setLoginOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: ChipTone; text: string } | null>(null);

  const to = todayStr();
  const from = addDays(to, -(range - 1));

  const statusQ = useQuery({
    queryKey: ['health', 'status'],
    queryFn: healthApi.status,
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : 60_000),
  });
  const status = statusQ.data;
  const connected = !!status?.account;

  const dailyQ = useQuery({
    queryKey: ['health', 'daily', from, to],
    queryFn: () => healthApi.daily(from, to),
    enabled: connected,
  });
  const weightQ = useQuery({
    queryKey: ['health', 'weight', range],
    queryFn: () => healthApi.weight(range),
    enabled: connected,
  });

  const daily = useMemo(() => dailyQ.data ?? [], [dailyQ.data]);
  const weights = weightQ.data ?? [];
  const today: HealthDaily | null = daily.find((d) => d.date === to) ?? null;

  const syncMutation = useMutation({
    mutationFn: () => healthApi.sync(range),
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ['health'] });
      const skipped = summary.warnings.map((w) => w.split(':')[0]).join('、');
      setToast({
        tone: summary.warnings.length > 0 ? 'warn' : 'ok',
        text: `同步完成：写入 ${summary.daysWritten} 天数据` + (skipped ? `（${skipped} 暂无数据或不可用，已跳过）` : ''),
      });
    },
    onError: (e: Error) => {
      // 失败可能已把账号置为 needs_relogin / syncHealth 置为 broken，立即刷新状态以呈现重新扫码引导
      queryClient.invalidateQueries({ queryKey: ['health', 'status'] });
      setToast({ tone: 'danger', text: e.message });
    },
  });

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // 后台同步（定时/登录后自动）结束时刷新数据
  const syncing = status?.syncing ?? false;
  const prevSyncing = useRef(false);
  useEffect(() => {
    if (prevSyncing.current && !syncing) {
      queryClient.invalidateQueries({ queryKey: ['health', 'daily'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'weight'] });
    }
    prevSyncing.current = syncing;
  }, [syncing, queryClient]);

  const handleLoginSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['health'] });
    setToast({ tone: 'ok', text: '连接成功，正在自动同步最近数据…' });
  }, [queryClient]);

  // region 图表数据
  const stepsData = useMemo(
    () => daily.map((d) => ({ date: d.date, label: dayLabel(d.date), steps: d.steps, goal: d.stepsGoal })),
    [daily],
  );
  const sleepData = useMemo(
    () =>
      daily
        .filter((d) => d.sleepDuration !== null)
        .map((d) => ({
          date: d.date,
          label: dayLabel(d.date),
          deep: d.sleepDeep ?? 0,
          light: d.sleepLight ?? 0,
          rem: d.sleepRem ?? 0,
          awake: d.sleepAwake ?? 0,
          score: d.sleepScore,
        })),
    [daily],
  );
  const hrData = useMemo(
    () =>
      daily
        .filter((d) => d.avgHr !== null || d.restingHr !== null)
        .map((d) => ({ date: d.date, label: dayLabel(d.date), avg: d.avgHr, resting: d.restingHr })),
    [daily],
  );
  const spo2Data = useMemo(
    () =>
      daily
        .filter((d) => d.avgSpo2 !== null)
        .map((d) => ({ date: d.date, label: dayLabel(d.date), avg: d.avgSpo2 })),
    [daily],
  );
  const stressData = useMemo(
    () =>
      daily
        .filter((d) => d.stressAvg !== null)
        .map((d) => ({ date: d.date, label: dayLabel(d.date), avg: d.stressAvg })),
    [daily],
  );
  const weightData = useMemo(
    () => weights.map((w) => ({ label: dayLabel(w.date), weightKg: w.weightKg, bodyFatPct: w.bodyFatPct })),
    [weights],
  );
  // endregion

  const hasSteps = stepsData.some((d) => d.steps !== null);
  const lastWeight = weights.length > 0 ? weights[weights.length - 1] : null;
  const weightValue = lastWeight?.weightKg ?? today?.weightKg ?? null;
  const syncMeta = status ? SYNC_HEALTH_META[status.syncHealth] : null;
  const busy = syncMutation.isPending || syncing;

  // region 今日卡片
  const stepsGoalPct =
    today?.steps !== null && today?.stepsGoal ? Math.round(((today?.steps ?? 0) / today.stepsGoal) * 100) : null;
  const sleepHours = today?.sleepDuration ? (today.sleepDuration / 60).toFixed(1) : null;
  // endregion

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      {/* 页头 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">健康</h1>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            小米运动健康 · 数据仅存储在本机
            {connected && status?.account?.lastSyncAt ? ` · 上次同步 ${timeAgo(status.account.lastSyncAt)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {syncMeta && <Chip tone={syncMeta.tone}>{syncMeta.label}</Chip>}
          <Segmented options={[...RANGE_OPTIONS]} value={range} onChange={setRange} />
          {connected && (
            <button
              type="button"
              disabled={busy}
              onClick={() => syncMutation.mutate()}
              className={`${btnPrimaryCls} px-3 py-1.5 text-xs`}
            >
              {busy ? <Spinner size={14} /> : <IconRefresh size={14} />}
              {busy ? '同步中…' : '立即同步'}
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="mb-4">
          <Banner tone={toast.tone} onClose={() => setToast(null)}>
            {toast.text}
          </Banner>
        </div>
      )}

      {/* 加载 / 错误 */}
      {statusQ.isLoading && (
        <div className="flex items-center justify-center py-24 text-zinc-400">
          <Spinner size={22} />
        </div>
      )}
      {statusQ.isError && (
        <Banner tone="danger">
          加载健康状态失败：{(statusQ.error as Error).message}
          <button type="button" onClick={() => statusQ.refetch()} className="ml-2 font-medium underline underline-offset-2">
            重试
          </button>
        </Banner>
      )}

      {/* 未连接：引导 */}
      {status && !connected && (
        <>
          <Card>
            <EmptyState
              icon={<IconHeartPulse size={36} />}
              title="连接小米账号，开始记录健康趋势"
              hint="扫码登录后自动同步步数、睡眠、心率、血氧、体重与压力数据，按日记日期对齐，全部保存在本机。"
              action={
                <button type="button" onClick={() => setLoginOpen(true)} className={btnPrimaryCls}>
                  <IconHeartPulse size={16} /> 扫码连接小米账号
                </button>
              }
            />
          </Card>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { icon: <IconRefresh size={16} />, title: '自动同步', desc: '后台定时拉取，凭证过期自动续期' },
              { icon: <IconMoon size={16} />, title: '睡眠分期', desc: '深睡 / 浅睡 / REM / 清醒，逐日明细' },
              { icon: <IconActivity size={16} />, title: '多维趋势', desc: '7 / 30 / 90 天图表，与日记日期对齐' },
            ].map((f) => (
              <Card key={f.title} className="flex items-start gap-3 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
                  {f.icon}
                </span>
                <div>
                  <p className="text-xs font-semibold">{f.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{f.desc}</p>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* 已连接：仪表盘 */}
      {connected && (
        <div className="space-y-4">
          {status?.syncHealth === 'broken' && (
            <Banner tone="danger">
              <span className="inline-flex items-center gap-1.5">
                <IconAlert size={13} />
                同步异常{status.lastRun?.error ? `：${status.lastRun.error}` : ''}。若凭证失效请在下方重新扫码。
              </span>
            </Banner>
          )}
          {status?.syncHealth === 'stale' && (
            <Banner tone="warn">数据已过期（超过两个同步周期未更新），建议点击「立即同步」。</Banner>
          )}

          {dailyQ.isLoading ? (
            <div className="flex items-center justify-center py-24 text-zinc-400">
              <Spinner size={22} />
            </div>
          ) : daily.length === 0 && weights.length === 0 ? (
            <Card>
              <EmptyState
                icon={<IconActivity size={32} />}
                title="暂无健康数据"
                hint={`点击「立即同步」拉取最近 ${range} 天数据。首次同步通常需要几十秒。`}
                action={
                  <button type="button" disabled={busy} onClick={() => syncMutation.mutate()} className={btnPrimaryCls}>
                    {busy ? <Spinner size={15} /> : <IconRefresh size={15} />} 立即同步
                  </button>
                }
              />
            </Card>
          ) : (
            <>
              {/* 今日概览 */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <StatCard
                  icon={<IconActivity size={17} />}
                  tint="indigo"
                  label="今日步数"
                  value={fmtNum(today?.steps)}
                  unit="步"
                  sub={
                    today?.stepsGoal ? (
                      <span className="block space-y-1">
                        <ProgressBar value={today?.steps ?? 0} max={today.stepsGoal} />
                        <span className="block">
                          目标 {fmtNum(today.stepsGoal)} · {stepsGoalPct}%
                        </span>
                      </span>
                    ) : today?.distanceM ? (
                      `${(today.distanceM / 1000).toFixed(2)} km · ${fmtNum(today.activityCalories)} 千卡`
                    ) : (
                      '暂无目标'
                    )
                  }
                />
                <StatCard
                  icon={<IconMoon size={17} />}
                  tint="violet"
                  label="昨晚睡眠"
                  value={sleepHours ?? '—'}
                  unit={sleepHours ? '小时' : undefined}
                  sub={
                    today?.sleepScore !== null && today?.sleepScore !== undefined
                      ? `评分 ${today.sleepScore}${today.bedtime && today.wakeTime ? ` · ${fmtClock(today.bedtime)} → ${fmtClock(today.wakeTime)}` : ''}`
                      : '点击查看详情'
                  }
                  onClick={() => navigate(`/health/sleep?date=${to}`)}
                />
                <StatCard
                  icon={<IconHeart size={17} />}
                  tint="rose"
                  label="心率"
                  value={fmtNum(today?.restingHr ?? today?.avgHr)}
                  unit="bpm"
                  sub={
                    today?.avgHr
                      ? `平均 ${today.avgHr}${today.minHr && today.maxHr ? ` · ${today.minHr}–${today.maxHr}` : ''}`
                      : '静息 / 平均'
                  }
                />
                <StatCard
                  icon={<IconScale size={17} />}
                  tint="sky"
                  label="体重"
                  value={weightValue !== null ? weightValue.toFixed(1) : '—'}
                  unit={weightValue !== null ? 'kg' : undefined}
                  sub={
                    lastWeight?.bodyFatPct
                      ? `体脂 ${lastWeight.bodyFatPct.toFixed(1)}%${lastWeight.bmi ? ` · BMI ${lastWeight.bmi.toFixed(1)}` : ''}`
                      : lastWeight?.bmi
                        ? `BMI ${lastWeight.bmi.toFixed(1)}`
                        : '最近一次测量'
                  }
                />
                <StatCard
                  icon={<IconDroplet size={17} />}
                  tint="cyan"
                  label="血氧"
                  value={fmtNum(today?.avgSpo2)}
                  unit={today?.avgSpo2 ? '%' : undefined}
                  sub={today?.minSpo2 && today?.maxSpo2 ? `范围 ${today.minSpo2}–${today.maxSpo2}%` : '平均血氧饱和度'}
                />
                {today?.stressAvg !== null && today?.stressAvg !== undefined ? (
                  <StatCard
                    icon={<IconGauge size={17} />}
                    tint="amber"
                    label="压力"
                    value={fmtNum(today.stressAvg)}
                    sub={
                      today.stressRelaxMin !== null
                        ? `放松 ${fmtDuration(today.stressRelaxMin)}`
                        : '实验性指标'
                    }
                  />
                ) : today?.systolic ? (
                  <StatCard
                    icon={<IconZap size={17} />}
                    tint="amber"
                    label="血压"
                    value={`${today.systolic}/${today.diastolic ?? '—'}`}
                    unit="mmHg"
                    sub={today.pulse ? `脉搏 ${today.pulse} bpm` : '最近一次测量'}
                  />
                ) : (
                  <StatCard
                    icon={<IconZap size={17} />}
                    tint="amber"
                    label="活动消耗"
                    value={fmtNum(today?.activityCalories)}
                    unit={today?.activityCalories ? '千卡' : undefined}
                    sub={today?.intensityMinutes ? `中高强度 ${fmtDuration(today.intensityMinutes)}` : '卡路里 / 强度'}
                  />
                )}
              </div>

              {/* 步数 */}
              {hasSteps && (
                <Card className="p-5">
                  <SectionHeader
                    icon={<IconActivity size={16} className="text-indigo-500 dark:text-indigo-400" />}
                    title="步数趋势"
                    sub={`最近 ${range} 天`}
                    right={<LegendChips items={[{ color: '#6366f1', label: '步数' }, { color: '#a1a1aa', label: '目标' }]} />}
                  />
                  <StepsChart data={stepsData} />
                </Card>
              )}

              {/* 睡眠 */}
              {sleepData.length > 0 && (
                <Card className="p-5">
                  <SectionHeader
                    icon={<IconMoon size={16} className="text-violet-500 dark:text-violet-400" />}
                    title="睡眠分期"
                    sub="点击柱状图查看当日明细"
                    right={<LegendChips items={STAGE_META.map((s) => ({ color: s.color, label: s.label }))} />}
                  />
                  <SleepStagesChart data={sleepData} onSelectDate={(date) => navigate(`/health/sleep?date=${date}`)} />
                </Card>
              )}

              {/* 心率 / 体重 / 血氧 / 压力 */}
              <div className="grid gap-4 lg:grid-cols-2">
                {hrData.length > 0 && (
                  <Card className="p-5">
                    <SectionHeader
                      icon={<IconHeart size={16} className="text-rose-500 dark:text-rose-400" />}
                      title="心率"
                      right={<LegendChips items={[{ color: '#f43f5e', label: '平均' }, { color: '#10b981', label: '静息' }]} />}
                    />
                    <HeartRateChart data={hrData} />
                  </Card>
                )}
                {weightData.length > 0 && (
                  <Card className="p-5">
                    <SectionHeader
                      icon={<IconScale size={16} className="text-sky-500 dark:text-sky-400" />}
                      title="体重"
                      right={
                        <LegendChips
                          items={[
                            { color: '#0ea5e9', label: '体重 kg' },
                            ...(weightData.some((w) => w.bodyFatPct !== null) ? [{ color: '#f59e0b', label: '体脂率 %' }] : []),
                          ]}
                        />
                      }
                    />
                    <WeightChart data={weightData} />
                  </Card>
                )}
                {spo2Data.length > 0 && (
                  <Card className="p-5">
                    <SectionHeader
                      icon={<IconDroplet size={16} className="text-cyan-500 dark:text-cyan-400" />}
                      title="血氧"
                      sub="绿色区间为正常范围 95–100%"
                    />
                    <Spo2Chart data={spo2Data} />
                  </Card>
                )}
                {stressData.length > 0 && (
                  <Card className="p-5">
                    <SectionHeader
                      icon={<IconGauge size={16} className="text-amber-500 dark:text-amber-400" />}
                      title="压力"
                      right={<Chip tone="warn">实验性</Chip>}
                    />
                    <StressChart data={stressData} />
                  </Card>
                )}
              </div>
            </>
          )}

          {/* 数据源管理 */}
          {status && <DataSourcePanel status={status} onOpenLogin={() => setLoginOpen(true)} />}
        </div>
      )}

      <QrLoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={handleLoginSuccess} />
    </div>
  );
}