# 纸与墨

一个写给自己、顺便公开的个人博客。

线上地址：<https://heathacosta259519-dot.github.io/blog/>

写的三样东西：**学习笔记**（看完一章、踩过一个坑之后整理的那种）、**随笔**（想到哪写到哪）、**配置说明**（dotfiles 怎么组织、为什么这么组织 —— 配置文件本身不公开）。

技术上是 Astro 静态生成，零后端，推到 GitHub 就走 Actions 发到 Pages。

---

## 先装上这条命令

```bash
ln -sf ~/AAAmySpace/Project/blog/tools/blog.py ~/.local/bin/blog
```

之后在哪个目录都是这一条命令：

| 命令 | 干什么 |
| :--- | :--- |
| `blog new 标题 --tags Linux,速查` | 写作库里建一篇（frontmatter + 提示块写好），顺手打开编辑器 |
| `blog dev` | 同步 + 预览，存盘即更新 |
| `blog list` | 站上现在有什么，几篇、几字 |
| `blog draft 关键词` / `blog hide 关键词` | 把 `Learning` 里的某篇公开，或者撤下来 |
| `blog ship` | 构建（含泄露扫描）→ 提交 → 推送 → 等部署结果 |
| `blog open 关键词` | 浏览器打开线上那一页 |
| `blog check` / `blog build` / `blog sync` | 单独的闸门、构建、同步 |
| `blog status` | 不带参数时就是它：库在哪、几篇、工作区脏不脏 |

`blog ship` 是完整的一条：任何一道闸门不过就不提交，提交信息不给就按日期自动写。下面那些 `pnpm` 命令都还能用，CLI 只是把常用动作串起来。

## 本地跑起来

```bash
pnpm install
pnpm dev        # 同步一次 → 盯着笔记库 → 起预览 http://localhost:4321/blog/
```

`pnpm dev` 起两个进程：一个 watch 笔记库（存盘即同步），一个跑 `astro dev`。所以写完笔记切到浏览器，内容已经在上面了，不用记得手动跑同步。

只想看站、不碰笔记库：

```bash
pnpm dev --no-sync      # 或者 pnpm dev:plain
```

`/blog` 这个前缀来自 `astro.config.mjs` 里的 `BASE`，因为部署在项目页（`<user>.github.io/blog/`）而不是根域。本地想去掉前缀：`BASE_PATH=/ pnpm dev`。

## 内容从哪来

三处，按你写东西的习惯挑：

| 位置 | 规则 | 适合 |
| :--- | :--- | :--- |
| 写作库 `Blog_dosc/blog/`（独立 Obsidian 库） | 目录里的一切都公开 | 正经博文，写什么发什么 |
| 学习笔记 `Learning/` | 只有 `publish: true` 的才公开 | 从旧笔记里挑着公开 |
| 仓库里的 `src/content/essays/` | 直接就是文章 | 短随笔，不经过 Obsidian |

两个 Obsidian 来源靠 `scripts/sync.local.json` 指路（不进仓库，写在本地）：

```json
{ "vault": "~/AAAmySpace", "blog": "Blog_dosc/blog", "notes": "Learning" }
```

`vault` 是库根、`blog` 是写作库的相对路径、`notes` 是旧笔记目录。也可以用环境变量逐个覆盖：`BLOG_VAULT` / `BLOG_BLOG` / `BLOG_NOTES`。没配置的话脚本以退出码 2 结束，`pnpm dev` 会自动降级成纯预览，clone 下来的人不会卡住。

同步是单向的：库里是唯一的正文，博客里的文件是生成物，手改会被下次同步覆盖。

```bash
pnpm sync:notes --dry    # 先看这次会动哪些文件
pnpm sync:notes          # 真同步一次
pnpm sync:watch          # 常驻，存盘即同步
```

## 写一篇

写作库里已经放好了骨架 `_templates/文章.md`。Obsidian → 设置 → 模板 → 模板文件夹填 `_templates`，之后命令面板「插入模板」或绑个快捷键，新文章就带好了 frontmatter 和那段只在 Obsidian 里看得见的提示（`%%` 包住的说明同步时会被删掉）。

frontmatter 只认这几个键：

```yaml
---
date: 2026-11-04          # 排序用；没有就取文件修改时间
tags: [Linux, 速查]       # 变成站上的标签
title: 可选               # 缺省取文件名或正文第一个 H1
slug: 可选               # 想换地址时写；默认直接拿文件名，中文也行
description: 可选         # 缺省取正文第一段
progress: 读完《…》第 5 章后整理   # 可选，显示在文章页左侧信息栏
publish: false            # 可选，在写作库里单独扣下一篇
---
```

`draft: true` 的东西不进列表、RSS 和 sitemap。

## 同步到底做了什么

| 处理 | 结果 |
| :--- | :--- |
| `<!-- private -->…<!-- /private -->` | 整段删掉 |
| `%% … %%` | 整段删掉（Obsidian 注释） |
| `![[图片.png]]` | 复制到 `public/attachments/`，改写成正常的图片引用 |
| `![[图片.png\|300]]` | 同上，并限制宽度 300px |
| `![[另一篇笔记]]` | 目标也公开 → 转成站内链接；否则退化成纯文本 |
| `[[笔记]]` / `[[笔记\|别名]]` | 同上 |
| 本机绝对路径 | 换成 `~/…` |
| 正文开头的 `# 标题` | 去掉（标题由模板渲染） |
| 正文还是空的 | 先不同步，免得站上多一个空白页 |
| mermaid 代码块 | 前端渲染成图，跟着主题换配色 |

源文件取消发布或删掉，下次同步会把对应文件和图片一起清干净 —— 记录在 `src/content/notes/.sync-manifest.json`，手写的内容不在清单里，不会被误删。

## 发布闸门

博客里最怕的是「把不该公开的东西顺手推上去」，所以闸门有两道：

1. **同步时**只搬该搬的（写作库全量、旧笔记按 `publish: true`），顺手剥掉私有区块和本机路径。
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
  content/             文章本体（notes/ 里是同步产物）
  layouts/             BaseLayout（头尾/主题/动效）、EntryLayout（文章页 + mermaid）
  components/          EntryList（列表）
  lib/                 content.ts（取数与排序）、date.ts（一律按 UTC 格式化）
  styles/global.css    全部样式：tokens → base → prose → 组件
  pages/               路由；notes 与 essays 用 [...] 动态路由
public/attachments/    同步过来的图片（生成物）
scripts/
  dev.mjs              一条命令：同步 + watch + dev server
  sync-notes.mjs       第一道闸门：搬写作库、挑 publish: true、处理图片与双链
  check-leaks.mjs      第二道闸门：构建前扫描
tools/
  blog.py              上面那条 blog 命令，纯标准库，无依赖
```

改配色只动 `global.css` 顶部的 `:root` 与 `html[data-theme='dark']` 两块；深色模式的代码高亮靠 `--shiki-dark` 系列变量。

## 换域名

```bash
SITE=https://example.com BASE_PATH=/ pnpm build
```

或者直接改 `astro.config.mjs` 里两个默认值。换成根域部署后，在 `public/CNAME` 写域名即可。
