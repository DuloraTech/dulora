// 健康数据显示助手：日期/时长/相对时间格式化（纯函数）。

/** 浏览器本地 yyyy-MM-dd（中国用户与服务端 Asia/Shanghai 一致） */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** yyyy-MM-dd → MM-dd（图表轴标签） */
export function dayLabel(date: string): string {
  return date.slice(5);
}

/** epoch 秒 → HH:mm */
export function fmtClock(tsSec: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(tsSec * 1000),
  );
}

/** epoch 秒 → MM-dd HH:mm */
export function fmtDateTime(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd} ${fmtClock(tsSec)}`;
}

/** 分钟 → 「7小时20分」 */
export function fmtDuration(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min) || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}分钟`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分`;
}

/** ISO 时间 → 相对时间 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '从未';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '未知';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/** 小米 userId 脱敏展示 */
export function maskUserId(uid: string): string {
  if (uid.length <= 4) return uid;
  return `${uid.slice(0, 2)}****${uid.slice(-2)}`;
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}