#!/usr/bin/env python3
"""blog —— 这个博客的唯一入口。写完一篇到发上线，全都不用离开这条命令。

    blog new 标题           在写作库建一篇，带好 frontmatter，顺手打开编辑器
    blog dev                同步 + 预览（存盘即更新）
    blog list               站上现在有什么
    blog draft 关键词       把 Learning 里的某篇笔记加进公开列表
    blog hide 关键词        撤下来
    blog ship               检查 → 构建 → 提交 → 推送 → 等部署
    blog open 关键词        浏览器打开线上那一页

配置从 scripts/sync.local.json 读（不进仓库）：vault / blog / notes 三个路径。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import urllib.parse
import webbrowser
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYNC = ROOT / "scripts" / "sync-notes.mjs"
DEV = ROOT / "scripts" / "dev.mjs"
CONFIG = ROOT / "scripts" / "sync.local.json"

SITE = "https://heathacosta259519-dot.github.io/blog"


# ─────────────────────────── 小工具 ───────────────────────────


def die(msg: str, code: int = 1):
    print(f"✗ {msg}", file=sys.stderr)
    raise SystemExit(code)


def ok(msg: str):
    print(f"✓ {msg}")


def run(cmd: list[str], *, cwd: Path = ROOT, capture: bool = False, check: bool = True):
    """跑一条命令；capture 时返回字符串，否则直接继承终端输出。"""
    if capture:
        p = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
        if check and p.returncode != 0:
            die(f"命令失败：{' '.join(cmd)}\n{p.stdout}{p.stderr}")
        return p.stdout.strip()
    p = subprocess.run(cmd, cwd=cwd)
    if check and p.returncode != 0:
        raise SystemExit(p.returncode)
    return ""


def need(binary: str, hint: str):
    if shutil.which(binary) is None:
        die(f"找不到 {binary}。{hint}")


def load_config() -> dict:
    """vault / blog / notes 三个路径；环境变量优先，和同步脚本保持一致。"""
    cfg = {}
    if CONFIG.exists():
        try:
            cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            die(f"{CONFIG} 不是合法 JSON：{e}")
    vault = os.environ.get("BLOG_VAULT") or cfg.get("vault")
    if not vault:
        die("没有配置笔记库：写 scripts/sync.local.json，例如 {\"vault\": \"~/AAAmySpace\", \"blog\": \"Blog_dosc/blog\"}")
    vault = Path(os.path.expanduser(vault))
    blog_dir = vault / (os.environ.get("BLOG_BLOG") or cfg.get("blog") or "blog")
    notes_dir = vault / (os.environ.get("BLOG_NOTES") or cfg.get("notes") or ".")
    return {
        "vault": vault,
        "blog": blog_dir,
        "notes": notes_dir,
        "base": (os.environ.get("BASE_PATH") or "/blog").rstrip("/"),
    }


def frontmatter_split(text: str) -> tuple[str | None, str]:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[3:end].strip("\n"), text[end + 4 :]
    return None, text


def frontmatter_get(fm: str | None, key: str) -> str | None:
    if not fm:
        return None
    m = re.search(rf"^{re.escape(key)}:\s*(.*)$", fm, re.M)
    return m.group(1).strip().strip('"\'') if m else None


def frontmatter_set(path: Path, key: str, value: str) -> None:
    text = path.read_text(encoding="utf-8")
    fm, rest = frontmatter_split(text)
    if fm is None:
        path.write_text(f"---\n{key}: {value}\n---\n\n{text.lstrip()}", encoding="utf-8")
        return
    line = f"{key}: {value}"
    if re.search(rf"^{re.escape(key)}:", fm, re.M):
        fm = re.sub(rf"^{re.escape(key)}:.*$", line, fm, count=1, flags=re.M)
    else:
        fm = f"{fm}\n{line}"
    path.write_text(f"---\n{fm}\n---{rest}", encoding="utf-8")


def md_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    out = []
    for p in root.rglob("*.md"):
        parts = set(p.parts)
        if ".obsidian" in parts or ".git" in parts or "node_modules" in parts or ".trash" in parts:
            continue
        if any(seg.startswith("_") for seg in p.relative_to(root).parts[:-1]):
            continue
        out.append(p)
    return sorted(out)


def pick(candidates: list[Path], keyword: str, root: Path) -> Path:
    if not candidates:
        die(f"没有匹配「{keyword}」的笔记")
    if len(candidates) == 1:
        return candidates[0]
    print(f"「{keyword}」匹配到 {len(candidates)} 篇：")
    for i, p in enumerate(candidates, 1):
        print(f"  {i}. {p.relative_to(root)}")
    choice = input(f"选哪一篇？[1-{len(candidates)}] ").strip() or "1"
    try:
        return candidates[int(choice) - 1]
    except (ValueError, IndexError):
        die("没选对")


def published() -> list[dict]:
    """src/content/{notes,essays}/ 里的生成物：就是站上现在有的东西。"""
    out = []
    for kind, sub in (("note", "notes"), ("essay", "essays")):
        for f in sorted((ROOT / "src" / "content" / sub).glob("*.md")):
            text = f.read_text(encoding="utf-8")
            fm, body = frontmatter_split(text)
            words = len(re.findall(r"[\u4e00-\u9fa5]", body)) + len(re.findall(r"[A-Za-z0-9_]+", body))
            out.append(
                {
                    "slug": f.stem,
                    "kind": kind,
                    "title": frontmatter_get(fm, "title") or f.stem,
                    "date": frontmatter_get(fm, "date") or "",
                    "source": frontmatter_get(fm, "source") or "",
                    "words": words,
                }
            )
    return sorted(out, key=lambda e: e["date"], reverse=True)


def entry_path(item: dict) -> str:
    """站上的路径：随笔走 /essays/，笔记走 /notes/。"""
    return f"/{'essays' if item.get('kind') == 'essay' else 'notes'}/{item['slug']}/"


# ─────────────────────────── 命令 ───────────────────────────


def cmd_new(args):
    cfg = load_config()
    title = args.title.strip()
    if not title:
        die("标题不能空着")
    cfg["blog"].mkdir(parents=True, exist_ok=True)

    safe = re.sub(r'[\\/:*?"<>|]', "-", title).strip() or "未命名"
    target = cfg["blog"] / f"{safe}.md"
    if target.exists() and not args.force:
        die(f"已经有了：{target}（想覆盖加 --force）")

    tags = f"[{', '.join(t.strip() for t in args.tags.split(','))}]" if args.tags else "[]"
    body = (
        "---\n"
        f"date: {date.today().isoformat()}\n"
        f"tags: {tags}\n"
        "kind: essay\n"
        "---\n\n"
        f"# {title}\n\n"
        "%%\n"
        "这个库里写的一切都会公开。\n"
        "- tags 会变成站上的标签，date 决定排序\n"
        "- kind 决定站上算「随笔」还是「笔记」：essay / note\n"
        "- 想临时扣下这篇：frontmatter 加 publish: false\n"
        "- 这一段同步时会被整段删掉\n"
        "%%\n\n"
    )
    target.write_text(body, encoding="utf-8")
    ok(f"建好了：{target}")

    if not args.no_edit:
        editor = os.environ.get("EDITOR") or shutil.which("nvim") or shutil.which("vim") or shutil.which("nano")
        if editor and sys.stdout.isatty():
            subprocess.run([editor, str(target)])
        else:
            print("  （没找到 $EDITOR，自己打开吧）")

    print(f"  写完跑 `blog dev` 就能边写边看；`blog ship` 直接发。")


def pending_changes() -> list[str]:
    """还没提交的东西 —— 也就是站上还看不到的那些。"""
    # ls-files 直接给路径，不用解析 porcelain 的前两列（首行前导空格会被 strip 掉）
    names = run(
        ["git", "ls-files", "-m", "-o", "--exclude-standard"], capture=True, check=False
    ).splitlines()
    staged = run(["git", "diff", "--cached", "--name-only"], capture=True, check=False).splitlines()
    seen, out = set(), []
    for n in names + staged:
        n = n.strip()
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def cmd_dev(args):
    need("node", "先装 Node.js")

    # 这个命令只动本地：写清楚了，免得以为存了盘就等于发上线了
    print("本地预览 —— 只在这里能看到，线上还是旧版。")
    if not args.no_sync:
        print("  笔记存盘就会同步过来，但不上线；写完跑 `blog ship` 才算发布。")
    print()

    cmd = ["node", str(DEV)] + (["--no-sync"] if args.no_sync else [])
    child = subprocess.Popen(cmd, cwd=ROOT)
    interrupted = False

    # 自己接住 Ctrl-C：先让 astro 退干净，再打总结，别留孤儿进程
    def on_signal(signum, frame):
        nonlocal interrupted
        interrupted = True
        raise KeyboardInterrupt

    old_int = signal.signal(signal.SIGINT, on_signal)
    old_term = signal.signal(signal.SIGTERM, on_signal)
    try:
        child.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
        signal.signal(signal.SIGINT, old_int)
        signal.signal(signal.SIGTERM, old_term)

        print()
        dirty = pending_changes()
        if dirty:
            print(f"工作区还有 {len(dirty)} 处没提交，站上不会有这些内容：")
            for d in dirty[:6]:
                print(f"  · {d}")
            if len(dirty) > 6:
                print(f"  · …另有 {len(dirty) - 6} 个")
            print("要发上去：blog ship")
        else:
            print("工作区是干净的 —— 线上的就是最新的一版。")

    if interrupted:
        raise SystemExit(130)


def cmd_sync(args):
    need("node", "先装 Node.js")
    cmd = ["node", str(SYNC)]
    if args.watch:
        cmd.append("--watch")
    if args.dry:
        cmd.append("--dry")
    run(cmd)


def cmd_list(args):
    items = published()
    if not items:
        print("站上还没有内容。`blog new 标题` 开始，或 `blog draft 关键词` 从旧笔记里挑。")
        return
    total = sum(i["words"] for i in items)
    print(f"{len(items)} 篇，约 {total:,} 字\n")
    for i in items:
        src = "写作库" if i["source"].startswith(("blog/", "Blog_dosc")) else "Learning"
        label = "随笔" if i["kind"] == "essay" else "笔记"
        print(f"  {i['date']}  {i['title']}")
        print(f"             [{label}] {entry_path(i)}  ·  {src}  ·  {i['words']} 字")
    if args.verbose:
        print("\n源文件：")
        for i in items:
            print(f"  {i['source']}")


def _toggle_publish(args, publish: bool):
    cfg = load_config()
    keyword = args.keyword.strip()
    files = md_files(cfg["notes"])
    hits = [f for f in files if keyword.lower() in f.stem.lower()]
    if not hits:
        die(f"Learning 里没有文件名含「{keyword}」的笔记")
    # 完全同名优先
    exact = [f for f in hits if f.stem == keyword]
    target = exact[0] if exact else pick(hits, keyword, cfg["vault"])

    fm, _ = frontmatter_split(target.read_text(encoding="utf-8"))
    frontmatter_set(target, "publish", "true" if publish else "false")
    ok(f"{'公开' if publish else '撤回'}：{target.relative_to(cfg['vault'])}")

    if not args.no_sync:
        run(["node", str(SYNC)])
        print(f"  `blog ship` 推上去就生效。")


def cmd_draft(args):
    _toggle_publish(args, True)


def cmd_hide(args):
    _toggle_publish(args, False)


def cmd_check(args):
    need("node", "先装 Node.js")
    run(["node", "scripts/check-leaks.mjs"])


def cmd_build(args):
    need("pnpm", "先装 pnpm")
    run(["pnpm", "run", "build"])


def cmd_ship(args):
    need("git", "先装 git")
    need("pnpm", "先装 pnpm")

    print("→ 构建（含泄露扫描）")
    run(["pnpm", "run", "build"])

    status = run(["git", "status", "--porcelain"], capture=True)
    if not status:
        print("→ 没有改动，跳过提交")
    else:
        msg = args.message or f"post: {date.today().isoformat()}"
        run(["git", "add", "-A"])
        run(["git", "commit", "-m", msg])
        ok(f"已提交：{msg}")

    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], capture=True)
    print(f"→ 推送 {branch}")
    run(["git", "push", "origin", branch])
    ok(f"推好了，线上：{SITE}/")

    if args.no_watch:
        return
    if shutil.which("gh") is None:
        print("  （没装 gh，看不到部署状态；过一两分钟去 Actions 页面看）")
        return
    print("→ 等部署（Ctrl-C 可以走开，不影响）")
    sha = run(["git", "rev-parse", "HEAD"], capture=True)[:7]
    try:
        for i in range(40):
            out = run(
                ["gh", "api", f"repos/{repo_slug()}/actions/runs?per_page=1",
                 "--jq", '.workflow_runs[0] | "\\(.head_sha[0:7]) \\(.status) \\(.conclusion // "-")"'],
                capture=True,
                check=False,
            )
            # 刚推上去时接口里还是上一次的 run，认错了会报假喜
            if not out.startswith(sha):
                print(f"  {out}  （还是上一次的，等新的）")
                if not args.wait:
                    print(f"  稍后自己看：gh run list --limit 1")
                    return
                subprocess.run(["sleep", "20"])
                continue
            print(f"  {out}")
            if "completed" in out:
                if "success" in out:
                    ok("已上线")
                else:
                    print("  ✗ 部署失败了：gh run view --log-failed", file=sys.stderr)
                return
            if i >= 15:
                # GitHub 偶尔会把这个 job 挂在那儿十几分钟不动，站点其实早更新了
                print("  GitHub 那边像是卡住了，别干等：")
                print("    看状态  gh run list --limit 1")
                print(f"    看站点  {SITE}/")
                return
            if not args.wait:
                return
            subprocess.run(["sleep", "20"])
    except KeyboardInterrupt:
        print("\n  （不等了，推送已经完成）")


def cmd_open(args):
    items = published()
    if not items:
        die("站上还没有内容")
    if not args.keyword:
        target = items[0]
    else:
        hits = [i for i in items if args.keyword.lower() in i["title"].lower() or args.keyword.lower() in i["slug"].lower()]
        target = pick_text(hits, args.keyword)
    path = entry_path(target)
    url = f"{SITE}{urllib.parse.quote(path)}"
    base = load_config()["base"]
    local = f"http://localhost:4321{base}{urllib.parse.quote(path)}"
    print(f"线上：{url}\n本地：{local}")
    webbrowser.open(url if not args.local else local)


def pick_text(hits: list[dict], keyword: str) -> dict:
    if not hits:
        die(f"站上没有匹配「{keyword}」的文章")
    if len(hits) == 1:
        return hits[0]
    print(f"「{keyword}」匹配到 {len(hits)} 篇：")
    for i, h in enumerate(hits, 1):
        print(f"  {i}. {h['title']}  ({h['date']})")
    choice = input(f"打开哪一篇？[1-{len(hits)}] ").strip() or "1"
    try:
        return hits[int(choice) - 1]
    except (ValueError, IndexError):
        die("没选对")


def repo_slug() -> str:
    try:
        url = run(["git", "remote", "get-url", "origin"], capture=True)
    except SystemExit:
        return "heathacosta259519-dot/blog"
    m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", url)
    return f"{m.group(1)}/{m.group(2)}" if m else "heathacosta259519-dot/blog"


def cmd_status(args):
    cfg = load_config()
    items = published()
    print(f"站点   {SITE}/")
    print(f"库     {cfg['vault']}")
    print(f"写作库 {cfg['blog']}")
    print(f"旧笔记 {cfg['notes']}")
    print(f"线上   {len(items)} 篇" + (f"，最近 {items[0]['date']} {items[0]['title']}" if items else ""))
    draft_count = len(md_files(cfg["blog"]))
    print(f"写作库 {draft_count} 个文件")
    status = run(["git", "status", "--porcelain"], capture=True, check=False)
    dirty = len([l for l in status.splitlines() if l.strip()])
    print(f"工作区 {'有 ' + str(dirty) + ' 处未提交' if dirty else '干净'}")
    print(f"地址   {cfg['base'] or '/'}")


# ─────────────────────────── 入口 ───────────────────────────


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="blog",
        description="这个博客的快捷入口。不带子命令时打印现状。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""例子：
  blog new 用 bare 仓库管 dotfiles --tags Git,工具
  blog dev
  blog draft goroutine
  blog ship -m "post: 通道与 select"
  blog open 权限
""",
    )
    sub = p.add_subparsers(dest="cmd")

    n = sub.add_parser("new", help="在写作库新建一篇")
    n.add_argument("title", help="标题，也当文件名")
    n.add_argument("--tags", default="", help="逗号分隔，例如 Linux,速查")
    n.add_argument("--no-edit", action="store_true", help="建完不打开编辑器")
    n.add_argument("--force", action="store_true", help="同名文件直接覆盖")
    n.set_defaults(func=cmd_new)

    d = sub.add_parser("dev", help="同步 + 预览")
    d.add_argument("--no-sync", action="store_true", help="只起预览，不碰笔记库")
    d.set_defaults(func=cmd_dev)

    s = sub.add_parser("sync", help="同步一次")
    s.add_argument("--dry", action="store_true", help="只看会动哪些文件")
    s.add_argument("--watch", action="store_true", help="常驻监视")
    s.set_defaults(func=cmd_sync)

    l = sub.add_parser("list", help="站上现在有什么", aliases=["ls"])
    l.add_argument("-v", "--verbose", action="store_true", help="带上源文件路径")
    l.set_defaults(func=cmd_list)

    dr = sub.add_parser("draft", help="把 Learning 里的笔记加进公开列表")
    dr.add_argument("keyword", help="文件名里的关键词")
    dr.add_argument("--no-sync", action="store_true", help="改完不立刻同步")
    dr.set_defaults(func=cmd_draft)

    h = sub.add_parser("hide", help="把某篇撤下来")
    h.add_argument("keyword", help="文件名里的关键词")
    h.add_argument("--no-sync", action="store_true", help="改完不立刻同步")
    h.set_defaults(func=cmd_hide)

    c = sub.add_parser("check", help="只跑泄露扫描")
    c.set_defaults(func=cmd_check)

    b = sub.add_parser("build", help="构建一次")
    b.set_defaults(func=cmd_build)

    sh = sub.add_parser("ship", help="构建 → 提交 → 推送 → 等部署")
    sh.add_argument("-m", "--message", help="提交信息，默认 post: 日期")
    sh.add_argument("--no-watch", action="store_true", help="推完就不管部署状态")
    sh.add_argument("--wait", action="store_true", help="一直等到部署结束")
    sh.set_defaults(func=cmd_ship)

    o = sub.add_parser("open", help="打开线上某一页")
    o.add_argument("keyword", nargs="?", default="", help="标题或 slug 里的关键词")
    o.add_argument("--local", action="store_true", help="打开 localhost 那一份")
    o.set_defaults(func=cmd_open)

    st = sub.add_parser("status", help="现状一览")
    st.set_defaults(func=cmd_status)

    return p


def main(argv: list[str] | None = None) -> int:
    # 自己打印的内容和子进程的输出要按顺序出现，不然重定向到文件时全乱套
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        cmd_status(args)
        return 0
    if not (ROOT / "astro.config.mjs").exists():
        die(f"{ROOT} 不像是博客项目目录")
    args.func(args)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print()
        raise SystemExit(130)
    except BrokenPipeError:
        # `blog list | head` 之类；安静退出，别吐一堆 traceback
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        raise SystemExit(0)
