import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 一个集合，两套目录：
 *  - essays/：手写的日常，直接写在这个仓库里
 *  - notes/ ：从 Obsidian 库同步过来的，只读，别手改（会被 sync 覆盖）
 *
 * 之所以只用一个集合：站上算「笔记」还是「随笔」是文章自己的属性（kind），
 * 不是它躺在哪个目录里。分两个集合的话，任意一边空着都会在每次构建时刷
 * "collection is empty" 的警告，真报错时反而不容易看见。
 *
 * 目录只决定 id 前缀（notes/xxx、essays/xxx），URL 由 kind 决定。
 */
const base = {
  title: z.string(),
  /** 一句话摘要，列表页和 og:description 都用它 */
  description: z.string(),
  date: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  /** false 或省略时不参与构建（同步脚本也会跳过） */
  draft: z.boolean().default(false),
  /** 站上的分类：随笔还是笔记。同步脚本会照源文件的 kind 写进来 */
  kind: z.enum(['note', 'essay']).default('note'),
  /** 原始文件路径，方便回溯到 Obsidian */
  source: z.string().optional(),
  /** 学习进度之类的补充信息，只在笔记里用 */
  progress: z.string().optional(),
};

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content' }),
  schema: z.object(base),
});

export const collections = { posts };
