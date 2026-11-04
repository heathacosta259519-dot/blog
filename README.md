# 纸与墨

一个写给自己、顺便公开的个人博客。

线上地址：<https://heathacosta259519-dot.github.io/blog/>

写的三样东西：**学习笔记**（看完一章、踩过一个坑之后整理的那种）、**随笔**（想到哪写到哪）、**配置说明**（dotfiles 怎么组织、为什么这么组织 —— 配置文件本身不公开）。

技术上是 Astro 静态生成，零后端，推到 GitHub 就走 Actions 发到 Pages。

---

## 本地跑起来

```bash
pnpm install
pnpm dev        # http://localhost:4321/blog/   ← 注意带 /blog 前缀
pnpm build      # 先扫泄露，再生成 dist/
```

`/blog` 这个前缀来自 `astro.config.mjs` 里的 `BASE`，因为部署在项目页（`<user>.github.io/blog/`）而不是根域。改成本地不带前缀调试：

```bash
BASE_PATH=/ pnpm dev
```

## 内容从哪来

两条路，互不干扰：

- **随笔** —— 直接在 `src/content/essays/` 建 `.md` 手写。
- **笔记** —— 在 Obsidian 里写，用同步脚本单向搬过来。写了几年笔记的人不会想再维护第二份正文，所以博客里这几篇是生成物，只在库里改。

同步是单向前进的，并且**默认什么也不搬**：只有 frontmatter 里显式写了 `publish: true` 的笔记才会被复制。忘了写就等于不公开，这是刻意的。

```bash
pnpm sync:notes --dry    # 先看这次会动哪些文件
pnpm sync:notes          # 真同步
```

库的位置不写死在代码里。按顺序找：环境变量 `BLOG_VAULT` → 本地的 `scripts/sync.local.json`（已在 `.gitignore` 里，格式见下）→ 都没有就报错退出。

```json
{ "vault": "~/notes" }
```

只用 `pnpm dev` + 手写随笔的话，完全不需要这个文件 —— 同步脚本是给「已经有 Obsidian 库」的人准备的。

## 写一篇

**随笔**，在 `src/content/essays/` 下：

```yaml
---
title: 标题
description: 一句话摘要，列表页和 RSS 都用它
date: 2026-11-04
tags: [工具]
draft: false
---
```

**笔记**，在库里写，frontmatter 长这样：

```yaml
---
publish: true
title: Linux 文件权限速查
tags: [Linux, 速查]
date: 2026-10-30
slug: linux-permissions      # 可选；文件名没有 ASCII 字符时建议写，否则地址会退化成 note-xxxxxxxx
description: 可选，缺省时取正文第一段
progress: 读完《Linux 命令行大全》第 5 章后整理   # 可选，显示在文章页左侧信息栏
---
```

`draft: true` 的东西不进列表、RSS 和 sitemap。

## 同步到底做了什么

| 处理 | 结果 |
| :--- | :--- |
| `<!-- private -->…<!-- /private -->` | 整段删掉 |
| `%% … %%` | 整段删掉（Obsidian 注释） |
| `![[附件.png]]` | 删掉，附件不上传 |
| `[[笔记]]` / `[[笔记\|别名]]` | 目标也公开 → 站内链接；否则退化成纯文本 |
| 本机绝对路径 | 换成 `~/…` |
| 正文开头的 `# 标题` | 去掉（标题由模板渲染） |
| mermaid 代码块 | 原样保留，但前端不渲染，会显示成代码块 |

源笔记取消 `publish` 或整个删掉，下次同步会把对应文件一起清掉。记录在 `src/content/notes/.sync-manifest.json`，手写的内容不在清单里，不会被误删。

## 发布闸门

博客里最怕的是「把不该公开的东西顺手推上去」，所以闸门有两道：

1. **同步时**只搬 `publish: true`，顺手剥掉私有区块和本机路径。
2. **构建前**跑 `scripts/check-leaks.mjs`，扫 `src/`、`public/` 和本 README，命中就让构建失败 —— 本机用户目录、外部挂载路径、GitHub/OpenAI/AWS 一类密钥、私钥块、内网地址、明文口令。

`pnpm build` 第一件事就是它，所以 CI 上也跑，绕不过去。

误报怎么放行：在 `scripts/leak-allowlist.txt` 加一行特征串，写清原因。个人额外想拦的东西放 `scripts/leak-rules.local.json`（不进仓库），格式是 `[[正则, 说明], …]`。

## 部署

推到 `main` 触发 `.github/workflows/deploy.yml`：`pnpm install --frozen-lockfile` → `pnpm build`（含泄露检查）→ 上传并发布 Pages。

仓库设置里 Pages 的 Source 必须是 **GitHub Actions**；选 "Deploy from a branch" 的话 `deploy-pages` 会报 `Get Pages site failed`。

## 结构

```
src/
  consts.ts            站点信息与 url() —— 站内链接一律走它，换 base 不用全站搜
  content.config.ts    两个集合的表结构：essays（随笔）、notes（笔记）
  content/             文章本体
  layouts/             BaseLayout（头尾/主题/动效）、EntryLayout（文章页）
  components/          EntryList（列表）
  lib/                 content.ts（取数与排序）、date.ts（一律按 UTC 格式化）
  styles/global.css    全部样式：tokens → base → prose → 组件
  pages/               路由；notes 与 essays 用 [...] 动态路由
scripts/
  sync-notes.mjs       第一道闸门：只搬 publish: true
  check-leaks.mjs      第二道闸门：构建前扫描
```

改配色只动 `global.css` 顶部的 `:root` 与 `html[data-theme='dark']` 两块；深色模式的代码高亮靠 `--shiki-dark` 系列变量。

## 换域名

```bash
SITE=https://example.com BASE_PATH=/ pnpm build
```

或者直接改 `astro.config.mjs` 里两个默认值。换成根域部署后，在 `public/CNAME` 写域名即可。
