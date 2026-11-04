/**
 * 日期一律按 UTC 读：frontmatter 里的 `2026-11-04` 会被解析成 UTC 零点，
 * 用本地时区去 format 就会在前一天显示（UTC-8 直接退一天）。
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** 2026.11.04 */
export function dot(d: Date): string {
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
}

/** 2026 年 11 月 4 日 */
export function long(d: Date): string {
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
}

/** 2026-11-04 */
export function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
