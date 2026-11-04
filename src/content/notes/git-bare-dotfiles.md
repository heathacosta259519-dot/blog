---
title: 用 bare 仓库管理 dotfiles：不用软链，不用 stow
description: 把 $HOME 本身当成工作区的一个取巧办法，以及它为什么比软链方案更省事、又更容易翻车。
date: 2026-10-12
tags: [Linux, Git, 配置]
draft: false
---

## 思路

常规做法是把配置攒在一个 `~/dotfiles` 里，再往 `$HOME` 建一堆软链；或者用 GNU stow 批量建。软链方案的麻烦在于：路径一多，`ls -la ~` 里全是箭头，出问题时得先分清"这个文件是真的还是链过去的"。

bare 仓库方案反过来：**Git 目录放在 `~/.dotfiles.git`，工作区就是 `$HOME` 本身**。没有软链，文件就在原位；Git 只是从另一个位置盯着它们。

```bash
git init --bare "$HOME/.dotfiles.git"
```

然后用别名把它伪装成普通 git 命令：

```bash
# ~/.bashrc
alias dot='/usr/bin/git --git-dir=$HOME/.dotfiles.git --work-tree=$HOME'
```

之后所有操作都走 `dot`：

```bash
dot add ~/.bashrc
dot commit -m "bash: 加 zh 消息别名"
dot push
```

## 必须做的两件事

### 1. 让 status 别把整个家目录吐出来

第一次跑 `dot status` 会列出 `$HOME` 下所有未跟踪文件——几千行。把未跟踪文件藏掉：

```bash
dot config --local status.showUntrackedFiles no
```

这是 `--local`，写进 `~/.dotfiles.git/config`，不会污染全局 git 配置。

### 2. 用 exclude 当白名单的反面

`showUntrackedFiles no` 解决了"看不见"，但 `dot add -A` 依然可能把不该进仓库的东西吞进去（`.ssh`、浏览器缓存、各种 token）。所以维护一份排除清单：

```gitignore
# ~/.dotfiles.git/info/exclude
*
!.bashrc
!.bash_profile
!.gitconfig
!.config/nvim/
!.config/niri/
!.config/waybar/
```

`*` 先把一切排除，再逐条放行。**默认全私密，显式开一条放一条**，和写 `.gitignore` 的思路正好相反，但在这里更安全。

## 换机器怎么恢复

```bash
git clone --bare <repo-url> "$HOME/.dotfiles.git"
alias dot='/usr/bin/git --git-dir=$HOME/.dotfiles.git --work-tree=$HOME'
dot config --local status.showUntrackedFiles no
dot checkout
```

`dot checkout` 会直接往 `$HOME` 里写文件，所以**新机器上先 checkout 再干别的**，否则已有同名文件会挡路（报 `would be overwritten`，删掉或备份后重跑即可）。

## 什么时候它会翻车

| 场景 | 后果 | 处理 |
| :--- | :--- | :--- |
| 在 `$HOME` 里 `git add -A` | 把整个家目录（含密钥）提交 | 永远用 `dot` 别名，且 `info/exclude` 先写好 |
| 多台机器配置不同 | 冲突天天有 | 主机差异化用 `includeIf`，见下 |
| 仓库推到了公开远端 | 配置里的 token、订阅链接全泄露 | 仓库保持 private；推之前跑一遍密钥扫描 |

主机差异用条件 include，而不是给每台机器开分支：

```gitconfig
# ~/.gitconfig
[includeIf "gitdir:/media/external/"]
	path = ~/.config/git/ntfs.conf
```

## 和博客的关系

配置仓库保持私有，博客上只写**取舍的理由**：为什么 niri 而不是 Hyprland、waybar 的自定义模块怎么分层、nvim 配色生成器怎么算对比度。配置文件两年就过时了，理由不会。
