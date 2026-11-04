import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 两套内容，同一个 schema：
 *  - essays：手写的日常，直接写在这个仓库里
 *  - notes ：从 Obsidian 库同步过来的学习笔记，只读，别手改（会被 sync 覆盖）
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
};

const essays = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/essays' }),
  schema: z.object({
    ...base,
    /** 随笔不显示在“笔记”流里 */
    kind: z.literal('essay').default('essay'),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    ...base,
    kind: z.literal('note').default('note'),
    /** 原始笔记标题，方便回溯到 Obsidian */
    source: z.string().optional(),
    /** 学习进度之类的补充信息 */
    progress: z.string().optional(),
  }),
});

export const collections = { essays, notes };
