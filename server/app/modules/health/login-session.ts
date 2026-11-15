/**
 * 扫码登录会话管理（内存态，重启即失效，超时即焚）。
 * 同一时刻仅一个活跃会话；凭证提取成功后回调上层持久化。
 */
import crypto from 'node:crypto';
import {
  createLoginHttp,
  extractCredentials,
  fetchQrInfo,
  newDeviceId,
  stsExchange,
  waitForQrScan,
  type QrInfo,
} from './xiaomi/auth';
import { QrCancelledError, QrTimeoutError } from './xiaomi/errors';
import type { XiaomiToken } from './xiaomi/types';

export type QrSessionStatus = 'pending' | 'success' | 'expired' | 'error' | 'cancelled';

export interface QrSessionView {
  id: string;
  status: QrSessionStatus;
  qrImageUrl?: string;
  loginUrl?: string;
  error?: string;
  createdAt: number;
}

interface Session {
  id: string;
  status: QrSessionStatus;
  info?: QrInfo;
  error?: string;
  createdAt: number;
  abort: AbortController;
}

const MAX_KEPT_SESSIONS = 5;

export class LoginSessionManager {
  private sessions = new Map<string, Session>();

  constructor(private readonly onAuthenticated: (token: XiaomiToken) => Promise<void>) {}

  /** 启动扫码会话；existingDeviceId 复用已持久化的设备标识（避免新设备风控） */
  async start(existingDeviceId?: string): Promise<QrSessionView> {
    // 取消上一个待扫码会话
    for (const s of this.sessions.values()) {
      if (s.status === 'pending') this.cancel(s.id);
    }

    const session: Session = {
      id: crypto.randomBytes(8).toString('hex'),
      status: 'pending',
      createdAt: Date.now(),
      abort: new AbortController(),
    };
    this.sessions.set(session.id, session);
    this.prune();

    const http = createLoginHttp();
    const deviceId = existingDeviceId || newDeviceId();
    try {
      session.info = await fetchQrInfo(http, deviceId);
    } catch (err) {
      session.status = 'error';
      session.error = err instanceof Error ? err.message : String(err);
      return this.view(session);
    }

    // 长轮询在后台进行，不阻塞 start 响应
    void this.runPoll(session, http, deviceId);
    return this.view(session);
  }

  private async runPoll(session: Session, http: ReturnType<typeof createLoginHttp>, deviceId: string): Promise<void> {
    try {
      const data = await waitForQrScan(http, session.info!, { signal: session.abort.signal });
      const token = await extractCredentials(http, data, {
        userId: '',
        cUserId: '',
        serviceToken: '',
        ssecurity: '',
        passToken: '',
        deviceId,
      });
      // STS 交换非致命
      await stsExchange(http, token);
      await this.onAuthenticated(token);
      session.status = 'success';
    } catch (err) {
      if (err instanceof QrCancelledError) {
        session.status = 'cancelled';
      } else if (err instanceof QrTimeoutError) {
        session.status = 'expired';
        session.error = err.message;
      } else {
        session.status = 'error';
        session.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  get(id: string): QrSessionView | undefined {
    const s = this.sessions.get(id);
    return s ? this.view(s) : undefined;
  }

  cancel(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (s.status === 'pending') {
      s.abort.abort();
      s.status = 'cancelled';
    }
    return true;
  }

  cancelAllPending(): void {
    for (const s of this.sessions.values()) {
      if (s.status === 'pending') this.cancel(s.id);
    }
  }

  private view(s: Session): QrSessionView {
    return {
      id: s.id,
      status: s.status,
      ...(s.info ? { qrImageUrl: s.info.qrImageUrl, loginUrl: s.info.loginUrl } : {}),
      ...(s.error ? { error: s.error } : {}),
      createdAt: s.createdAt,
    };
  }

  /** 仅保留最近 N 个会话（终态会话供 Web 读取结果后自然淘汰） */
  private prune(): void {
    if (this.sessions.size <= MAX_KEPT_SESSIONS) return;
    const sorted = [...this.sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const s of sorted.slice(0, sorted.length - MAX_KEPT_SESSIONS)) {
      if (s.status !== 'pending') this.sessions.delete(s.id);
    }
  }
}