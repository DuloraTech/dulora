// 安全增量同步 Prisma schema 到 SQLite（替代 `prisma db push`）。
//
// 背景：`prisma db push` 会删除不在 schema 中的 FTS5 影子表（entries_fts*），
// 触发数据丢失警告并以非零码退出，导致容器重启循环（见 docs/health-research.md）。
// 本脚本用 `prisma migrate diff` 生成增量 SQL，跳过所有 DROP 语句（保护 FTS 与既有数据），
// 仅经 node:sqlite 事务应用 CREATE/ALTER 等增量语句。幂等、保数据，兼容全新库与既有库。
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbUrl = process.env.DATABASE_URL || 'file:/app/data/dulora.db';
const filePath = dbUrl.replace(/^file:/, '');
const schema = path.join(__dirname, '..', 'prisma', 'schema.prisma');

// 生成 diff SQL（只读 introspect，不改动数据库）
const sql = execFileSync(
  'npx',
  ['prisma', 'migrate', 'diff', '--from-url', dbUrl, '--to-schema-datamodel', schema, '--script'],
  { encoding: 'utf-8' },
);

// 剥离行注释后拆分语句，仅应用增量 DDL（CREATE/ALTER 白名单）。
// 跳过 DROP（保护 FTS 影子表与数据）与 PRAGMA 脚手架（migrate diff 的外键开关）。
// schema 不含触发器，diff 输出均为单条 DDL，按 ';' 拆分安全。
const cleaned = sql.replace(/--[^\n]*/g, '');
const statements = cleaned.split(';').map((s) => s.trim()).filter(Boolean);
const apply = [];
const skipped = [];
for (const s of statements) {
  if (/^(CREATE|ALTER)\b/i.test(s)) {
    apply.push(s);
  } else {
    skipped.push(s.split('\n')[0]);
  }
}

if (apply.length === 0) {
  console.log(`[safe-db-sync] schema 已同步，无需变更（跳过 ${skipped.length} 条非增量语句）`);
  process.exit(0);
}

const db = new DatabaseSync(filePath);
db.exec('BEGIN');
try {
  for (const s of apply) db.exec(`${s};`);
  db.exec('COMMIT');
  console.log(`[safe-db-sync] 应用 ${apply.length} 条增量语句（跳过 ${skipped.length} 条非增量语句）`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('[safe-db-sync] 失败已回滚:', e.message);
  process.exit(1);
} finally {
  db.close();
}