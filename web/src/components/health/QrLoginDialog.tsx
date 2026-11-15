// 小米账号扫码登录对话框。
// 二维码图片由小米 CDN 直载（no-referrer）；2s 轮询会话状态；过期可刷新；
// 关闭时取消待扫码会话。凭证由后端持久化，前端不接触 token。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { healthApi, type QrSession } from '../../api/health';
import { IconAlert, IconCheck, IconQrCode, IconRefresh, IconX } from './icons';
import { Modal, Spinner, btnGhostCls, btnPrimaryCls, iconBtnCls } from './ui';

const QR_TTL_MS = 300_000; // 与后端 SDK 默认 timeout 一致

export function QrLoginDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [session, setSession] = useState<QrSession | null>(null);
  const [startError, setStartError] = useState('');
  const [imgError, setImgError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const startingRef = useRef(false);
  const sessionRef = useRef<QrSession | null>(null);

  const start = useCallback(async () => {
    setStartError('');
    setImgError(false);
    setSession(null);
    sessionRef.current = null;
    try {
      const s = await healthApi.loginStart();
      setSession(s);
      sessionRef.current = s;
    } catch (e) {
      setStartError(e instanceof Error ? e.message : '获取二维码失败，请重试');
    }
  }, []);

  // 打开时启动会话（ref 防抖，兼容 StrictMode 双挂载）
  useEffect(() => {
    if (!open) {
      startingRef.current = false;
      setSession(null);
      sessionRef.current = null;
      setStartError('');
      return;
    }
    if (startingRef.current) return;
    startingRef.current = true;
    void start();
  }, [open, start]);

  const { data: polled } = useQuery({
    queryKey: ['health', 'login', session?.id],
    queryFn: () => healthApi.loginStatus(session!.id),
    enabled: open && !!session && session.status === 'pending',
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2000 : false),
  });

  const current = polled ?? session;
  const status = current?.status;

  // 成功后通知父级刷新数据，稍后自动关闭
  useEffect(() => {
    if (status !== 'success') return;
    onSuccess();
    const t = setTimeout(onClose, 1600);
    return () => clearTimeout(t);
  }, [status, onSuccess, onClose]);

  // 倒计时
  useEffect(() => {
    if (status !== 'pending') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const handleClose = useCallback(() => {
    const s = sessionRef.current;
    if (s && s.status === 'pending') void healthApi.loginCancel(s.id).catch(() => undefined);
    onClose();
  }, [onClose]);

  const refresh = useCallback(() => {
    const s = sessionRef.current;
    if (s && s.status === 'pending') void healthApi.loginCancel(s.id).catch(() => undefined);
    void start();
  }, [start]);

  const remainSec = current ? Math.max(0, Math.round((current.createdAt + QR_TTL_MS - now) / 1000)) : 0;
  const remainLabel = `${Math.floor(remainSec / 60)}:${String(remainSec % 60).padStart(2, '0')}`;

  return (
    <Modal open={open} onClose={handleClose} label="连接小米账号">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
            <IconQrCode size={20} />
          </span>
          <div>
            <h3 className="text-base font-semibold tracking-tight">连接小米账号</h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">同步「小米运动健康」数据</p>
          </div>
        </div>
        <button type="button" onClick={handleClose} aria-label="关闭" className={iconBtnCls}>
          <IconX size={16} />
        </button>
      </div>

      <div className="flex flex-col items-center">
        {/* 二维码区：白底保证可扫 */}
        <div className="relative flex h-[248px] w-[248px] items-center justify-center rounded-2xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-700/60">
          {!current && !startError && <Spinner size={24} className="text-zinc-400" />}

          {startError && (
            <div className="flex flex-col items-center gap-3 px-4 text-center">
              <IconAlert size={22} className="text-rose-500" />
              <p className="text-xs leading-relaxed text-zinc-500">{startError}</p>
              <button type="button" onClick={() => void start()} className={`${btnGhostCls} px-3 py-1.5 text-xs`}>
                <IconRefresh size={14} /> 重试
              </button>
            </div>
          )}

          {current && status === 'pending' && current.qrImageUrl && !imgError && (
            <img
              key={current.qrImageUrl}
              src={current.qrImageUrl}
              alt="小米登录二维码"
              width={224}
              height={224}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="h-56 w-56 rounded-lg"
            />
          )}

          {current && status === 'pending' && (imgError || !current.qrImageUrl) && (
            <div className="flex flex-col items-center gap-3 px-4 text-center">
              <IconAlert size={22} className="text-amber-500" />
              <p className="text-xs leading-relaxed text-zinc-500">二维码图片加载失败</p>
              {current.loginUrl && (
                <a
                  href={current.loginUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                >
                  在浏览器中打开登录页
                </a>
              )}
              <button type="button" onClick={refresh} className={`${btnGhostCls} px-3 py-1.5 text-xs`}>
                <IconRefresh size={14} /> 刷新二维码
              </button>
            </div>
          )}

          {current && status === 'success' && (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                <IconCheck size={28} />
              </span>
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">连接成功</p>
              <p className="text-xs text-zinc-400">正在触发首次同步…</p>
            </div>
          )}

          {current && (status === 'expired' || status === 'cancelled' || status === 'error') && (
            <div className="flex flex-col items-center gap-3 px-4 text-center">
              <IconAlert size={22} className={status === 'error' ? 'text-rose-500' : 'text-amber-500'} />
              <p className="text-xs leading-relaxed text-zinc-500">
                {status === 'expired' && '二维码已过期，请刷新后重新扫码'}
                {status === 'cancelled' && '扫码会话已取消'}
                {status === 'error' && (current.error ?? '登录失败，请重试')}
              </p>
              <button type="button" onClick={refresh} className={`${btnPrimaryCls} px-3 py-1.5 text-xs`}>
                <IconRefresh size={14} /> 刷新二维码
              </button>
            </div>
          )}
        </div>

        {/* 浏览器登录兜底（非小米手机 / 无米家时可用） */}
        {current && status === 'pending' && current.loginUrl && (
          <a
            href={current.loginUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 text-[11px] font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
          >
            扫不了？在浏览器中打开登录页
          </a>
        )}

        {/* 状态行 */}
        <div className="mt-3 flex h-5 items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
          {status === 'pending' && (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
              </span>
              <span>等待扫码确认</span>
              <span className="tabular-nums">· 剩余 {remainLabel}</span>
            </>
          )}
          {status === 'success' && <span className="text-emerald-500">已完成</span>}
        </div>
      </div>

      <ol className="mt-4 space-y-1.5 rounded-xl bg-zinc-50 p-3.5 text-xs leading-relaxed text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400">
        <li>1. 小米手机：用系统「扫一扫」（或 设置 → 小米账号 → 扫一扫）；其他手机：用「米家」App 的扫一扫</li>
        <li>2. 扫描上方二维码并在手机上确认登录</li>
        <li>3. 连接成功后自动同步最近 7 天数据，可随时手动同步更多</li>
      </ol>
      <p className="mt-2 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        注意：「小米运动健康」App 的扫一扫仅用于设备配对，无法识别此登录二维码。
      </p>
      <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        凭证仅保存在本机数据库，不会上传到任何第三方；可随时在下方断开连接。
      </p>
    </Modal>
  );
}