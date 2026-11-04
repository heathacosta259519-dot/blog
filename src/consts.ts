/**
 * 全站唯一的配置出口：改名、改简介、改导航，都只动这里。
 */

export const SITE = {
  /** 站名，会出现在 masthead、<title>、RSS 里 */
  title: 'AKAGI_0612',
  /** 一句话简介，出现在首页 masthead 下方 */
  tagline: '学习笔记、日常琐事，和一些配置的来由。',
  description:
    'AKAGI_0612 的个人手记：编程学习笔记、日常随笔，以及 Arch Linux 配置背后的取舍。',
  author: 'AKAGI_0612',
  lang: 'zh-CN',
  locale: 'zh_CN',
  github: 'https://github.com/heathacosta259519-dot',
  email: '',
} as const;

/** 导航。顺序即显示顺序。 */
export const NAV = [
  { href: '/notes/', label: '笔记' },
  { href: '/essays/', label: '随笔' },
  { href: '/tags/', label: '标签' },
  { href: '/dotfiles/', label: 'dotfiles' },
  { href: '/about/', label: '关于' },
] as const;

/**
 * 把站内路径拼上 base（GitHub Pages 项目页在 /blog 下）。
 * 站内链接一律用它，别手写 href="/notes/"。
 */
export const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

export function url(path = '/'): string {
  if (/^(https?:|mailto:|#)/.test(path)) return path;
  const clean = path.replace(/^\/+/, '');
  return clean ? `${BASE}/${clean}` : `${BASE}/`;
}
