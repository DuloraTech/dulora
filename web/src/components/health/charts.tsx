// 健康图表（Recharts 封装）。
// 配色属于健康主题：活动 indigo / 睡眠分期 violet 系 / 心率 rose / 体重 sky / 血氧 cyan / 压力 amber。
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtDuration } from './format';

// region 共享样式
const AXIS_TICK = { fontSize: 11, fill: '#a1a1aa' };
const GRID = { stroke: '#71717a', strokeOpacity: 0.14, strokeDasharray: '3 3' };
const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(24,24,27,0.94)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  fontSize: 12,
  color: '#f4f4f5',
  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  padding: '8px 12px',
};
const TOOLTIP_LABEL: React.CSSProperties = { color: '#a1a1aa', fontSize: 11, marginBottom: 4 };
const CURSOR = { fill: 'rgba(99,102,241,0.06)' };
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

export function LegendChips({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
// endregion

// region 睡眠分期
export const STAGE_META = [
  { key: 'deep', label: '深睡', color: '#4f46e5' },
  { key: 'light', label: '浅睡', color: '#818cf8' },
  { key: 'rem', label: 'REM', color: '#c084fc' },
  { key: 'awake', label: '清醒', color: '#fbbf24' },
] as const;

export interface SleepPoint {
  date: string;
  label: string;
  deep: number;
  light: number;
  rem: number;
  awake: number;
  score: number | null;
}

function SleepTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: SleepPoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const total = p.deep + p.light + p.rem + p.awake;
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={TOOLTIP_LABEL}>
        {p.date} · 共 {fmtDuration(total)}
        {p.score !== null ? ` · 评分 ${p.score}` : ''}
      </div>
      {STAGE_META.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
          <span className="tabular-nums">{fmtDuration(p[s.key])}</span>
        </div>
      ))}
      <div className="mt-1 border-t border-white/10 pt-1 text-[10px] text-zinc-400">点击查看当日睡眠详情</div>
    </div>
  );
}

export function SleepStagesChart({ data, onSelectDate }: { data: SleepPoint[]; onSelectDate?: (date: string) => void }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={MARGIN} barCategoryGap="28%">
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} unit="" />
        <Tooltip content={<SleepTooltip />} cursor={CURSOR} />
        <Bar dataKey="deep" name="深睡" stackId="sleep" fill="#4f46e5" isAnimationActive={false} />
        <Bar dataKey="light" name="浅睡" stackId="sleep" fill="#818cf8" isAnimationActive={false} />
        <Bar dataKey="rem" name="REM" stackId="sleep" fill="#c084fc" isAnimationActive={false} />
        <Bar
          dataKey="awake"
          name="清醒"
          stackId="sleep"
          fill="#fbbf24"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
          className={onSelectDate ? 'cursor-pointer' : undefined}
          onClick={(entry: unknown) => {
            const p = (entry as { payload?: SleepPoint } | null)?.payload;
            if (p?.date && onSelectDate) onSelectDate(p.date);
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
// endregion

// region 步数
export interface StepsPoint {
  date: string;
  label: string;
  steps: number | null;
  goal: number | null;
}

export function StepsChart({ data }: { data: StepsPoint[] }) {
  if (data.length === 0) return null;
  const hasGoal = data.some((d) => d.goal !== null);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={data} margin={MARGIN} barCategoryGap="28%">
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL}
          cursor={CURSOR}
          formatter={(value, name) => [`${Number(value).toLocaleString('zh-CN')} 步`, name === 'goal' ? '目标' : '步数']}
        />
        <Bar dataKey="steps" name="steps" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={26} />
        {hasGoal && (
          <Line dataKey="goal" name="goal" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
// endregion

// region 心率
export interface HrPoint {
  date: string;
  label: string;
  avg: number | null;
  resting: number | null;
}

export function HeartRateChart({ data }: { data: HrPoint[] }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={data} margin={MARGIN}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL}
          formatter={(value, name) => [`${value} bpm`, name === 'resting' ? '静息心率' : '平均心率']}
        />
        <Line dataKey="avg" name="avg" stroke="#f43f5e" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
        <Line dataKey="resting" name="resting" stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
// endregion

// region 体重
export interface WeightPoint {
  label: string;
  weightKg: number;
  bodyFatPct: number | null;
}

export function WeightChart({ data }: { data: WeightPoint[] }) {
  if (data.length === 0) return null;
  const hasFat = data.some((d) => d.bodyFatPct !== null);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={data} margin={MARGIN}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
        <YAxis yAxisId="kg" tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
        {hasFat && <YAxis yAxisId="fat" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={['auto', 'auto']} />}
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL}
          formatter={(value, name) =>
            name === 'bodyFatPct' ? [`${value} %`, '体脂率'] : [`${value} kg`, '体重']
          }
        />
        <Line yAxisId="kg" dataKey="weightKg" name="weightKg" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: '#0ea5e9' }} activeDot={{ r: 4 }} connectNulls />
        {hasFat && (
          <Line yAxisId="fat" dataKey="bodyFatPct" name="bodyFatPct" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
// endregion

// region 血氧
export interface Spo2Point {
  date: string;
  label: string;
  avg: number | null;
}

export function Spo2Chart({ data }: { data: Spo2Point[] }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={data} margin={MARGIN}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={[90, 100]} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} formatter={(value) => [`${value} %`, '平均血氧']} />
        <ReferenceArea y1={95} y2={100} fill="#10b981" fillOpacity={0.06} strokeOpacity={0} ifOverflow="extendDomain" />
        <Line dataKey="avg" name="avg" stroke="#06b6d4" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
// endregion

// region 压力（实验性字段）
export interface StressPoint {
  date: string;
  label: string;
  avg: number | null;
}

export function StressChart({ data }: { data: StressPoint[] }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={data} margin={MARGIN}>
        <defs>
          <linearGradient id="healthStressGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={[0, 100]} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} formatter={(value) => [`${value}`, '平均压力']} />
        <Area dataKey="avg" name="avg" stroke="#f59e0b" strokeWidth={2} fill="url(#healthStressGrad)" dot={false} activeDot={{ r: 4 }} connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  );
}
// endregion

// region 睡眠趋势（详情页：时长柱 + 评分线）
export interface SleepTrendPoint {
  date: string;
  label: string;
  duration: number | null;
  score: number | null;
}

export function SleepTrendChart({ data, onSelectDate }: { data: SleepTrendPoint[]; onSelectDate?: (date: string) => void }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} margin={MARGIN} barCategoryGap="30%">
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis yAxisId="min" tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
        <YAxis yAxisId="score" orientation="right" domain={[0, 100]} hide />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL}
          cursor={CURSOR}
          formatter={(value, name) =>
            name === 'score' ? [`${value} 分`, '睡眠评分'] : [fmtDuration(Number(value)), '睡眠时长']
          }
        />
        <Bar
          yAxisId="min"
          dataKey="duration"
          name="duration"
          fill="#818cf8"
          radius={[3, 3, 0, 0]}
          maxBarSize={22}
          className={onSelectDate ? 'cursor-pointer' : undefined}
          onClick={(entry: unknown) => {
            const p = (entry as { payload?: SleepTrendPoint } | null)?.payload;
            if (p?.date && onSelectDate) onSelectDate(p.date);
          }}
        />
        <Line yAxisId="score" dataKey="score" name="score" stroke="#c084fc" strokeWidth={1.5} dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
// endregion