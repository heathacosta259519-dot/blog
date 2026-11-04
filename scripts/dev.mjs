#!/usr/bin/env node
/**
 * 一条命令写完流程：先同步一次，然后一边盯着库改、一边跑 astro dev。
 *
 *   pnpm dev            # 同步 + 预览（笔记一保存，浏览器就更新）
 *   pnpm dev --no-sync  # 只想看站，不碰笔记库
 *
 * 没配置笔记库时自动降级成纯 astro dev，不报错退出 —— clone 下来的人也能直接跑。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SYNC = fileURLToPath(new URL('./sync-notes.mjs', import.meta.url));
const noSync = process.argv.includes('--no-sync');

const children = [];
const stop = (code = 0) => {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function run(cmd, args, name) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code) => {
    // 同步脚本 exit 2 = 没配库，属于正常降级，让 astro 继续跑
    if (code === 2 && name === 'sync') {
      console.log('[dev] 没有配置笔记库，跳过同步，只跑预览。');
      return;
    }
    if (code !== 0 && code !== null) stop(code);
  });
  return child;
}

if (!noSync) run(process.execPath, [SYNC, '--watch'], 'sync');
run(process.execPath, [fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url)), 'dev'], 'astro');
