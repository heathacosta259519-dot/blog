#!/usr/bin/env node
/**
 * 发布闸门（第一道）：把 Obsidian 库里的文章单向同步到 src/content/notes/。
 *
 * 两个来源，规则不同：
 *   blog 目录（默认 <vault>/blog）—— 目录里的一切都公开，给专门的写作库用
 *   notes 目录（默认整个 vault）—— 只有 frontmatter 里 `publish: true` 的才公开
 * 两头都可以用 `publish: false` / `draft: true` 单独扣下一篇。
 *
 * 每一篇都会做：剥私有区块、复制并改写图片、改写双链、抹掉本机路径。
 * 生成物带标记，别手改 —— 下次同步会覆盖；源文件撤销发布就跟着删。
 *
 * 用法：
 *   node scripts/sync-notes.mjs            # 同步一次
 *   node scripts/sync-notes.mjs --dry      # 只看会发生什么
 *   node scripts/sync-notes.mjs --watch    # 盯着改，保存即同步
 *   BLOG_VAULT=~/notes node scripts/sync-notes.mjs
 *
 * 退出码：0 同步完成；1 出错；2 没有配置笔记库（调用方可以忽略）
 */
import fg from 'fast-glob';
import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_DIR = join(ROOT, 'src', 'content');
/** 两个集合，各走各的目录；分类由 frontmatter 的 kind 决定，不由来源目录决定 */
const OUT_DIRS = { note: join(CONTENT_DIR, 'notes'), essay: join(CONTENT_DIR, 'essays') };
const ATTACH_DIR = join(ROOT, 'public', 'attachments');
const MANIFEST = join(OUT_DIRS.note, '.sync-manifest.json');
const LOCAL_CONFIG = join(ROOT, 'scripts', 'sync.local.json');
const BASE = (process.env.BASE_PATH ?? '/blog').replace(/\/$/, '');

const DRY = process.argv.includes('--dry');
const WATCH = process.argv.includes('--watch');

const SKIP_NAMES = new Set(['AGENTS.md', 'README.md', 'index.md', '欢迎.md', 'Welcome.md']);
const SKIP_DIRS = ['**/.obsidian/**', '**/.git/**', '**/node_modules/**', '**/_*/**', '**/.trash/**'];

/** 会被复制到 public/attachments/ 的类型 */
const ATTACH_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp',
  '.mp4', '.webm', '.mp3', '.pdf',
]);

const expand = (p) => p.replace(/^~(?=$|\/)/, homedir());

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

const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

// ───────────────────────────── 配置 ─────────────────────────────

async function resolveConfig() {
  let raw = {};
  try {
    raw = JSON.parse(await readFile(LOCAL_CONFIG, 'utf8'));
  } catch {
    /* 没有本地配置就看环境变量 */
  }
  const vault = process.env.BLOG_VAULT ?? raw.vault;
  if (!vault) {
    console.error(
      '[sync-notes] 没有找到笔记库。二选一：\n' +
        '  BLOG_VAULT=~/notes pnpm sync:notes\n' +
        '  或写 scripts/sync.local.json：{ "vault": "~/notes", "blog": "blog" }  （不进仓库）',
    );
    process.exit(2);
  }
  return {
    vault: expand(vault),
    /** 写作库：目录里的全部公开 */
    blog: process.env.BLOG_BLOG ?? raw.blog ?? 'blog',
    /** 学习笔记：只搬 publish: true */
    notes: process.env.BLOG_NOTES ?? raw.notes ?? '.',
  };
}

// ───────────────────────────── 同步主流程 ─────────────────────────────

async function run(cfg) {
  const VAULT = cfg.vault;
  const blogDir = cfg.blog ? join(VAULT, cfg.blog) : null;
  const notesDir = cfg.notes ? join(VAULT, cfg.notes) : null;

  const sources = [];
  if (blogDir) sources.push({ kind: 'folder', dir: blogDir });
  // notes 目录覆盖整个 vault 时，把 blog 目录排除掉，免得同一篇被搬两遍
  if (notesDir && notesDir !== blogDir) {
    sources.push({
      kind: 'frontmatter',
      dir: notesDir,
      ignore: blogDir ? [relative(notesDir, blogDir) + '/**'] : [],
    });
  }

  const warnings = [];
  const files = [];
  for (const src of sources) {
    let exists = true;
    try {
      exists = (await stat(src.dir)).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      if (src.kind === 'folder') warnings.push(`写作库目录不存在：${src.dir}（跳过）`);
      continue;
    }
    const found = await fg('**/*.md', {
      cwd: src.dir,
      ignore: [...SKIP_DIRS, ...(src.ignore ?? [])],
      absolute: true,
    });
    for (const file of found) files.push({ file, kind: src.kind });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));

  // 第一趟：定 slug、定标题，顺带收集双链映射
  const parsed = [];
  for (const { file, kind } of files) {
    if (SKIP_NAMES.has(basename(file))) continue;
    const raw = await readFile(file, 'utf8');
    const { data, content } = matter(raw);

    const optedOut = data.publish === false || data.draft === true;
    if (optedOut) continue;
    if (kind === 'frontmatter' && data.publish !== true) continue;

    const name = basename(file, '.md');
    const title = data.title || firstHeading(content) || name;
    // 中文文件名直接用，地址就是 /notes/第一篇笔记/ —— 浏览器显示的就是可读的中文
    let slug = data.slug ? slugify(String(data.slug)) : slugify(name);
    let slugNote = null;
    if (!slug) {
      slug = 'note-' + createHash('sha1').update(relative(VAULT, file)).digest('hex').slice(0, 8);
      slugNote = `${relative(VAULT, file)}：文件名里没有可用字符，地址退化成 /notes/${slug}/，建议在 frontmatter 写 slug:`;
    }
    // 站上的分类：frontmatter 的 kind 说了算。
    //   kind: essay → 随笔，kind: note → 笔记
    //   不写的时候按来源猜：写作库（blog 目录）是随笔，Learning 里的是笔记。
    const rawKind = String(data.kind ?? '').trim().toLowerCase();
    let entryKind;
    let kindNote = null;
    if (rawKind === 'essay' || rawKind === '随笔') entryKind = 'essay';
    else if (rawKind === 'note' || rawKind === '笔记') entryKind = 'note';
    else if (rawKind) {
      entryKind = kind === 'folder' ? 'essay' : 'note';
      kindNote = `${relative(VAULT, file)}：kind 只认 note/essay（或 笔记/随笔），"${data.kind}" 看不懂，按来源当作${entryKind === 'essay' ? '随笔' : '笔记'}`;
    } else {
      entryKind = kind === 'folder' ? 'essay' : 'note';
    }
    let mtime = new Date();
    try {
      mtime = (await stat(file)).mtime;
    } catch {}
    parsed.push({ file, kind, entryKind, kindNote, name, title, slug, slugNote, data, content, mtime });
  }

  // 这两个目录必须一直在：astro 的内容缓存记着上一轮的条目，目录整个消失时
  // dev server 会去 open 一个不存在的文件，直接 ENOENT 崩掉。
  if (!DRY) {
    for (const dir of Object.values(OUT_DIRS)) await mkdir(dir, { recursive: true });
  }

  const linkMap = new Map();
  for (const p of parsed) {
    const href = `${BASE}/${p.entryKind === 'essay' ? 'essays' : 'notes'}/${p.slug}/`;
    linkMap.set(p.name, href);
    linkMap.set(p.title, href);
  }
  for (const p of parsed) if (p.slugNote) warnings.push(p.slugNote);
  for (const p of parsed) if (p.kindNote) warnings.push(p.kindNote);

  // 附件索引：只在真的遇到 ![[附件]] 时才扫，省一次全库遍历
  let attachIndex = null;
  const attachments = new Map(); // 源绝对路径 → 输出文件名
  async function ensureAttachIndex() {
    if (attachIndex) return attachIndex;
    attachIndex = new Map();
    const found = await fg(`**/*{${[...ATTACH_EXT].join(',')}}`, {
      cwd: VAULT,
      ignore: SKIP_DIRS,
      absolute: true,
    });
    for (const f of found) {
      const key = basename(f);
      if (!attachIndex.has(key)) attachIndex.set(key, f);
      attachIndex.set(relative(VAULT, f), f);
    }
    return attachIndex;
  }

  const written = [];
  for (const p of parsed) {
    let body = stripPrivate(p.content);
    body = scrubPaths(body);

    // ![[图片.png]] / ![[图片.png|300]] / ![[图片.png|图注]] / ![[另一篇笔记]]
    const embeds = [...body.matchAll(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)];
    for (const [whole, target, param] of embeds) {
      const t = String(target).trim();
      const ext = extname(t).toLowerCase();
      let replacement = '';
      if (ATTACH_EXT.has(ext)) {
        const idx = await ensureAttachIndex();
        const src = idx.get(t) ?? idx.get(basename(t));
        if (!src) {
          warnings.push(`${relative(VAULT, p.file)}：找不到附件 ${t}，已删除该处引用`);
        } else {
          const outName = `${createHash('sha1').update(relative(VAULT, src)).digest('hex').slice(0, 8)}-${slugify(
            basename(src, ext),
          ) || 'file'}${ext}`;
          attachments.set(src, outName);
          const url = `${BASE}/attachments/${outName}`;
          const arg = (param ?? '').trim();
          if (/^\d+$/.test(arg)) {
            replacement = `<img src="${url}" alt="${basename(src, ext)}" width="${arg}" loading="lazy">`;
          } else {
            replacement = `![${arg || basename(src, ext)}](${url})`;
          }
        }
      } else {
        warnings.push(`${relative(VAULT, p.file)}：![[${t}]] 是笔记嵌入，站上不支持，已改成纯文本链接`);
        const label = t.replace(/\.md$/, '');
        const href = linkMap.get(label);
        replacement = href ? `[${label}](${href})` : label;
      }
      body = body.replace(whole, replacement);
    }

    // [[目标]] / [[目标|别名]] / [[目标#小节|别名]]
    body = body.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => {
      const key = String(target).trim();
      const label = (alias ?? key).trim();
      const href = linkMap.get(key) ?? linkMap.get(key.replace(/\.md$/, ''));
      return href ? `[${label}](${href})` : label;
    });

    // 开头的 H1 由布局渲染，去掉避免重复
    body = body.replace(/^\s*#\s+.*\n/, '');
    body = body.replace(/\n{3,}/g, '\n\n');

    // 刚建出来还没写字的文件别发上去，免得站上多一个空白页
    if (!body.trim()) {
      warnings.push(`${relative(VAULT, p.file)}：正文还是空的，先不同步`);
      continue;
    }

    const date = p.data.date ?? p.data.created ?? p.data.createdAt ?? p.mtime;
    const tags = Array.isArray(p.data.tags)
      ? p.data.tags
      : typeof p.data.tags === 'string'
        ? p.data.tags.split(/[,，\s]+/).filter(Boolean)
        : [];

    const fm = {
      title: String(p.title).replace(/^["']|["']$/g, ''),
      description: p.data.description ? String(p.data.description) : firstParagraph(body),
      date: isoDay(date),
      kind: p.entryKind,
      ...(p.data.updated ? { updated: isoDay(p.data.updated) } : {}),
      tags,
      source: relative(VAULT, p.file),
      ...(p.data.progress ? { progress: String(p.data.progress) } : {}),
      draft: false,
    };

    const out = [
      '---',
      ...Object.entries(fm).map(([k, v]) =>
        Array.isArray(v) ? `${k}: [${v.map((t) => JSON.stringify(t)).join(', ')}]` : `${k}: ${JSON.stringify(v)}`,
      ),
      '---',
      '',
      body.trim(),
      '',
    ].join('\n');

    const dir = OUT_DIRS[p.entryKind];
    written.push({ kind: p.entryKind, file: `${p.slug}.md` });
    if (!DRY) {
      const dest = join(dir, `${p.slug}.md`);
      const prev = await readFile(dest, 'utf8').catch(() => null);
      if (prev !== out) await writeFile(dest, out, 'utf8');
    }
  }

  const attachNames = [...attachments.values()];

  // 复制附件（体积不变就跳过，省 IO）
  if (!DRY && attachments.size > 0) await mkdir(ATTACH_DIR, { recursive: true });
  for (const [src, outName] of attachments) {
    if (DRY) continue;
    const dest = join(ATTACH_DIR, outName);
    try {
      const [a, b] = await Promise.all([stat(src), stat(dest)]);
      if (a.size === b.size) continue;
    } catch {}
    await copyFile(src, dest);
  }

  // 清理上一轮有、这一轮没有的
  // 清单记 { note: [...], essay: [...] }，两类各自对账，跨类移动也算删除 + 新增
  let old = { note: [], essay: [], attachments: [] };
  try {
    const raw = JSON.parse(await readFile(MANIFEST, 'utf8'));
    // 老清单是 { files: [...] }，那时不分类型、全在 notes/ 下 —— 当作笔记对账
    old = {
      note: raw.note ?? raw.files ?? [],
      essay: raw.essay ?? [],
      attachments: raw.attachments ?? [],
    };
  } catch {}
  const stale = [];
  for (const kind of ['note', 'essay']) {
    const now = written.filter((w) => w.kind === kind).map((w) => w.file);
    for (const f of old[kind] ?? []) {
      if (!now.includes(f)) stale.push({ kind, file: f });
    }
  }
  const staleAttach = old.attachments.filter((f) => !attachNames.includes(f));
  if (!DRY) {
    for (const { kind, file } of stale) await unlink(join(OUT_DIRS[kind], file)).catch(() => {});
    for (const f of staleAttach) await unlink(join(ATTACH_DIR, f)).catch(() => {});
    const manifest = {
      note: written.filter((w) => w.kind === 'note').map((w) => w.file),
      essay: written.filter((w) => w.kind === 'essay').map((w) => w.file),
      attachments: attachNames,
    };
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }

  // 报告
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const counts = { note: 0, essay: 0 };
  for (const w of written) counts[w.kind] += 1;
  console.log(
    `[sync-notes ${stamp}] ${written.length} 篇（随笔 ${counts.essay} / 笔记 ${counts.note}），${attachNames.length} 个附件${DRY ? '（dry-run）' : ''}`,
  );
  for (const w of written) console.log(`  + ${w.kind === 'essay' ? 'essays' : 'notes'}/${w.file}`);
  for (const s of stale) console.log(`  - ${s.kind === 'essay' ? 'essays' : 'notes'}/${s.file}（源文件已撤回发布、删除或改了分类）`);
  for (const s of staleAttach) console.log(`  - attachments/${s}`);
  for (const w of warnings) console.warn(`  ! ${w}`);
  if (WRITE_HINT && written.length === 0) {
    console.log(`  提示：写作库 ${blogDir} 里还没有 md；或给学习笔记加 publish: true。`);
  }
}

const WRITE_HINT = true;

// ───────────────────────────── 入口 ─────────────────────────────

const cfg = await resolveConfig();

if (!WATCH) {
  await run(cfg);
  process.exit(0);
}

await run(cfg);
console.log('[sync-notes] 进入 watch，保存即同步（Ctrl-C 退出）');

let timer = null;
const dirs = [cfg.blog ? join(cfg.vault, cfg.blog) : null, cfg.notes ? join(cfg.vault, cfg.notes) : null].filter(Boolean);
for (const dir of new Set(dirs)) {
  try {
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (/\.(md|mdx)$/i.test(filename) === false && !ATTACH_EXT.has(extname(filename).toLowerCase())) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        run(cfg).catch((err) => console.error('[sync-notes] 同步失败：', err.message));
      }, 350);
    });
  } catch (err) {
    console.warn(`[sync-notes] 无法监视 ${dir}：${err.message}`);
  }
}
