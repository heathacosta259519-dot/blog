import { getCollection } from 'astro:content';
import { url } from '../consts';

export type Entry = {
  title: string;
  description: string;
  date: Date;
  updated?: Date;
  kind: 'note' | 'essay';
  tags: string[];
  href: string;
  id: string;
  progress?: string;
};

const byDateDesc = (a: Entry, b: Entry) => b.date.getTime() - a.date.getTime();

/** 笔记 + 随笔，按时间倒序，草稿不参与 */
export async function allEntries(): Promise<Entry[]> {
  const [notes, essays] = await Promise.all([
    getCollection('notes', ({ data }) => !data.draft),
    getCollection('essays', ({ data }) => !data.draft),
  ]);

  const mapped: Entry[] = [
    ...notes.map((n) => ({
      title: n.data.title,
      description: n.data.description,
      date: n.data.date,
      updated: n.data.updated,
      kind: 'note' as const,
      tags: n.data.tags,
      href: url(`/notes/${n.id}/`),
      id: n.id,
      progress: n.data.progress,
    })),
    ...essays.map((e) => ({
      title: e.data.title,
      description: e.data.description,
      date: e.data.date,
      updated: e.data.updated,
      kind: 'essay' as const,
      tags: e.data.tags,
      href: url(`/essays/${e.id}/`),
      id: e.id,
    })),
  ];

  return mapped.sort(byDateDesc);
}

export async function entriesOf(kind: 'note' | 'essay'): Promise<Entry[]> {
  return (await allEntries()).filter((e) => e.kind === kind);
}

/** 标签 → 条目，按数量倒序 */
export async function tagIndex(): Promise<Map<string, Entry[]>> {
  const map = new Map<string, Entry[]>();
  for (const entry of await allEntries()) {
    for (const tag of entry.tags) {
      const list = map.get(tag) ?? [];
      list.push(entry);
      map.set(tag, list);
    }
  }
  return new Map([...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh')));
}

/** 中文按字算、西文按词算的粗估阅读时长 */
export function readingTime(body: string | undefined): number {
  if (!body) return 1;
  const cjk = (body.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const words = (body.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_]+/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}
