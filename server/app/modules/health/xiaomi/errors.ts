/**
 * 小米运动健康协议 — 异常类型。
 * 移植自 mi-fitness 0.2.0（https://pypi.org/project/mi-fitness/，作者 MistEO）。
 * 衍生作品，SPDX-License-Identifier: GPL-3.0-only
 */

/** 认证/登录失败 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** serviceToken 过期（401），可用 passToken 尝试续期 */
export class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

/** API 请求/业务错误 */
export class ApiError extends Error {
  readonly code: number;
  readonly statusCode: number;
  constructor(message: string, opts: { code?: number; statusCode?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code ?? 0;
    this.statusCode = opts.statusCode ?? 0;
  }
}

/** 扫码超时 */
export class QrTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrTimeoutError';
  }
}

/** 扫码会话被取消 */
export class QrCancelledError extends Error {
  constructor(message = '扫码会话已取消') {
    super(message);
    this.name = 'QrCancelledError';
  }
}