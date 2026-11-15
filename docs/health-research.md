# 健康数据可视化模块 — 调研与方案（v0.2 已确认）

> 参考项目：[ridd1ot/xiaomi-health-sync](https://github.com/ridd1ot/xiaomi-health-sync)（MIT，约 700 行 Python）
> 范围：先做 **后端服务 + Web 可视化**；安卓端后续再接。
> 状态：调研完成，关键决策已确认（2026-11-15）：**自查模式 · Recharts · 单容器部署 · 有真实账号可随时联调**。

---

## 1. 参考项目分析

### 1.1 它是什么

纯命令行工具：把小米手环 / 小米运动健康（Mi Fitness）的云端数据拉到**本地 SQLite**。
核心依赖非官方 [`mi-fitness`](https://pypi.org/project/mi-fitness/) SDK（GPL-3.0，作者 MistEO/MiSDK，0.2.0，2026-03 发布，依赖 httpx/loguru/pydantic/qrcode/tenacity，Python ≥3.11）。

代码结构（已克隆审读）：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `health_vault/sync.py` | 346 | `run_sync()`：拉取各指标 → 按日期合并 → upsert `daily_metrics`；睡眠分段/体重/血压独立表 |
| `health_vault/storage.py` | 193 | SQLite schema（5 表）+ 区间查询 + 同步健康状态（ok/stale/broken） |
| `health_vault/cli.py` | 125 | login / sync / show / status |
| `scripts/login_helper.py` | 51 | 二维码登录：`qr_callback(qr_image_url, login_url)` → 扫码 → token.json |

### 1.2 数据模型（SQLite，5 表）

- **`daily_metrics`**（每天一行，~60 字段）：步数/距离/卡路里/中高强度/站立；睡眠（时长/深睡/浅睡/REM/清醒/评分/入睡醒来/心率血氧）；心率（均值/静息/最高/最低 + 5 区间时长 + 异常次数）；血氧；压力（schema 已留字段）；每日目标完成度
- **`sleep_segments`**：全部分段（主睡眠 + 午睡，kind 区分），各段时长/分期/心率/血氧
- **`weight_log`**：体重事件（体重/BMI/体脂率，按测量时间点）
- **`blood_pressure`**：血压快照（有数据才存）
- **`sync_runs`**：同步历史（成功/失败/错误原因）

### 1.3 两种账号模式（关键取舍）

| | 自查模式（own token） | 亲情监控模式（family token） |
| --- | --- | --- |
| 原理 | 本人 token 查自己，运行期 patch 端点到 `/app/v1/data/*` | 亲情账户 token 走 `/app/v1/relatives/*` 读主账户共享数据 |
| 数据完整度 | **完整**（含压力 5 档、心率区间、睡眠评估等细节） | 共享精简版，**压力完全没有**（服务端硬限制） |
| 安全性 | 主 token 落盘，泄露=账号健康数据全暴露 | 主 token 不落地，泄露只暴露共享范围 |
| 适用 | 个人自用服务器 | 监控他人/安全优先 |

### 1.4 认证与协议

- 二维码登录：`account.xiaomi.com` 长轮询 → 扫码 → `ssecurity/passToken/serviceToken` → STS 交换（`sts-hlth.io.mi.com`）→ 数据 API（`hlth.io.mi.com`，RC4 加密参数）
- **`qr_callback` 暴露二维码图片 URL + 备用登录链接** → 可以做成 Web 扫码登录（关键可行性）
- token 过期需重新扫码；SDK 自动 STS 刷新，刷新失败抛 `TokenExpiredError`
- 风控异常：`DeviceUntrustedError`（新设备需短信验证）、`CaptchaRequiredError`（图形验证码）

### 1.5 已发现的坑（参考项目自述 + 代码审读）

1. **睡眠分段污染**：午睡混入 segments，入睡/醒来必须取最长段（已处理）
2. **体重是事件数据**：体脂率只在 `get_fitness_data("weight")` 原始 JSON 里（已处理）
3. **血压历史接口为空**：只能从 latest 快照读（已处理）
4. **日期用 UTC 转换**（`_date_from_ts` tz=utc）：东八区会偏 8 小时 → **我们必须改为按 Settings.timezone 归一化**，才能与日记日期对齐
5. **压力字段 schema 已留但 sync.py 未实现拉取**：自查模式可用 `get_aggregated_data(uid, "stress", ...)` 补，需真机验证
6. 非官方 API 随时可能失效；GPL-3.0 依赖需许可声明

---

## 2. dulora 现状（集成点）

| 层 | 现状 | 集成方式 |
| --- | --- | --- |
| 服务端 | Koa + routing-controllers + TypeDI，`/api` 前缀，`{message,data}` 信封，JWT Cookie 鉴权，DTO 走 `validateDto` | 新增 `health` module + controller，完全复用现有模式 |
| 数据库 | Prisma + SQLite（`data/dulora.db`），单用户 | **健康数据独立 `health.db`**（Python 持有 schema）；健康配置进 Prisma |
| Web | React 19 + Vite 8 + Tailwind 4 + TanStack Query + react-router 7，fetch 封装信封解包 | 新增 `/health` 路由 + 导航项；图表库需新增 |
| 部署 | 单容器 node:24-alpine，数据卷 `/app/data`，构建阶段已含 python3/make/g++ | 运行时阶段加 python3 + venv，**保持单容器** |
| Node 运行时 | **Node 24 内置 `node:sqlite`** | 只读查询 health.db 零原生依赖 |

---

## 3. 推荐方案

### 3.1 架构：同容器 Python worker + Node 桥接

```
┌──────────────────── dulora 容器 ────────────────────────┐
│  Node (Koa)                                             │
│  ├─ HealthController  /api/health/*（JWT 保护）          │
│  ├─ HealthBridge 服务：                                 │
│  │   ├─ child_process 派生 Python worker（sync/qr-login）│
│  │   ├─ node:sqlite 只读查询 health.db                  │
│  │   └─ 定时调度（setInterval + 单飞锁）                 │
│  └─ Prisma → dulora.db（日记 + HealthConfig）           │
│                                                         │
│  Python venv：mi-fitness SDK + vendor 的 health_vault   │
│  └─ 写入 → data/health/health.db + token.json(600)      │
└─────────────────────────────────────────────────────────┘
```

**为什么这样选**：

- 同步协议（RC4/STS/扫码）只有 Python SDK 实现，**移植 TS 风险高、工作量大**，否决
- 独立 FastAPI 微服务（第二容器）对单用户场景过重，否决
- vendor health_vault（MIT）进仓库 `server/health/`，做最小适配，保持与上游同步能力
- Node 与 Python 通过 **SQLite 文件 + 子进程 stdio JSON** 通信，无网络端口、无新服务
- `node:sqlite`（Node 24 内置）只读查询，避免 better-sqlite3 原生编译

### 3.2 数据存储

- `data/health/health.db`：参考项目 5 表原样保留（Python 独占写，Node 只读）
- `data/health/token.json`：chmod 600，**永不经过 API 返回**
- Prisma 新增 `HealthConfig`（单行）：`mode(own/family) / familyUid / syncIntervalHours / syncDays / enabled`
- 日期归一化修复：`_date_from_ts` 改用配置时区（默认 Asia/Shanghai），与日记 `date` 对齐

### 3.3 API 设计（沿用 `{message,data}` 信封 + JWT）

| 端点 | 说明 |
| --- | --- |
| `GET /api/health/status` | 配置状态 + 同步健康（ok/stale/broken/never_synced）+ 最近运行 + token 状态 |
| `GET /api/health/daily?from&to` | daily_metrics 区间（缺省最近 30 天） |
| `GET /api/health/sleep?date` | 当日睡眠汇总 + 全部分段 |
| `GET /api/health/weight?days` | 体重事件序列 |
| `POST /api/health/sync` | 手动同步 `{days?}`，单飞，返回计数摘要 |
| `POST /api/health/login/start` | 启动扫码会话 → `{sessionId, qrImageUrl, loginUrl}` |
| `GET /api/health/login/status?session` | pending / success / expired / error（Web 2s 轮询） |
| `POST /api/health/login/cancel` | 取消会话（杀子进程） |
| `POST /api/health/disconnect` | 删除 token，保留历史数据 |
| `GET/POST /api/health/config` | 模式/亲情 uid/同步间隔/天数 |

**扫码登录流程**：Node 派生 `qr_login.py`（stdout 逐行 JSON 事件：qr→done/error）→ 内存会话表 → Web 展示二维码（小米 CDN 图片直载 + 备用链接）→ 轮询至 success → token 落盘 → 自动触发首次同步。会话 180s 超时。

**同步调度**：默认每 6 小时（可配），仅 token 存在时运行；`sync_runs` 历史供 UI 展示；`TokenExpiredError` → 状态条提示重新扫码。

### 3.4 Web 可视化

**图表库：Recharts 3.x**（React 19 兼容、声明式、~100KB、Tailwind 友好）；备选 ECharts（更重但图表类型更全）。

新增导航「健康」→ `/health`：

- **仪表盘**
  - 顶部：同步状态 chip + 「立即同步」+ 区间切换（7/30/90 天）
  - 今日卡片：步数（目标进度环）、睡眠（评分+时长）、静息心率、血氧、最新体重
  - 趋势图：步数柱状、睡眠分期堆叠（深睡/浅睡/REM/清醒）、心率折线（均值/静息+最低最高带）、体重折线、血氧折线
  - 目标达成：步数/卡路里/中高强度进度
- **睡眠页** `/health/sleep`：逐夜分期堆叠图 + 入睡/醒来时间散点 + 分段明细（主睡眠/午睡）
- **设置页新增「健康数据源」区块**：扫码登录对话框、模式选择、同步间隔、断开连接
- 数据获取沿用 TanStack Query；同步/登录状态轮询

### 3.5 许可与安全

- mi-fitness **GPL-3.0**：作为独立 Python 进程的运行时依赖（pip 安装，不 vendor SDK 源码），Node 主程序经文件/stdio 与之通信，不构成衍生作品；`server/health/` 放 MIT 声明 + GPL 依赖注明（dulora 目前无 LICENSE，个人项目影响小）
- token 仅服务端持有；二维码会话内存态、超时即焚；日志不打印凭证
- 网络仅发往小米官方域名（SDK 行为，参考项目已审计）
- 非官方 API 风险：错误显式 surfaced 到状态条，SDK 版本锁定

---

## 4. 里程碑

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **H1 后端桥接** | vendor health_vault + 时区适配；HealthBridge（spawn + node:sqlite 读取 + 调度）；config/status/daily/sleep/weight API；Docker 运行时加 python venv | curl 全端点通；单测（日期归一化/读取层） |
| **H2 登录与同步** | 扫码会话流程；手动同步 + 定时；Web 设置区块 + 状态条 | 真实账号扫码→首同步→数据可见 |
| **H3 可视化** | 仪表盘 + 睡眠页 + Recharts 图表 + 区间切换 | 7/30/90 天趋势正确渲染 |
| **H4 打磨** | 空态/错误态/token 过期 UX；（可选）日记日历抽屉健康 chip；文档 | 飞行模式/断网/过期场景不崩 |

工作量预估：H1+H2 约 1 个实施批次，H3 约 1 个批次（图表细节较多）。

## 5. 风险

| 风险 | 缓解 |
| --- | --- |
| 小米改接口/token 失效 | 状态条显式提示 + 重新扫码入口；SDK 锁版本 |
| 新设备风控（短信/验证码） | 捕获异常并展示 SDK 错误文案；文档说明先在手机 App 信任设备 |
| `node:sqlite` 实验性 | Node 24 API 已稳定可用；备选 better-sqlite3（构建阶段已有编译工具链） |
| 日期错位 | H1 强制时区适配 + 单测 |
| 压力数据缺失 | 自查模式补 `get_aggregated_data("stress")`，真机验证后启用；亲情模式无解 |

## 6. 已确认决策（2026-11-15）

1. **账号模式**：✅ 自查模式（数据完整含压力，token 存自己服务器）
2. **图表库**：✅ Recharts 3.x
3. **部署**：✅ 保持单容器（Python venv 进运行时镜像）
4. **测试条件**：✅ 有小米账号 + 穿戴数据，随时可扫码联调
5. **范围**：睡眠详情页纳入 v1；日记×健康关联（日历 chip/心情相关性）留后续