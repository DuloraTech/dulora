# 健康数据可视化模块 — 调研与方案（v0.3 纯 Node，待确认）

> 参考项目：[ridd1ot/xiaomi-health-sync](https://github.com/ridd1ot/xiaomi-health-sync)（MIT，约 700 行 Python）
> 协议来源：[`mi-fitness`](https://pypi.org/project/mi-fitness/) SDK 0.2.0（GPL-3.0，作者 MistEO；GitHub 仓库已 404，源码取自 PyPI wheel，已全文审读）
> 范围：先做 **后端服务 + Web 可视化**；安卓端后续再接。
> 状态：v0.2 的 Python worker 方案**已否决**（用户要求不接入 Python）。v0.3 改为 **Node.js 原生移植同步协议**，可行性已逐文件验证。
> 已确认决策（2026-11-15）：**自查模式 · Recharts · 单容器部署 · 有真实账号可随时联调 · 睡眠详情页纳入 v1**。

---

## 1. 参考项目与协议分析

### 1.1 参考项目

纯命令行工具：把小米手环 / 小米运动健康（Mi Fitness）的云端数据拉到本地 SQLite。
核心依赖非官方 `mi-fitness` SDK（GPL-3.0，依赖 httpx/loguru/pydantic/qrcode/tenacity，Python ≥3.11）。

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `health_vault/sync.py` | 346 | 拉取各指标 → 按日期合并 → upsert `daily_metrics`；睡眠分段/体重/血压独立表 |
| `health_vault/storage.py` | 193 | SQLite schema（5 表）+ 区间查询 + 同步健康状态 |
| `health_vault/cli.py` | 125 | login / sync / show / status |
| `scripts/login_helper.py` | 51 | 二维码登录回调 → token.json |

### 1.2 两种账号模式（已选自查）

| | 自查模式（own token）✅ | 亲情监控模式（family token） |
| --- | --- | --- |
| 原理 | 本人 token 查自己，端点用 `/app/v1/data/*` | 亲情账户 token 走 `/app/v1/relatives/*` |
| 数据完整度 | **完整**（含压力 5 档、心率区间、睡眠评估等细节） | 共享精简版，**压力完全没有**（服务端硬限制） |
| 安全性 | 主 token 落盘，泄露=账号健康数据全暴露 | 主 token 不落地 |

自查模式端点（参考项目运行期 patch 验证过，我们直接原生使用，无需 patch）：

- `/app/v1/data/get_aggregated_fitness_data_by_time`（按天聚合：步数/睡眠/心率/血氧/压力…）
- `/app/v1/data/get_latest_fitness_data`（最新快照：血压/体重/目标…）
- `/app/v1/data/get_fitness_data_by_time`（原始测量事件：体重含体脂率、血压历史…）

参数与亲友端点同构：`{relative_uid: 本人uid, key, tag: "daily_report", start_time, end_time, limit}`。
base `https://hlth.io.mi.com`（CN）。

### 1.3 协议全文审读结论（Node 移植可行性依据）

SDK 共 4598 行，**自查模式只需移植约 1800 行中的核心协议**，其余（密码登录/亲友/消息/CLI）全部跳过：

| SDK 模块 | 行数 | 移植 | 内容 |
| --- | --- | --- | --- |
| `crypto.py` | 289 | ✅ ~150 行 TS | RC4(skip 1024) + nonce + SHA1 签名 + 加解密（详见 1.4） |
| `auth/qr.py` + `_helpers.py` | 244 | ✅ ~180 行 TS | 二维码获取 + 长轮询 + 凭证提取（`&&&START&&&` 前缀解析、set-cookie 提取 serviceToken） |
| `auth/sts.py` | 40 | ✅ ~30 行 TS | STS 交换（非致命，失败仅告警） |
| `auth/passtoken.py` | 92 | ✅ ~70 行 TS | passToken 免扫码刷新 serviceToken（401 自动续期关键） |
| `auth/manager.py` | 432 | ⭕ 部分 ~60 行 | 只移植 deviceId 生成、token 持久化、刷新编排；密码/短信/验证码流程全跳过 |
| `client/base.py` | 202 | ✅ ~120 行 TS | 加密请求封装、cookie 认证、401→刷新→重试一次、业务码映射 |
| `client/data.py` + `api.py` | 960 | ⭕ 部分 ~150 行 | 只移植 own 端点调用 + 时间窗构造（SDK 已用 UTC+8，与我们时区要求一致） |
| `http.py` | 93 | ✅ ~50 行 TS | GET 幂等重试（429/5xx/网络错误，指数退避 3 次） |
| `models.py` | 1261 | ⭕ ~150 行 TS | 数据字段接口 + 宽松解析（跳过单条脏数据）；亲友/邀请/消息模型跳过 |
| `auth/password.py` / `relatives.py` / `messages.py` / `cli.py` | ~700 | ❌ 跳过 | 扫码登录绕过密码风控；自查不需要亲友链路 |

**合计移植量约 900–1100 行 TS**，全部是确定性逻辑（HTTP + 哈希 + 字节操作），无 Python 独有依赖。

### 1.4 加密协议要点（crypto.py 已逐行确认）

1. **RC4**：标准 KSA/PRGA，**丢弃前 1024 字节密钥流**。Node 24 的 OpenSSL 3 不提供 RC4 → 纯 JS 实现（~25 行，无依赖）
2. **nonce** = `b64(随机8字节 + epoch分钟数4字节BE)`
3. **signedNonce** = `b64(SHA256(b64dec(ssecurity) + b64dec(nonce)))`，其原始字节即 RC4 密钥
4. **签名消息** = `METHOD&/path&k1=v1&k2=v2…&signedNonce`（key 字典序，参数均为 ASCII key）
5. **签名是纯 SHA1 → b64，不是 HMAC**（App 用 MessageDigest("SHA1")）
6. 请求构建流程：
   - `data` = 业务参数紧凑 JSON（无空格、UTF-8 原样，不转义中文）
   - `rc4_hash__` = SHA1(原始参数签名消息) → b64，加入参数树
   - 所有 value 按 key 排序后**拼接成一条流、共用同一个 RC4 流**加密，再按各 value 的 UTF-8 字节长切分、逐个 b64
   - `signature` = SHA1(加密后参数签名消息) → b64
   - 发送 `{各加密参数, signature, _nonce}`（GET 走 query，POST 走 form）
7. **响应解密**：用同一 nonce 派生 signedNonce，RC4 解密整个响应体 → JSON
8. 请求头：`User-Agent: Android-12-3.53.1-vivo-V2284A`、`region_tag: cn`、`handleparams: true`；cookie：`cUserId` + `serviceToken`

### 1.5 登录链路（qr.py / sts.py / passtoken.py / _helpers.py 已确认）

- **扫码**：GET `account.xiaomi.com/longPolling/loginUrl`（sid=`miothealth`，callback=STS URL，带 deviceId cookie）→ 响应剥 `&&&START&&&` 前缀 → `{qr: 二维码图片URL, loginUrl: 备用链接, lp: 长轮询URL, timeout}`
- **长轮询**：GET `lp`，单次请求 60s 超时，非 200 继续等，总超时 `min(timeout, 300s)` → 200 即扫码成功，返回 `{ssecurity, userId, passToken, cUserId, location}`
- **serviceToken**：跟随 `location` 重定向（不自动 follow），从 `set-cookie` 提取；兜底查 location query
- **STS**：GET `sts-hlth.io.mi.com/healthapp/sts?d=deviceId&ticket=0&pwd=0&p_ts=…&fid=0&p_lm=2&p_ur=CN` → `"ok"`；**非致命**
- **免扫码续期**：passToken + userId + deviceId 写 cookie → GET `serviceLogin?_json=true&sid=miothealth` → 新 ssecurity + location + nonce → `clientSign = urlencode(b64(SHA1("nonce={nonce}&{ssecurity}")))` → 跟随 `location&clientSign=…` 取新 serviceToken
- **deviceId**：`an_` + 32 位随机 hex，首次生成后持久化（换 deviceId 会触发新设备风控）
- 风控：扫码登录绕过密码验证码风控；`70016` 新设备短信验证主要出现在密码登录路径，扫码路径概率低，出现则显式报错引导

### 1.6 已发现的坑（沿用 v0.2 结论）

1. **睡眠分段污染**：午睡混入 segments，入睡/醒来取最长段为主睡眠（分段全保留，kind 区分）
2. **体重是事件数据**：体脂率只在 `get_fitness_data_by_time("weight")` 原始 JSON 里
3. **血压历史接口为空**：从 latest 快照读
4. **参考项目日期按 UTC 归一化**：东八区偏 8 小时 → **我们按 Asia/Shanghai 归一化**，与日记日期对齐（SDK 查询窗口本身已是 UTC+8）
5. **压力**：参考项目 schema 留了字段但没实现拉取 → 自查模式补 `key="stress"` 聚合请求，**需真机验证字段**
6. 非官方 API 随时可能失效；GPL-3.0 衍生作品声明（见 3.5）

---

## 2. dulora 现状（集成点）

| 层 | 现状 | 集成方式 |
| --- | --- | --- |
| 服务端 | Koa + routing-controllers + TypeDI，`/api` 前缀，`{message,data}` 信封，JWT Cookie 鉴权，DTO 走 `validateDto` | 新增 `health` module + controller，完全复用现有模式 |
| 数据库 | Prisma + SQLite（`data/dulora.db`），单用户 | **健康数据直接进 Prisma**（同库，无第二数据库） |
| Web | React 19 + Vite 8 + Tailwind 4 + TanStack Query + react-router 7 | 新增 `/health` 路由 + 导航项；新增 recharts |
| 部署 | 单容器 node:24-alpine，数据卷 `/app/data` | **零改动**（Node 24 内置 fetch/crypto 足够） |
| 运行时依赖 | Node 24 | **服务端零新增依赖**；二维码直接展示小米返回的图片 URL，无需 qrcode 库 |

---

## 3. 方案（v0.3 纯 Node）

### 3.1 架构：协议原生移植，单进程单库

```
┌──────────────────── dulora 容器（零改动）────────────────────┐
│  Node (Koa)                                                  │
│  ├─ HealthController  /api/health/*（JWT 保护）               │
│  ├─ health/                                                  │
│  │   ├─ xiaomi/        协议移植模块（GPL-3.0 声明）            │
│  │   │   ├─ crypto.ts    RC4 + nonce + SHA1 签名 + 加解密      │
│  │   │   ├─ http.ts      fetch 封装：cookie jar / 重试 / UA    │
│  │   │   ├─ auth.ts      扫码长轮询 / STS / passToken 续期     │
│  │   │   ├─ client.ts    加密请求 + own 数据端点               │
│  │   │   └─ types.ts     AuthToken / 数据项类型                │
│  │   ├─ normalize.ts   data_items → 按日归一化（Asia/Shanghai）│
│  │   ├─ health.service.ts  同步编排 + setInterval 调度 + 单飞锁│
│  │   └─ login-session.ts   内存扫码会话（超时即焚）            │
│  └─ Prisma → dulora.db（日记 + 健康模型，同库）                │
└──────────────────────────────────────────────────────────────┘
```

**相比 v0.2（Python worker + 桥接）的收益**：

- 无 Python 运行时 / venv / 子进程 IPC / 第二数据库，Dockerfile 零改动
- 健康数据与日记同库，未来「日记×健康」关联查询零成本
- 扫码登录原生化：内存会话 + fetch 长轮询，不再需要 stdout 事件桥
- 401 自动续期（passToken）在主进程内完成，失败才提示重新扫码
- 部署/备份/迁移只有一个 db 文件

**代价**：协议移植需真机验证（用户有账号可随时扫码）；移植模块构成 GPL 衍生作品（见 3.5）。

### 3.2 数据存储（Prisma 新增模型，草案）

- **`HealthAccount`**（单行）：`userId / cUserId / serviceToken / ssecurity / passToken / deviceId / status(active|needs_relogin) / connectedAt / lastSyncAt`。**凭证永不经过 API 返回**
- **`HealthDaily`**（每天一行，`date` 唯一，Asia/Shanghai）：步数/距离/卡路里/中高强度/站立/目标；主睡眠汇总（评分/时长/深睡/浅睡/REM/清醒/入睡醒来/心率血氧）；心率（均值/静息/最高/最低 + 5 区间时长 + 异常次数）；血氧；压力（均值 + 5 档时长，真机验证后定字段）
- **`HealthSleepSegment`**：全部分段（main/nap），时长/分期/心率/血氧，按 date 索引
- **`HealthWeightLog`**：体重事件（time 唯一，体重/BMI/体脂率）
- **`HealthSyncRun`**：同步历史（startedAt/finishedAt/status/daysRequested/daysWritten/error）
- **`HealthConfig`**（单行）：`enabled / syncIntervalHours(默认6) / syncDays(默认7)`。独立模型，不动现有 Settings（避开用户 WIP）
- 血压：latest 快照有值才写 HealthDaily 对应字段
- 每条 HealthDaily 可选保留 `raw` JSON（原始 value），便于字段扩展与排错

### 3.3 API 设计（沿用 `{message,data}` 信封 + JWT）

| 端点 | 说明 |
| --- | --- |
| `GET /api/health/status` | 账号状态 + 同步健康（ok/stale/broken/never_synced）+ 最近运行 |
| `GET /api/health/daily?from&to` | 按日区间（缺省最近 30 天） |
| `GET /api/health/sleep?date` | 当日睡眠汇总 + 全部分段 |
| `GET /api/health/weight?days` | 体重事件序列 |
| `POST /api/health/sync` | 手动同步 `{days?}`，单飞锁，返回计数摘要 |
| `POST /api/health/login/start` | 启动扫码会话 → `{sessionId, qrImageUrl, loginUrl}` |
| `GET /api/health/login/status?session` | pending / success / expired / error（Web 2s 轮询） |
| `POST /api/health/login/cancel` | 取消会话（中止长轮询循环） |
| `POST /api/health/disconnect` | 删除凭证，保留历史数据 |
| `GET/POST /api/health/config` | enabled / 同步间隔 / 天数 |

**扫码登录流程**：`login/start` 创建内存会话（同一时刻仅一个）→ 服务端 fetch 取二维码并启动长轮询（不阻塞响应）→ Web 展示小米 CDN 二维码图片 + 备用链接 → 2s 轮询 status → success 后凭证写 HealthAccount、自动触发首次同步。会话 300s 超时即焚；重启服务会话自然失效。

**同步调度**：setInterval 按 config 间隔（默认 6h），仅 status=active 时运行；单飞锁防重入；每次同步窗口 `syncDays` 天（默认 7，upsert 按 date 幂等）；401 → passToken 续期 → 重试一次 → 仍失败置 needs_relogin，状态条提示重新扫码；同步历史写 HealthSyncRun。

### 3.4 Web 可视化（与 v0.2 一致）

**图表库：Recharts 3.x**（已确认）。新增导航「健康」→ `/health`：

- **仪表盘**：同步状态 chip + 「立即同步」+ 区间切换（7/30/90 天）；今日卡片（步数目标环/睡眠评分时长/静息心率/血氧/最新体重）；趋势图（步数柱状、睡眠分期堆叠、心率折线+最低最高带、体重折线、血氧折线）；目标达成进度
- **睡眠页** `/health/sleep`：逐夜分期堆叠图 + 入睡/醒来时间散点 + 分段明细（主睡眠/午睡）
- **设置页「健康数据源」区块**：扫码登录对话框、同步间隔、断开连接
- TanStack Query 取数；同步/登录状态轮询

### 3.5 许可与安全（GPL 变化，需知悉）

- **GPL-3.0**：v0.2 中 Python SDK 作为独立进程运行时依赖，不构成衍生作品；**v0.3 将协议代码移植为 TS，构成 mi-fitness 的衍生作品** → `server/app/health/xiaomi/` 模块需 GPL-3.0 声明 + 出处注明（文件头 + 模块 LICENSE）。dulora 目前无 LICENSE、个人自用不分发，实际影响很小；若未来整体分发，GPL 传染性需重新评估（届时可考虑按协议文档 clean-room 重写）
- 参考项目自身代码（MIT）仅作字段/归一化逻辑参考，不 vendor
- token 仅服务端持有（Prisma 同库，数据卷权限同现有 dulora.db）；二维码会话内存态、超时即焚；日志不打印凭证
- 网络仅发往小米官方域名（account.xiaomi.com / sts-hlth.io.mi.com / hlth.io.mi.com）
- 非官方 API 风险：错误显式 surfaced 到状态条

### 3.6 移植验证策略

1. **黄金向量单测**：实施期在本机用 Python SDK（仅开发验证用，不进产品）对固定 ssecurity/nonce/参数生成加密输出，TS 实现逐字节比对；覆盖 RC4 skip、共享流切分、签名排序、中文 JSON、响应解密回环
2. **真机联调**：用户扫码 → 首同步 → 逐指标对照小米 App 数值（重点：日期边界、睡眠主段、压力字段）
3. 常规单测：日期归一化（Asia/Shanghai 跨零点）、脏数据跳过、upsert 幂等、401 续期状态机

---

## 4. 里程碑

| 阶段 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| **H1 协议移植 + 后端基础** | `xiaomi/` 模块（crypto/http/auth/client）+ 黄金向量单测；Prisma 健康模型 + migrate；config/status/daily/sleep/weight API | 单测全过；curl 全端点通（未登录态返回正确状态） | ✅ 250cc6d |
| **H2 登录与同步** | 扫码会话 + 长轮询；normalize（时区/主睡眠/压力）；手动同步 + 定时调度 + 401 续期；Web 设置区块 + 状态条 | 真实账号扫码→首同步→数据入库可见 | ✅ 250cc6d（二维码接口真机验证；首同步待用户扫码） |
| **H3 可视化** | 仪表盘 + 睡眠页 + Recharts 图表 + 区间切换 | 7/30/90 天趋势正确渲染 | ✅ 本批次（仿真数据浏览器验证） |
| **H4 打磨** | 空态/错误态/token 过期 UX；（可选）日记日历抽屉健康 chip；文档 | 断网/过期/风控场景不崩 | 🔄 错误/过期 UX 已完成并验证；日历 chip 留后续；真机验收待用户 |

工作量预估：服务端移植 + 归一化 + API 约 1500–1800 行 TS，Web 约 600–900 行；H1+H2 约 1–2 个实施批次，H3 约 1 个批次。

## 4.1 实施进度（2026-11-15）

**后端（H1+H2，commit 250cc6d）**：`server/app/modules/health/` 纯 Node 协议移植 + 归一化 + HealthService + `/api/health-data/*` 端点；26 项单测全过（含与原版 SDK 逐字节比对的黄金向量）；真实小米二维码接口验证返回成功。

**Web（H3，本批次）**：
- `api/health.ts` 独立信封封装（仅复用 `client.ts` 的 `ApiError`，不改动既有 client）
- `components/health/` 自包含组件层（`ui/charts/icons/format/QrLoginDialog/DataSourcePanel`）——原生 Tailwind 复刻应用设计语言，**不依赖任何未跟踪的 WIP 类或图标**，保证提交树独立可编译
- `pages/HealthPage.tsx` 仪表盘：状态 chip + 立即同步 + 7/30/90 天切换 + 今日六卡 + 步数/睡眠分期/心率/体重/血氧/压力六图 + 数据源管理面板
- `pages/HealthSleepPage.tsx` 睡眠详情：评分环 + 分期构成 + 主睡眠/午睡分段 + 14 天趋势（点击切换日期）
- 路由 `React.lazy + Suspense` 懒加载，recharts 拆出主 chunk（仅访问 `/health` 时加载）
- 导航接入（提交树用 HEAD emoji 导航 + 💪 健康项；工作区 WIP 版用自有 `IconHeartPulse`）

**浏览器验证（30 天仿真数据，临时库）**：暗色/亮色桌面仪表盘与睡眠页渲染正确；移动 390×844 无横向溢出、底部导航可达且高亮、无裁剪；亮色文本对比度达标；扫码对话框真实小米二维码加载 + 倒计时 + 2s 轮询 + 干净取消；同步错误链路（假 token→401→续期失败→needs_relogin→broken）UI 即时刷新呈现重新扫码引导；控制台 0 错误。

**修复**：① 睡眠详情分期图例窄列换行 → 改 2 列网格 + `whitespace-nowrap`；② 同步失败后状态查询未刷新 → `onError` 增加 `invalidateQueries(['health','status'])`，UI 立即反映 broken/needs_relogin。

**待用户真机验收（H4）**：真实小米账号扫码 → 首同步 → 数据入库 → 对照小米 App 核对（重点：压力字段实验性映射、日期边界、睡眠主段选取）。压力字段为候选名映射 + raw 兜底，需真机原始 JSON 确认。

**部署（2026-11-15）**：健康功能 + 用户 WIP 已上线正式 Docker 环境（`diary.home.rethinkos.com`）。修复一处部署阻塞：原 Dockerfile CMD 用 `prisma db push`，会删除不在 schema 中的 FTS5 影子表（`entries_fts*`）→ 数据丢失警告 → 非零退出 → 容器重启循环。改为 `server/scripts/safe-db-sync.cjs`：`prisma migrate diff` 生成增量 SQL，白名单仅应用 CREATE/ALTER，跳过 DROP 与 PRAGMA 脚手架，经 node:sqlite 事务执行——保护 FTS 与既有数据，幂等且兼容全新库。部署前已一致性备份正式库（`server/data/backups/*-before-health-deploy/`）。authenticated 实测：健康 status/daily、知识库、日历 API 均 200，Entry=FTS=12 完好。

## 5. 风险

| 风险 | 缓解 |
| --- | --- |
| 协议移植 bug（字节序/流切分/签名） | 黄金向量逐字节比对 + 真机扫码验证；用户随时可联调 |
| 小米改接口/token 失效 | 状态条显式提示 + 重新扫码入口；passToken 自动续期兜底 |
| 新设备风控（70016/验证码） | 扫码路径概率低；deviceId 持久化避免重复触发；出现则显式报错引导 |
| 日期错位 | Asia/Shanghai 归一化 + 跨零点单测 |
| 压力字段未验证 | H2 真机抓原始 JSON 后定字段；失败不阻塞其他指标 |
| GPL 衍生作品 | 模块级 GPL 声明 + 出处；个人自用影响小，分发前重评 |

## 6. 已确认决策（2026-11-15）

1. **账号模式**：✅ 自查模式（数据完整含压力，token 存自己服务器）
2. **图表库**：✅ Recharts 3.x
3. **部署**：✅ 单容器（v0.3 起 Dockerfile 零改动）
4. **测试条件**：✅ 有小米账号 + 穿戴数据，随时可扫码联调
5. **范围**：✅ 睡眠详情页纳入 v1；日记×健康关联留后续
6. **技术路线**：✅ v0.3 纯 Node 移植（用户否决 Python），已实施（后端 250cc6d + Web 本批次）