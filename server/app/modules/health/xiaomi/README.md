# xiaomi/ — 小米运动健康协议移植模块

本目录是 [`mi-fitness`](https://pypi.org/project/mi-fitness/) 0.2.0（作者 MistEO，GPL-3.0-only）
核心协议的 **TypeScript 移植（衍生作品）**，按 GPL-3.0 授权（见 `LICENSE`）。

- 移植范围：RC4 加密/签名（crypto.py）、扫码登录/STS/passToken 续期（auth/*）、
  加密请求封装与自查模式数据端点（client/base.py、client/data.py 部分）。
- 未移植：密码/短信/验证码登录、亲友链路、消息、CLI（自查模式不需要）。
- 验证：`__fixtures__/crypto-vectors.json` 由原版 SDK crypto.py 生成（黄金向量），
  `crypto.test.ts` 逐字节比对；协议行为另经真实账号扫码联调验证。
- 方案与协议细节：`dulora/docs/health-research.md`（v0.3）。

注意：若未来将 dulora 整体对外分发，GPL 传染性需重新评估（届时可考虑按协议文档 clean-room 重写）。