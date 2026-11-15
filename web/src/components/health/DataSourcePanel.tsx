// 数据源管理：账号状态、同步设置（开关/频率/天数）、上次同步结果、断开连接。
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { healthApi, type HealthConfig, type HealthStatus } from '../../api/health';
import { fmtDateTime, maskUserId, timeAgo } from './format';
import { IconAlert, IconLink, IconRefresh, IconUnlink } from './icons';
import { Banner, Card, Chip, Select, SectionHeader, Spinner, Toggle, btnGhostCls, btnPrimaryCls } from './ui';

const INTERVAL_OPTIONS = [
  { value: 1, label: '每 1 小时' },
  { value: 3, label: '每 3 小时' },
  { value: 6, label: '每 6 小时' },
  { value: 12, label: '每 12 小时' },
  { value: 24, label: '每天' },
];

const DAYS_OPTIONS = [
  { value: 7, label: '最近 7 天' },
  { value: 14, label: '最近 14 天' },
  { value: 30, label: '最近 30 天' },
  { value: 90, label: '最近 90 天' },
];

export function DataSourcePanel({ status, onOpenLogin }: { status: HealthStatus; onOpenLogin: () => void }) {
  const queryClient = useQueryClient();
  const account = status.account;
  const [form, setForm] = useState<HealthConfig>(status.config);

  const dirty =
    form.enabled !== status.config.enabled ||
    form.syncIntervalHours !== status.config.syncIntervalHours ||
    form.syncDays !== status.config.syncDays;

  // 外部刷新（保存成功/轮询）时同步表单，但保留用户未提交的编辑
  useEffect(() => {
    if (!dirty) setForm(status.config);
  }, [status.config, dirty]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['health'] });

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<HealthConfig>) => healthApi.updateConfig(patch),
    onSuccess: invalidate,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => healthApi.disconnect(),
    onSuccess: invalidate,
  });

  if (!account) return null;
  const needsRelogin = account.status !== 'active';
  const lastRun = status.lastRun;

  return (
    <Card className="p-5">
      <SectionHeader
        icon={<IconLink size={16} className="text-indigo-500 dark:text-indigo-400" />}
        title="数据源与同步"
        sub="小米运动健康 · 自查模式"
      />

      {/* 账号行 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/40">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium tabular-nums">小米账号 {maskUserId(account.userId)}</span>
            {needsRelogin ? <Chip tone="danger">需重新扫码</Chip> : <Chip tone="ok">已连接</Chip>}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            连接于 {fmtDateTime(Date.parse(account.connectedAt) / 1000)} · 上次同步 {timeAgo(account.lastSyncAt)}
          </p>
        </div>
        {needsRelogin && (
          <button type="button" onClick={onOpenLogin} className={`${btnPrimaryCls} px-3 py-1.5 text-xs`}>
            <IconRefresh size={14} /> 重新扫码
          </button>
        )}
      </div>

      {needsRelogin && (
        <div className="mt-3">
          <Banner tone="danger">
            登录凭证已失效且自动续期失败。重新扫码后即可恢复同步，已同步的历史数据不受影响。
          </Banner>
        </div>
      )}

      {/* 同步设置 */}
      <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
        <div className="flex items-center gap-2.5">
          <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label="自动同步" />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">自动同步</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-zinc-400">频率</span>
          <Select
            value={form.syncIntervalHours}
            onChange={(v) => setForm((f) => ({ ...f, syncIntervalHours: v }))}
            options={INTERVAL_OPTIONS}
            label="同步频率"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-zinc-400">范围</span>
          <Select
            value={form.syncDays}
            onChange={(v) => setForm((f) => ({ ...f, syncDays: v }))}
            options={DAYS_OPTIONS}
            label="每次同步天数"
          />
        </div>
        <button
          type="button"
          disabled={!dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate(form)}
          className={`${btnPrimaryCls} px-3 py-1.5 text-xs`}
        >
          {saveMutation.isPending ? <Spinner size={14} /> : null}
          保存设置
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        服务端每 15 分钟检查一次是否到期；到期后自动拉取最近 {form.syncDays} 天数据。
        {saveMutation.isError && (
          <span className="ml-1 text-rose-500">保存失败：{(saveMutation.error as Error).message}</span>
        )}
      </p>

      {/* 上次同步结果 */}
      {lastRun && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-400 dark:border-zinc-800/70 dark:text-zinc-500">
          <span>上次同步 {timeAgo(lastRun.finishedAt ?? lastRun.startedAt)}</span>
          {lastRun.status === 'ok' && <Chip tone="ok">成功 · {lastRun.daysWritten} 天</Chip>}
          {lastRun.status === 'running' && <Chip tone="info">进行中</Chip>}
          {lastRun.status === 'error' && <Chip tone="danger">失败</Chip>}
          {lastRun.error && (
            <span className="inline-flex items-center gap-1 text-rose-500 dark:text-rose-400">
              <IconAlert size={12} /> {lastRun.error}
            </span>
          )}
        </div>
      )}

      {/* 断开 */}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={disconnectMutation.isPending}
          onClick={() => {
            if (window.confirm('断开连接将删除本机保存的小米凭证（已同步的健康数据保留）。确定断开？')) {
              disconnectMutation.mutate();
            }
          }}
          className={`${btnGhostCls} px-3 py-1.5 text-xs hover:border-rose-300/60 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:border-rose-800/60 dark:hover:text-rose-400`}
        >
          {disconnectMutation.isPending ? <Spinner size={14} /> : <IconUnlink size={14} />}
          断开连接
        </button>
      </div>
      {disconnectMutation.isError && (
        <p className="mt-2 text-right text-xs text-rose-500">{(disconnectMutation.error as Error).message}</p>
      )}
    </Card>
  );
}