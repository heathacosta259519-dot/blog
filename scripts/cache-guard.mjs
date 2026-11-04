#!/usr/bin/env node
/**
 * astro 把解析好的内容条目缓存在 data-store.json 里，条目记着源文件路径。
 * 文件被删掉之后（撤销发布、清理测试数据、目录整个没了）缓存还指着它，
 * dev / build 一起来就 ENOENT 崩掉 —— 这个坑今天踩过一次，留个哨兵。
 *
 * 位置随版本变过：老版本在 .astro/，现在在 node_modules/.astro/，两个都看。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const STORES = [
  join('node_modules', '.astro', 'data-store.json'),
  join('.astro', 'data-store.json'),
];

export function dropStaleCache({ quiet = false } = {}) {
  let cleared = 0;

  for (const rel of STORES) {
    const store = join(ROOT, rel);
    if (!existsSync(store)) continue;
    const cacheDir = join(ROOT, rel, '..');

    let raw;
    try {
      raw = JSON.parse(readFileSync(store, 'utf8'));
    } catch {
      rmSync(cacheDir, { recursive: true, force: true });
      if (!quiet) console.log(`[cache] ${rel} 读不动，清掉了`);
      cleared += 1;
      continue;
    }

    const missing = [];
    const walk = (node) => {
      if (typeof node === 'string') {
        // 只认仓库内的内容路径；frontmatter 里的 source: 是库那边的路径，不是这个尺度
        if (node.startsWith('src/') && node.endsWith('.md') && !existsSync(join(ROOT, node))) {
          missing.push(node);
        }
        return;
      }
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') return Object.values(node).forEach(walk);
    };
    walk(raw);

    if (missing.length) {
      rmSync(cacheDir, { recursive: true, force: true });
      if (!quiet) {
        console.log(`[cache] ${missing.length} 个缓存条目指向的文件已经不在了，清掉重建`);
        for (const m of missing.slice(0, 3)) console.log(`        ${m}`);
      }
      cleared += 1;
    }
  }

  return cleared;
}

if (import.meta.url === `file://${process.argv[1]}`) dropStaleCache();
