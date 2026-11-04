#!/usr/bin/env node
/**
 * 发布闸门（第二道）：构建前扫描全部内容，命中高危字符串就让构建失败。
 *
 *   node scripts/check-leaks.mjs            # 扫 src/ + public/ + README.md
 *
 * 误报处理：在 scripts/leak-allowlist.txt 里加一行 `子串` 即可放行（要求写清原因）。
 * 只在本机成立的规则（来源站名之类）放 scripts/leak-rules.local.json，该文件不进仓库。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = ['src', 'public'];
const SCAN_FILES = ['README.md'];
const SCAN_EXT = new Set(['.md', '.mdx', '.astro', '.ts', '.tsx', '.js', '.mjs', '.json', '.css', '.txt', '.yml', '.yaml']);
const ALLOWLIST = join(ROOT, 'scripts', 'leak-allowlist.txt');
const LOCAL_RULES = join(ROOT, 'scripts', 'leak-rules.local.json');

/** [正则, 说明] —— 命中即失败。规则本身要通用，别写具体机器名，否则这文件自己就是泄露源。 */
const RULES = [
  [/\/home\/[A-Za-z0-9._-]+\//g, '本机用户目录绝对路径'],
  [/\/Users\/[A-Za-z0-9._-]+\//g, '本机用户目录绝对路径（macOS）'],
  [/\/mnt\/[A-Za-z0-9._-]+\//g, '外部挂载路径'],
  [/[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+/g, '本机用户目录绝对路径（Windows）'],
  [/ghp_[A-Za-z0-9]{20,}/g, 'GitHub PAT (ghp_)'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, 'GitHub fine-grained PAT'],
  [/gho_[A-Za-z0-9]{20,}/g, 'GitHub OAuth token'],
  [/\bsk-[A-Za-z0-9_-]{24,}/g, '疑似 API Key (sk-)'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS Access Key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '私钥'],
  [/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, '内网地址'],
  [/\b(?:password|passwd|pwd)\s*[:=]\s*\S{4,}/gi, '疑似明文口令'],
  [/\b(?:token|secret|api[_-]?key)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi, '疑似硬编码密钥'],
];

/** 只在本机成立的规则（比如某些来源站名），放 scripts/leak-rules.local.json，不进仓库 */
async function localRules() {
  try {
    const raw = JSON.parse(await readFile(LOCAL_RULES, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => Array.isArray(r) && typeof r[0] === 'string')
      .map(([pattern, label, flags = 'gi']) => [new RegExp(pattern, flags), label ?? pattern]);
  } catch {
    return [];
  }
}

async function* walk(dir) {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (item.name === 'node_modules' || item.name === 'dist' || item.name === '.astro') continue;
    const full = join(dir, item.name);
    if (item.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.has(extname(item.name))) yield full;
  }
}

async function allowlist() {
  try {
    const raw = await readFile(ALLOWLIST, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

const allow = await allowlist();
const RULES_ALL = [...RULES, ...(await localRules())];
const hits = [];
let scanned = 0;

/** 目录 + 默认目录之外的单文件（README 也是公开内容，同样要扫） */
async function* targets() {
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    try {
      await stat(abs);
    } catch {
      continue;
    }
    yield* walk(abs);
  }
  for (const rel of SCAN_FILES) {
    const abs = join(ROOT, rel);
    try {
      await stat(abs);
      yield abs;
    } catch {
      /* 没有就跳过 */
    }
  }
}

for await (const file of targets()) {
  scanned++;
  const text = await readFile(file, 'utf8');
  for (const [re, label] of RULES_ALL) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const line = text.slice(0, m.index).split('\n').length;
      const snippet = text.split('\n')[line - 1]?.slice(0, 160) ?? '';
      if (allow.some((a) => snippet.includes(a) || m[0].includes(a))) continue;
      hits.push({ file: relative(ROOT, file), line, label, match: m[0], snippet });
    }
  }
}

if (hits.length === 0) {
  console.log(`[leak-check] 通过：扫描 ${scanned} 个文件，无命中。`);
  process.exit(0);
}

console.error(`\n[leak-check] 发现 ${hits.length} 处疑似泄露，构建中止：\n`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}  [${h.label}]  命中 "${h.match}"`);
  console.error(`      ${h.snippet.trim()}`);
}
console.error(`\n确认无误后，把该行的一段特征文本加进 scripts/leak-allowlist.txt（附原因）。\n`);
process.exit(1);
