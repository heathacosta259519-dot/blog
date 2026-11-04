#!/usr/bin/env node
/**
 * 发布闸门（第一道）：把 Obsidian 库里打算公开的笔记单向同步到 src/content/notes/。
 *
 * 规则：
 *   1. 只有 frontmatter 里 `publish: true` 的 .md 才会被搬过来 —— 默认私有，要公开得显式声明。
 *   2. 剥掉 <!-- private -->…<!-- /private --> 与 %%…%% 区块。
 *   3. 去掉 ![[附件]] 内嵌、本机绝对路径；[[双链]] 改写成站内链接（目标也公开时）或纯文本。
 *   4. 输出带标记，同步不手改；用清单记录生成过的文件，源文件删了就跟着删。
 *
 * 用法：
 *   node scripts/sync-notes.mjs            # 同步
 *   node scripts/sync-notes.mjs --dry      # 只看会发生什么
 *   BLOG_VAULT=~/notes node scripts/sync-notes.mjs
 */
import fg from 'fast-glob';
import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'src', 'content', 'notes');
const MANIFEST = join(OUT_DIR, '.sync-manifest.json');
const LOCAL_CONFIG = join(ROOT, 'scripts', 'sync.local.json');

/** `~` 只在开头展开，别把正文里的 ~ 也换掉 */
const expand = (p) => p.replace(/^~(?=$|\/)/, homedir());

/** 库路径：环境变量 → 本地配置（不进仓库）→ 报错退出 */
async function resolveVault() {
  if (process.env.BLOG_VAULT) return expand(process.env.BLOG_VAULT);
  try {
    const raw = JSON.parse(await readFile(LOCAL_CONFIG, 'utf8'));
    if (raw.vault) return expand(raw.vault);
  } catch {
    /* 没配置就走下面的报错 */
  }
  console.error(
    '[sync-notes] 没有找到笔记库。二选一：\n' +
      '  BLOG_VAULT=~/notes pnpm sync:notes\n' +
      '  或写 scripts/sync.local.json：{ "vault": "~/notes" }  （该文件不进仓库）',
  );
  process.exit(1);
}

const VAULT = await resolveVault();
const DRY = process.argv.includes('--dry');

const SKIP_NAMES = new Set(['AGENTS.md', 'README.md', 'index.md']);

const slugify = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

const stripPrivate = (md) =>
  md
    .replace(/<!--\s*private\s*-->[\s\S]*?<!--\s*\/private\s*-->/g, '')
    .replace(/%%[\s\S]*?%%/g, '');

const stripEmbeds = (md) => md.replace(/!\[\[[^\]]*\]\]/g, '');

const scrubPaths = (md) =>
  md
    .replace(/\/home\/[A-Za-z0-9_.-]+\//g, '~/')
    .replace(/\/mnt\/win-[a-z]\//g, '~/')
    .replace(/\b\/Users\/[A-Za-z0-9_.-]+\//g, '~/');

const firstParagraph = (md) => {
  const text = md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}.*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/[*_`>#[\]]/g, '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .find((s) => s.length > 8);
  if (!text) return '（无摘要）';
  const one = text.replace(/\s+/g, ' ');
  return one.length > 90 ? one.slice(0, 90).trimEnd() + '…' : one;
};

const firstHeading = (md) => {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = await fg('**/*.md', {
    cwd: VAULT,
    ignore: ['**/.obsidian/**', '**/.git/**', '**/node_modules/**', '**/_archive/**'],
    absolute: true,
  });

  // 第一趟：收集所有公开笔记的 (标题/文件名) → slug，供双链改写用
  const parsed = [];
  for (const file of files.sort()) {
    if (SKIP_NAMES.has(basename(file))) continue;
    const raw = await readFile(file, 'utf8');
    const { data, content } = matter(raw);
    if (data.publish !== true) continue;

    const name = basename(file, '.md');
    const title = data.title || firstHeading(content) || name;
    let slug = data.slug ? slugify(String(data.slug)) : slugify(name);
    let slugNote = null;
    if (!/[a-z0-9]/.test(slug)) {
      // 纯中文文件名 → 给个稳定但不可读的地址，并在日志里提醒补 slug
      slug = 'note-' + createHash('sha1').update(relative(VAULT, file)).digest('hex').slice(0, 8);
      slugNote = `${relative(VAULT, file)}：文件名没有 ASCII 字符，地址退化成 /notes/${slug}/，建议在 frontmatter 里加 slug:`;
    }
    parsed.push({ file, name, title, slug, slugNote, data, content });
  }

  const linkMap = new Map();
  for (const p of parsed) {
    const href = `/notes/${p.slug}/`;
    linkMap.set(p.name, href);
    linkMap.set(p.title, href);
  }

  const warnings = parsed.filter((p) => p.slugNote).map((p) => p.slugNote);
  const written = [];

  for (const p of parsed) {
    let body = p.content;
    body = stripPrivate(body);
    body = stripEmbeds(body);
    body = scrubPaths(body);

    // [[目标]] / [[目标|别名]] / [[目标#小节|别名]]
    body = body.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => {
      const key = String(target).trim();
      const label = (alias ?? key).trim();
      const href = linkMap.get(key) ?? linkMap.get(key.replace(/\.md$/, ''));
      return href ? `[${label}](${href})` : label;
    });

    // 正文开头的 H1 由布局统一渲染，这里去掉，避免标题出现两次
    body = body.replace(/^\s*#\s+.*\n/, '');

    body = body.replace(/\n{3,}/g, '\n\n');

    if (/```mermaid/.test(body)) warnings.push(`${relative(VAULT, p.file)}：含 mermaid 图，前端未渲染，会显示为代码块`);

    const date =
      p.data.date ?? p.data.created ?? p.data.createdAt ?? p.data.updated ?? new Date();
    const dateStr = new Date(date).toISOString().slice(0, 10);

    const tags = Array.isArray(p.data.tags)
      ? p.data.tags
      : typeof p.data.tags === 'string'
        ? p.data.tags.split(/[,，\s]+/).filter(Boolean)
        : [];

    const fm = {
      title: String(p.title).replace(/^["']|["']$/g, ''),
      description: p.data.description ? String(p.data.description) : firstParagraph(body),
      date: dateStr,
      ...(p.data.updated ? { updated: new Date(p.data.updated).toISOString().slice(0, 10) } : {}),
      tags,
      source: relative(VAULT, p.file),
      ...(p.data.progress ? { progress: String(p.data.progress) } : {}),
      draft: p.data.draft === true,
    };

    const out = ['---', ...Object.entries(fm).map(([k, v]) =>
      Array.isArray(v) ? `${k}: [${v.map((t) => JSON.stringify(t)).join(', ')}]` : `${k}: ${JSON.stringify(v)}`,
    ), '---', '', body.trim(), ''].join('\n');

    const dest = join(OUT_DIR, `${p.slug}.md`);
    written.push(`${p.slug}.md`);
    if (!DRY) await writeFile(dest, out, 'utf8');
  }

  // 清理上一轮生成、这一轮没有的文件
  let oldManifest = [];
  try {
    oldManifest = JSON.parse(await readFile(MANIFEST, 'utf8')).files ?? [];
  } catch {}
  const stale = oldManifest.filter((f) => !written.includes(f));
  for (const f of stale) {
    if (!DRY) await unlink(join(OUT_DIR, f)).catch(() => {});
  }
  if (!DRY) await writeFile(MANIFEST, JSON.stringify({ files: written }, null, 2) + '\n', 'utf8');

  // 报告
  console.log(`[sync-notes] vault: ${VAULT}`);
  console.log(`[sync-notes] 扫描 ${files.length} 个 md，公开 ${written.length} 篇${DRY ? '（dry-run，未写入）' : ''}`);
  for (const f of written) console.log(`  + ${f}`);
  for (const s of stale) console.log(`  - ${s}（源文件已撤销发布或删除）`);
  for (const w of warnings) console.warn(`  ! ${w}`);
  if (written.length === 0) {
    console.log('  提示：没有任何笔记带 publish: true，站上不会出现同步内容。');
  }
}

main().catch((err) => {
  console.error('[sync-notes] 失败：', err);
  process.exit(1);
});
