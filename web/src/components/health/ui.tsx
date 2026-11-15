// 健康模块共享 UI 原语。
// 样式自包含（原生 Tailwind，复刻应用设计系统：indigo 主色 / zinc 中性 / 圆角卡片），
// 不依赖 index.css 中的应用级原子类，保证独立可用。
import { useEffect, type ReactNode } from 'react';
import { IconChevronDown, IconLoader, IconX } from './icons';

// region 类名常量
export const cardCls =
  'rounded-2xl border border-zinc-900/8 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/8 dark:bg-[#121215] dark:shadow-none';

export const btnPrimaryCls =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-500/20 ring-1 ring-inset ring-white/15 transition-all duration-150 hover:bg-indigo-500 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40';

export const btnGhostCls =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200/80 bg-white/70 px-3.5 py-2 text-sm font-medium text-zinc-600 transition-all duration-150 hover:border-zinc-300 hover:bg-zinc-100/70 hover:text-zinc-900 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100';

export const iconBtnCls =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-all duration-150 hover:bg-zinc-200/60 hover:text-zinc-900 active:scale-95 disabled:pointer-events-none disabled:opacity-35 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100';

export const inputCls =
  'rounded-xl border border-zinc-200/90 bg-white px-3.5 py-2 text-sm text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-indigo-400';
// endregion

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`${cardCls} ${className}`}>{children}</div>;
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <IconLoader size={size} className={`animate-spin ${className}`} />;
}

// region 色彩系统（健康主题：活动 indigo / 心率 rose / 血氧 cyan / 体重 sky / 压力 amber / 睡眠 violet）
export type Tint = 'indigo' | 'violet' | 'rose' | 'emerald' | 'sky' | 'cyan' | 'amber' | 'zinc';

export const TINTS: Record<Tint, { bg: string; text: string }> = {
  indigo: { bg: 'bg-indigo-500/10 dark:bg-indigo-500/15', text: 'text-indigo-600 dark:text-indigo-400' },
  violet: { bg: 'bg-violet-500/10 dark:bg-violet-500/15', text: 'text-violet-600 dark:text-violet-400' },
  rose: { bg: 'bg-rose-500/10 dark:bg-rose-500/15', text: 'text-rose-600 dark:text-rose-400' },
  emerald: { bg: 'bg-emerald-500/10 dark:bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400' },
  sky: { bg: 'bg-sky-500/10 dark:bg-sky-500/15', text: 'text-sky-600 dark:text-sky-400' },
  cyan: { bg: 'bg-cyan-500/10 dark:bg-cyan-500/15', text: 'text-cyan-600 dark:text-cyan-400' },
  amber: { bg: 'bg-amber-500/10 dark:bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400' },
  zinc: { bg: 'bg-zinc-500/10 dark:bg-zinc-500/15', text: 'text-zinc-600 dark:text-zinc-400' },
};

export type ChipTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'accent';

const CHIP_TONES: Record<ChipTone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  neutral: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
  accent: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
};

export function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${CHIP_TONES[tone]}`}>
      {children}
    </span>
  );
}
// endregion

export function SectionHeader({
  icon,
  title,
  sub,
  right,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">{title}</h2>
        {sub && <span className="text-xs text-zinc-400 dark:text-zinc-500">{sub}</span>}
      </div>
      {right}
    </div>
  );
}

export function StatCard({
  icon,
  tint = 'indigo',
  label,
  value,
  unit,
  sub,
  onClick,
}: {
  icon: ReactNode;
  tint?: Tint;
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  onClick?: () => void;
}) {
  const t = TINTS[tint];
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${t.bg} ${t.text}`}>{icon}</span>
        {onClick && (
          <span className="text-[11px] text-zinc-300 transition-colors group-hover:text-indigo-500 dark:text-zinc-600 dark:group-hover:text-indigo-400">
            详情 →
          </span>
        )}
      </div>
      <div className="mt-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
          {value}
        </span>
        {unit && <span className="text-xs text-zinc-400 dark:text-zinc-500">{unit}</span>}
      </div>
      {sub && <div className="mt-1 truncate text-xs text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${cardCls} group w-full p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300/60 hover:shadow-md hover:shadow-indigo-500/5 dark:hover:border-indigo-700/60`}
      >
        {inner}
      </button>
    );
  }
  return <div className={`${cardCls} p-4`}>{inner}</div>;
}

export function ProgressBar({
  value,
  max,
  barCls = 'bg-gradient-to-r from-indigo-500 to-violet-500',
}: {
  value: number;
  max: number;
  barCls?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800">
      <div className={`h-full rounded-full transition-all duration-500 ${barCls}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-zinc-100 p-0.5 dark:bg-zinc-800/70">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            'rounded-[10px] px-3 py-1 text-xs font-medium transition-all duration-150',
            o.value === value
              ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-900 dark:text-indigo-300'
              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
        checked ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  options: Array<{ value: number; label: string }>;
  label?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${inputCls} appearance-none py-1.5 pl-3 pr-8 text-xs`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <IconChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-zinc-300 dark:text-zinc-600">{icon}</div>}
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const BANNER_TONES: Record<ChipTone, string> = {
  ok: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  danger: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400',
  info: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  neutral: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
  accent: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
};

export function Banner({
  tone = 'info',
  children,
  onClose,
}: {
  tone?: ChipTone;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div role="status" className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-xs leading-relaxed ${BANNER_TONES[tone]}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="关闭" className="shrink-0 opacity-60 transition-opacity hover:opacity-100">
          <IconX size={14} />
        </button>
      )}
    </div>
  );
}

const MODAL_KEYFRAMES =
  '@keyframes health-modal-pop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}' +
  '@keyframes health-fade{from{opacity:0}to{opacity:1}}';

export function Modal({
  open,
  onClose,
  label,
  children,
  maxWidth = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={label}>
      <style>{MODAL_KEYFRAMES}</style>
      <div
        className="absolute inset-0 bg-zinc-950/45 backdrop-blur-sm"
        style={{ animation: 'health-fade .18s ease-out' }}
        onClick={onClose}
      />
      <div
        className={`${cardCls} relative w-full ${maxWidth} p-6 shadow-xl shadow-zinc-950/10 dark:shadow-black/40`}
        style={{ animation: 'health-modal-pop .22s cubic-bezier(.16,1,.3,1)' }}
      >
        {children}
      </div>
    </div>
  );
}