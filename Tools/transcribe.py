#!/usr/bin/env python3
"""
VideoTranscribe — 视频/音频转文字工具
支持：本地文件、YouTube、B站、任何 yt-dlp 支持的平台
引擎：gemini（API）/ mlx（本地离线）/ bcut（免密钥在线）/ custom（自定义 OpenAI 接口）
"""

import argparse
import os
import sys
import subprocess
import tempfile
import pathlib
from datetime import datetime
import shutil
import requests

# 确保能导入同目录下的脚本
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 强制 stdout / stderr 采用 UTF-8 编码，防止在 Windows GBK 环境下打印 Emoji 抛出 UnicodeEncodeError 错误
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# ─── 自动检测并安装缺失的基础依赖项 ───────────────────────
required_packages = {
    "requests": "requests",
    "pydantic": "pydantic",
    "yt_dlp": "yt-dlp[default]"
}

for module_name, pip_name in required_packages.items():
    try:
        __import__(module_name)
    except ImportError:
        print(f"📦 正在自动为您检测并安装缺失的 Python 依赖包: {pip_name}...", flush=True)
        try:
            # 升级 pip 以防止旧版本 pip 安装报错
            subprocess.run([sys.executable, "-m", "pip", "install", "-U", "-q", "pip"], check=False)
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", pip_name], check=True)
            print(f"✅ {pip_name} 自动安装成功！", flush=True)
        except Exception as e:
            print(f"❌ 自动安装 {pip_name} 失败: {e}，请确保您的网络通畅或尝试手动在命令行运行 `pip install {pip_name}` 进行安装。", flush=True)

# ─── 工具函数 ─────────────────────────────────────────────

def ensure_js_runtime():
    """检测并确保 JS 运行时（如 Node.js）被正确添加到环境变量 PATH 中"""
    import shutil
    import os
    if shutil.which("node") or shutil.which("deno") or shutil.which("bun"):
        return
        
    common_paths = [
        r"C:\Program Files\nodejs",
        r"C:\Program Files (x86)\nodejs",
    ]
    appdata = os.environ.get("APPDATA")
    if appdata:
        common_paths.append(os.path.join(appdata, "npm"))
    
    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        common_paths.append(os.path.join(localappdata, "Programs", "node"))
        common_paths.append(os.path.join(localappdata, "deno", "bin"))

    path_entries = os.environ.get("PATH", "").split(os.pathsep)
    added = False
    for path in common_paths:
        if os.path.exists(path) and path not in path_entries:
            path_entries.append(path)
            added = True
            
    if added:
        os.environ["PATH"] = os.pathsep.join(path_entries)
        print(f"🔧 自动将 Node.js/JS 运行时路径添加到环境变量 PATH: {os.environ['PATH']}", flush=True)

def get_js_runtime_arg():
    """找到本机的 JS 运行时，生成 --js-runtimes 参数，显式传递给 yt-dlp 以避开自动检测失效的问题"""
    import shutil
    import os
    
    # 1. 尝试从 PATH 环境变量直接查找
    for runtime in ["node", "deno", "bun"]:
        path = shutil.which(runtime)
        if path:
            return ["--js-runtimes", f"{runtime}:{path}"]
            
    # 2. 尝试 Windows 常见默认安装路径
    common_checks = [
        ("node", r"C:\Program Files\nodejs\node.exe"),
        ("node", r"C:\Program Files (x86)\nodejs\node.exe"),
    ]
    
    appdata = os.environ.get("APPDATA")
    if appdata:
        common_checks.append(("node", os.path.join(appdata, "npm", "node.exe")))
        
    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        common_checks.append(("node", os.path.join(localappdata, "Programs", "node", "node.exe")))
        common_checks.append(("deno", os.path.join(localappdata, "deno", "bin", "deno.exe")))
        
    for runtime, path in common_checks:
        if os.path.exists(path):
            return ["--js-runtimes", f"{runtime}:{path}"]
            
    return []

def should_retry(e):
    err_str = str(e).lower()
    err_type = type(e).__name__.lower()
    
    # 针对 HTTPX、HTTPCore、Socket 连接/超时等网络错误进行重试
    if any(keyword in err_str or keyword in err_type for keyword in ["disconnect", "timeout", "connection", "remote", "network", "httpx", "httpcore"]):
        return True
        
    # 针对 API 限流或服务端暂时不可用 (5xx, 429) 进行重试
    if any(keyword in err_str for keyword in ["503", "429", "500", "502", "504", "unavailable", "exhausted", "limit"]):
        return True
        
    # 对于客户端错误（400, 403, 401，非法密钥等）直接报错，不重试
    if any(keyword in err_str for keyword in ["400", "403", "401", "bad request", "unauthorized", "invalid", "not found"]):
        return False
        
    return True

def call_with_retry(func, *args, max_retries=3, backoff_factor=2, **kwargs):
    import time
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            last_err = e
            if should_retry(e) and attempt < max_retries:
                sleep_time = backoff_factor ** attempt
                print(f"⚠️ API 调用失败 (尝试 {attempt}/{max_retries}): {e}", flush=True)
                print(f"⏳ 将在 {sleep_time} 秒后重试...", flush=True)
                time.sleep(sleep_time)
            else:
                break
    raise last_err

def translate_and_clean_title(title, proxy=None):
    """使用 Gemini 将网页/视频标题翻译为中文，并过滤掉 Windows 文件名不支持的特殊字符"""
    import re
    # 过滤 Windows 文件名不支持的特殊字符: \ / : * ? " < > |
    def sanitize(name):
        cleaned = re.sub(r'[\\/:*?"<>|]', '', name)
        # 替换多个空格为一个空格
        cleaned = re.sub(r'\s+', ' ', cleaned)
        return cleaned.strip()[:100]

    api_key = get_api_key()
    if not api_key:
        return sanitize(title)

    try:
        import google.genai as genai
        client = genai.Client(api_key=api_key)
        prompt = (
            "你是一个极其专业的翻译与文本清理助手。请将以下视频/网页标题翻译成中文（如果是英文或其它语言），并去除任何不能作为 Windows 文件名使用的特殊字符（如 \\ / : * ? \" < > | 等）。\n"
            "如果你觉得标题中包含类似于“视频播放”、“YouTube”等网站后缀，也可以顺便清理掉。\n"
            "只输出清理和翻译后的中文标题，不要有任何其它解释或多余字符。\n\n"
            f"标题：{title}"
        )
        response = call_with_retry(
            client.models.generate_content,
            model="gemini-2.5-flash",
            contents=[prompt]
        )
        translated = response.text.strip()
        if translated:
            return sanitize(translated)
    except Exception as e:
        print(f"⚠️ 使用 Gemini 翻译标题失败: {e}，将直接清理原始标题后使用。", flush=True)
        
    return sanitize(title)

def get_page_title_fallback(url, proxy=None):
    """尝试以最快、最健全的方式获取网页标题，失败则使用 yt-dlp 命令作为备选"""
    title = get_page_title(url, proxy)
    if title:
        return title
    # Fallback to yt-dlp --get-title
    try:
        cmd = [sys.executable, "-m", "yt_dlp", "--get-title", "--no-playlist"]
        if proxy:
            cmd.extend(["--proxy", proxy])
        js_runtime_arg = get_js_runtime_arg()
        if js_runtime_arg:
            cmd.extend(js_runtime_arg)
        cmd.append(url)
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=15)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass
    return None

def run_local_cli_optimizer(text, command_template):
    """通过本地命令行工具（如 Claude Code, Codex, Gemini CLI）整理优化为 Markdown"""
    if not command_template:
        print("⚠️ 未配置本地 CLI 命令行模板，无法进行 Markdown 篇章整理优化，直接保存原始文本。", flush=True)
        return text
        
    import tempfile
    import subprocess
    import os
    
    print("☁️ 正在调用本地 CLI 命令行进行 Markdown 整理优化...", flush=True)
    tmp_path = None
    try:
        # 写入临时文件，确保使用 utf-8 编码
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as tmp:
            tmp.write(text)
            tmp_path = tmp.name
        
        # 替换命令行中的 {input_file} 占位符
        cmd = command_template.strip()
        if "{input_file}" in cmd:
            cmd = cmd.replace("{input_file}", f'"{tmp_path}"')
        else:
            # 默认将文件路径追加在命令最后
            cmd = f'{cmd} "{tmp_path}"'
            
        print(f"💻 执行本地命令: {cmd}", flush=True)
        
        # 执行命令并捕获标准输出的原始字节
        # shell=True 可以支持 Windows 管道/重定向等语法
        res = subprocess.run(cmd, shell=True, capture_output=True)
        
        # 清理临时文件
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
                
        if res.returncode == 0:
            # 尝试多种编码解密标准输出，完美兼容 Windows GBK/ANSI 及 UTF-8/UTF-16
            optimized_text = None
            for codec in ['utf-8', 'gb18030', 'gbk', 'utf-16', 'utf-8-sig']:
                try:
                    optimized_text = res.stdout.decode(codec).strip()
                    break
                except UnicodeDecodeError:
                    pass
            
            if not optimized_text:
                # 终极兜底解码，确保即便编码混合或损坏也能解析输出
                optimized_text = res.stdout.decode('utf-8', errors='replace').strip()
                
            if optimized_text:
                return optimized_text
            else:
                print("⚠️ 本地 CLI 运行成功，但未捕获到任何输出，将回退保存原始文本。", flush=True)
                return text
        else:
            # 同样尝试解密 stderr
            error_msg = None
            for codec in ['utf-8', 'gb18030', 'gbk', 'utf-16']:
                try:
                    error_msg = res.stderr.decode(codec).strip()
                    break
                except UnicodeDecodeError:
                    pass
            if not error_msg:
                error_msg = res.stderr.decode('utf-8', errors='replace').strip()
            if not error_msg:
                error_msg = f"退出码: {res.returncode}"
            print(f"⚠️ 本地 CLI 运行失败: {error_msg}，将回退保存原始文本。", flush=True)
            return text
    except Exception as e:
        # 兜底清理
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        print(f"⚠️ 调用本地 CLI 异常: {e}，将回退保存原始文本。", flush=True)
        return text

def optimize_to_markdown(text, provider="gemini", api_url=None, api_key=None, model_name=None):
    """使用大模型（Gemini、自定义 OpenAI 兼容模型或本地 CLI）将转录文本整理优化为一篇高格式、有层级的 Markdown 篇章文章，保留90%以上的核心细节"""
    if provider == "cli":
        return run_local_cli_optimizer(text, api_url)

    prompt = (
        "你是一个极其专业的文章整理、编辑与排版专家。以下是一段视频/音频的原始语音转录文本。\n"
        "请仔细阅读，并在【保留90%以上核心细节内容、观点、具体数据和关键论据】的前提下，将其整理、优化成一篇高质量、结构层次分明、排版美观的 Markdown 格式文章。\n\n"
        "具体排版与内容要求如下：\n"
        "1. 建立清晰的层级结构：必须使用 Markdown 标题（# 作为大标题，## 作为核心章节，### 作为子要点）对整篇内容进行逻辑分层，段落之间应有自然的过渡。\n"
        "2. 重点突出：使用粗体（**双星号**）高亮标记关键概念、专有名词、核心观点或重要数据。\n"
        "3. 列表与引用：适当使用无序列表（- 列表项）、有序列表或引用块（> 引用）来呈现要点、步骤或核心金句，提升可读性。\n"
        "4. 核心细节保留：务必保留原文 90% 以上的实质性内容，切忌将长篇幅缩写为简短摘要，必须保留全部关键论据、背景事实、具体例子和数字。\n"
        "5. 语言书面化：去除口头禅（如“然后”、“那么”、“呃”等）、重复累赘的词句，理顺句子语法，使文章流畅、通顺，呈现出专业撰稿人的水平。\n"
        "6. 输出格式：只输出整理好的 Markdown 正文内容。严禁在开头或结尾输出 ```markdown 或 ``` 代码块包裹符，严禁输出任何“好的，以下是为您整理的文章”等废话前言或后记。\n\n"
        f"原始转录文本：\n{text}"
    )

    if provider == "gemini":
        api_key = api_key or get_api_key()
        if not api_key:
            print("⚠️ 找不到 GEMINI_API_KEY，无法进行 Markdown 篇章整理优化，直接保存原始文本。", flush=True)
            return text

        try:
            import google.genai as genai
        except ImportError:
            print("📦 正在自动为您安装所需的 google-genai 依赖库...", flush=True)
            try:
                import subprocess
                subprocess.run([sys.executable, "-m", "pip", "install", "-q", "google-genai"], check=True)
                import google.genai as genai
            except Exception as e:
                print(f"❌ 安装 google-genai 失败: {e}，将回退保存原始文本。", flush=True)
                return text

        print("☁️ 正在使用 Gemini 2.5 Flash 整理优化为高格式、有层次的 Markdown 文章（保留 90% 以上的核心细节）...", flush=True)
        try:
            client = genai.Client(api_key=api_key)
            response = call_with_retry(
                client.models.generate_content,
                model="gemini-2.5-flash",
                contents=[prompt]
            )
            optimized_text = response.text.strip()
        except Exception as e:
            print(f"⚠️ 使用 Gemini 整理优化 Markdown 失败: {e}，将回退保存原始文本。", flush=True)
            return text
    else:
        # 自定义 OpenAI 兼容大模型
        if not api_url or not api_key:
            print("⚠️ 自定义大模型未配置 Endpoint 或 API Key，无法进行 Markdown 篇章整理优化，直接保存原始文本。", flush=True)
            return text
        
        # 自动补全 /chat/completions 如果没写的话
        full_url = api_url.strip()
        if not full_url.endswith("/chat/completions"):
            if full_url.endswith("/"):
                full_url += "chat/completions"
            else:
                full_url += "/chat/completions"

        target_model = model_name.strip() if model_name else "gpt-4o-mini"
        print(f"☁️ 正在使用自定义大模型 ({target_model}) 整理优化为高格式、有层次的 Markdown 文章（保留 90% 以上的核心细节）...", flush=True)
        try:
            import requests
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            payload = {
                "model": target_model,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.3
            }
            response = requests.post(full_url, headers=headers, json=payload, timeout=180)
            response.raise_for_status()
            res_json = response.json()
            optimized_text = res_json["choices"][0]["message"]["content"].strip()
        except Exception as e:
            print(f"⚠️ 使用自定义大模型整理优化 Markdown 失败: {e}，将回退保存原始文本。", flush=True)
            return text

    # 去除 markdown 代码块符号
    if optimized_text.startswith("```markdown"):
        optimized_text = optimized_text[11:].strip()
    elif optimized_text.startswith("```"):
        optimized_text = optimized_text[3:].strip()
    if optimized_text.endswith("```"):
        optimized_text = optimized_text[:-3].strip()
    return optimized_text

def is_url(text):
    return text.startswith(("http://", "https://", "www."))

def timestamp_filename(prefix="transcript", ext="txt"):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{ts}.{ext}"

def test_connectivity(url, proxy=None):
    """
    测试目标 URL 的连通性。
    1. 优先尝试直连。
    2. 如果直连失败且配置了代理，尝试代理连接。
    3. 如果都失败，抛出异常报告失败原因。
    """
    import urllib.parse
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc or parsed.path.split('/')[0]
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    print(f"🔍 正在预检网络连通性: {host} ...", flush=True)
    
    direct_ok = False
    direct_error = ""
    try:
        r = requests.get(url, headers=headers, timeout=5)
        if r.status_code < 500:
            direct_ok = True
            print("✅ 网络直连测试成功！", flush=True)
    except Exception as e:
        direct_error = str(e)
        
    if direct_ok:
        return True
        
    if proxy:
        print(f"⚠️  网络直连失败 ({direct_error})，正在尝试通过代理预检...", flush=True)
        proxies = {"http": proxy, "https": proxy}
        try:
            r = requests.get(url, headers=headers, proxies=proxies, timeout=5)
            if r.status_code < 500:
                print("✅ 代理连通测试成功！将通过代理继续转写任务。", flush=True)
                return True
        except Exception as e:
            raise RuntimeError(
                f"网络连通性预检失败！\n"
                f"直连测试失败，原因: {direct_error}\n"
                f"代理测试也失败，代理链接: {proxy}，原因: {e}\n"
                f"请检查您的网络连接或代理配置是否正确。"
            )
    else:
        raise RuntimeError(
            f"网络连通性预检失败！\n"
            f"直连测试失败，原因: {direct_error}\n"
            f"您未配置网络代理。若访问境外网站，请在软件右上角 [设置] 中配置正确的代理链接。"
        )

def get_page_title(url, proxy=None):
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
        }
        proxies = {"http": proxy, "https": proxy} if proxy else None
        r = requests.get(url, headers=headers, proxies=proxies, timeout=5)
        r.raise_for_status()
        import re
        match = re.search(r"<title>(.*?)</title>", r.text, re.IGNORECASE | re.DOTALL)
        if match:
            title = match.group(1).strip()
            title = re.sub(r"\s*-\s*YouTube$", "", title)
            title = re.sub(r"_哔哩哔哩_bilibili$", "", title)
            return title
    except Exception:
        pass
    return None

def get_api_key():
    """从 api-registry 读取 GEMINI_API_KEY"""
    env_file = os.path.expanduser("~/.shared-skills/api-registry/.env")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("GEMINI_API_KEY", "")

# ─── 字幕抓取（URL 优先路径）────────────────────────────────

def try_fetch_bilibili_subtitles(url, proxy=None):
    print("🔍 尝试获取 B站 网页CC字幕...", flush=True)
    bvid = extract_bvid(url)
    if not bvid:
        return None
        
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com/"
    }
    proxies = {"http": proxy, "https": proxy} if proxy else {"http": None, "https": None}
    
    cookies_dict = {}
    script_dir = os.path.dirname(os.path.abspath(__file__))
    cookies_path = os.path.join(os.path.dirname(script_dir), "bili_cookies.json")
    if os.path.exists(cookies_path):
        try:
            import json
            with open(cookies_path, "r", encoding="utf-8") as f:
                cookies_dict = json.load(f)
        except Exception:
            pass
            
    try:
        # Step 1: 获取 cid 与字幕元数据
        view_url = f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
        r = requests.get(view_url, headers=headers, cookies=cookies_dict, proxies=proxies, timeout=10)
        r.raise_for_status()
        data = r.json()
        if data.get("code") != 0:
            return None
            
        subtitle_data = data.get("data", {}).get("subtitle", {})
        sub_list = subtitle_data.get("list", [])
        if not sub_list:
            print("⚠️  该 B站 视频没有提供任何网页CC字幕轴", flush=True)
            return None
            
        # 优先选择第一个字幕（通常是中文）
        sub_track = sub_list[0]
        sub_url = sub_track.get("subtitle_url")
        if not sub_url:
            return None
            
        if sub_url.startswith("//"):
            sub_url = "https:" + sub_url
            
        print(f"⬇️ 正在下载 B站 字幕文件: {sub_track.get('lan_doc', '默认语言')}...", flush=True)
        sub_r = requests.get(sub_url, headers=headers, proxies=proxies, timeout=10)
        sub_r.raise_for_status()
        sub_json = sub_r.json()
        
        entries = []
        for item in sub_json.get("body", []):
            start_ms = int(float(item.get("from", 0)) * 1000)
            end_ms = int(float(item.get("to", 0)) * 1000)
            text = item.get("content", "").strip()
            if text:
                entries.append({"start_ms": start_ms, "end_ms": end_ms, "text": text})
                
        if entries:
            print(f"✅ B站 网页CC字幕拉取与解析成功（共 {len(entries)} 条时间轴分段）", flush=True)
            return ParsedSubtitle(entries)
            
    except Exception as e:
        print(f"⚠️ 获取 B站 字幕失败: {e}", flush=True)
        
    return None

def try_fetch_subtitles(url, tmpdir, cookies_from_browser=None, proxy=None):
    """
    用 yt-dlp 尝试抓取现成字幕（.vtt / .srt / .json3）
    成功返回字幕文本，失败返回 None
    """
    if "bilibili.com" in url or "b23.tv" in url:
        return try_fetch_bilibili_subtitles(url, proxy=proxy)

    print("🔍 尝试抓取现成字幕...", flush=True)
    sub_path = os.path.join(tmpdir, "subtitle")

    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--write-auto-sub",
        "--write-sub",
        "--sub-lang", "zh-Hans,zh,zh-Hant,en",
        "--sub-format", "vtt/srt/best",
        "--skip-download",
        "--no-playlist",
        "--remote-components", "ejs:github"
    ]
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    yt_cookies_path = os.path.join(os.path.dirname(script_dir), "youtube_cookies.txt")
    if os.path.exists(yt_cookies_path) and os.path.getsize(yt_cookies_path) > 10:
        print("🍪 已检测到通用自定义 Cookies，正在注入字幕抓取进程...", flush=True)
        cmd.extend(["--cookies", yt_cookies_path])
    if cookies_from_browser and cookies_from_browser.lower() != "none":
        print(f"🍪 正在为字幕抓取进程注入浏览器 {cookies_from_browser} 的 Cookies...", flush=True)
        cmd.extend(["--cookies-from-browser", cookies_from_browser])
        
    # 显式传递 JS 运行时参数，以防自动探测失败
    js_runtime_arg = get_js_runtime_arg()
    if js_runtime_arg:
        cmd.extend(js_runtime_arg)
        
    cmd.extend(["-o", sub_path, url])

    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=60)
    
    if result.returncode != 0:
        stderr_str = result.stderr or ""
        stdout_str = result.stdout or ""
        error_content = stderr_str + "\n" + stdout_str
        if "confirm you're not a bot" in error_content or "out of date" in error_content or "Sign in" in error_content or "HTTP Error 403" in error_content:
            print("⚠️  字幕抓取检测到 YouTube 机器人验证，正在自动升级 yt-dlp 并重试...", flush=True)
            try:
                subprocess.run([sys.executable, "-m", "pip", "install", "-U", "-q", "yt-dlp[default]"], check=True)
                result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=60)
            except Exception:
                pass

    # 找下载下来的字幕文件
    for fname in os.listdir(tmpdir):
        fpath = os.path.join(tmpdir, fname)
        if fname.startswith("subtitle") and (fname.endswith(".vtt") or fname.endswith(".srt")):
            entries = parse_subtitle_to_entries(fpath)
            if entries:
                print(f"✅ 字幕抓取与解析成功（共 {len(entries)} 条字幕时间轴）", flush=True)
                return ParsedSubtitle(entries)

    print("⚠️  无现成字幕，改用音频转录...", flush=True)
    return None

def parse_time_to_ms(time_str):
    time_str = time_str.replace(',', '.').strip()
    parts = time_str.split(':')
    if len(parts) == 2:
        minutes = int(parts[0])
        seconds = float(parts[1])
        return int((minutes * 60 + seconds) * 1000)
    elif len(parts) == 3:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
        return int((hours * 3600 + minutes * 60 + seconds) * 1000)
    return 0

def format_ms_to_srt_time(ms):
    hours = ms // 3600000
    minutes = (ms % 3600000) // 60000
    seconds = (ms % 60000) // 1000
    millis = ms % 1000
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"

def format_ms_to_lrc_time(ms):
    minutes = ms // 60000
    seconds = (ms % 60000) / 1000.0
    return f"[{minutes:02d}:{seconds:05.2f}]"

def parse_subtitle_to_entries(fpath):
    entries = []
    with open(fpath, encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
        
    import re
    time_re = re.compile(r'(\d{1,2}:\d{2}[\d\.:,]*)\s*-->\s*(\d{1,2}:\d{2}[\d\.:,]*)')
    
    current_entry = None
    text_lines = []
    
    for line in lines:
        line = line.strip()
        if not line:
            if current_entry and text_lines:
                current_entry['text'] = " ".join(text_lines).strip()
                current_entry['text'] = re.sub(r'<[^>]+>', '', current_entry['text'])
                current_entry['text'] = re.sub(r'\s+', ' ', current_entry['text'])
                if current_entry['text']:
                    entries.append(current_entry)
                current_entry = None
                text_lines = []
            continue
            
        match = time_re.search(line)
        if match:
            if current_entry and text_lines:
                current_entry['text'] = " ".join(text_lines).strip()
                current_entry['text'] = re.sub(r'<[^>]+>', '', current_entry['text'])
                current_entry['text'] = re.sub(r'\s+', ' ', current_entry['text'])
                if current_entry['text']:
                    entries.append(current_entry)
                text_lines = []
            
            start_ms = parse_time_to_ms(match.group(1))
            end_ms = parse_time_to_ms(match.group(2))
            current_entry = {'start_ms': start_ms, 'end_ms': end_ms, 'text': ''}
        else:
            if line.upper() == 'WEBVTT' or line.startswith('Kind:') or line.startswith('Language:'):
                continue
            if line.isdigit() and not current_entry:
                continue
            if current_entry:
                text_lines.append(line)
                
    if current_entry and text_lines:
        current_entry['text'] = " ".join(text_lines).strip()
        current_entry['text'] = re.sub(r'<[^>]+>', '', current_entry['text'])
        current_entry['text'] = re.sub(r'\s+', ' ', current_entry['text'])
        if current_entry['text']:
            entries.append(current_entry)
            
    cleaned_entries = []
    for entry in entries:
        if cleaned_entries and cleaned_entries[-1]['text'] == entry['text']:
            cleaned_entries[-1]['end_ms'] = max(cleaned_entries[-1]['end_ms'], entry['end_ms'])
        else:
            if entry['text']:
                cleaned_entries.append(entry)
                
    return cleaned_entries

class ParsedSubtitle:
    def __init__(self, entries):
        self.entries = entries
        
    def to_srt(self):
        result = []
        for i, entry in enumerate(self.entries, 1):
            start = format_ms_to_srt_time(entry['start_ms'])
            end = format_ms_to_srt_time(entry['end_ms'])
            result.append(f"{i}\n{start} --> {end}\n{entry['text']}\n")
        return "\n".join(result)
        
    def to_lrc(self):
        result = []
        for entry in self.entries:
            time_tag = format_ms_to_lrc_time(entry['start_ms'])
            result.append(f"{time_tag}{entry['text']}")
        return "\n".join(result)
        
    def to_txt(self):
        return " ".join([entry['text'] for entry in self.entries])
        
    def to_json(self):
        import json
        return json.dumps({"segments": self.entries}, ensure_ascii=False, indent=2)

# ─── 音频下载 ────────────────────────────────────────────

def extract_bvid(url):
    import re
    if "b23.tv" in url:
        try:
            # 解决短链接重定向
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=True, timeout=10)
            url = r.url
        except Exception:
            pass
    match = re.search(r'(BV[a-zA-Z0-9]{10})', url)
    if match:
        return match.group(1)
    return None

def download_bilibili_audio_direct(url, tmpdir, proxy=None):
    """
    通过 B 站开放 API 直接提取并下载 DASH 音频流，完美避开 yt-dlp 的 412 风控，且下载速度极快。
    """
    bvid = extract_bvid(url)
    if not bvid:
        raise RuntimeError("未能在链接中识别出合法的 B站 BV 号")
        
    print(f"🌐 识别为 B站 视频 (BV号: {bvid})，启动直连下载引擎...", flush=True)
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com/"
    }
    proxies = {"http": proxy, "https": proxy} if proxy else {"http": None, "https": None}
    
    cookies_dict = {}
    script_dir = os.path.dirname(os.path.abspath(__file__))
    cookies_path = os.path.join(os.path.dirname(script_dir), "bili_cookies.json")
    if os.path.exists(cookies_path):
        try:
            import json
            with open(cookies_path, "r", encoding="utf-8") as f:
                cookies_dict = json.load(f)
            print("🍪 已成功载入 B站 登录凭证，正在以您的账号状态解析下载...", flush=True)
        except Exception as e:
            print(f"⚠️ 读取 B站 登录凭证失败: {e}", flush=True)
            
    # Step 1: 获取 cid
    view_url = f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
    try:
        r = requests.get(view_url, headers=headers, cookies=cookies_dict, proxies=proxies, timeout=15)
        r.raise_for_status()
        data = r.json()
        cid = data['data']['cid']
        title = data['data']['title']
        print(f"📄 视频标题: {title}", flush=True)
    except Exception as e:
        raise RuntimeError(f"获取 B站 视频元数据失败 (可能是网络被拦截或BV号失效): {e}")
        
    # Step 2: 获取音频 CDN 地址
    play_url = f"https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16"
    try:
        r = requests.get(play_url, headers=headers, cookies=cookies_dict, proxies=proxies, timeout=15)
        r.raise_for_status()
        play_data = r.json()
        audio_list = play_data['data']['dash']['audio']
        # 取音质最好的音频流 baseUrl
        audio_url = audio_list[0]['baseUrl']
    except Exception as e:
        raise RuntimeError(f"解析 B站 播放地址失败: {e}")
        
    # Step 3: 下载原始 m4s 音频段
    print("⬇️ 正在拉取 B站 原始音频流...", flush=True)
    audio_temp_path = os.path.join(tmpdir, "temp_bili_audio.m4s")
    
    stream_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.bilibili.com/",
        "Range": "bytes=0-"
    }
    
    try:
        with requests.get(audio_url, headers=stream_headers, cookies=cookies_dict, stream=True, proxies=proxies, timeout=60) as r:
            r.raise_for_status()
            with open(audio_temp_path, 'wb') as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)
    except Exception as e:
        raise RuntimeError(f"下载音频流分段失败: {e}")
        
    # Step 4: 用 FFmpeg 转换为标准 MP3
    print("🎵 正在使用 FFmpeg 转换为标准 MP3 音频...", flush=True)
    audio_path = os.path.join(tmpdir, "audio.mp3")
    
    cmd = ["ffmpeg", "-i", audio_temp_path, "-vn", "-acodec", "libmp3lame", "-y", audio_path]
    
    startupinfo = None
    if sys.platform == 'win32':
        import subprocess
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0 # SW_HIDE
        
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', startupinfo=startupinfo, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg 格式转换失败: {result.stderr[-300:]}")
        
    size_mb = os.path.getsize(audio_path) / 1024 / 1024
    print(f"✅ 音频下载与格式化完成（{size_mb:.1f} MB）", flush=True)
    
    return audio_path

def download_audio(url, tmpdir, cookies_from_browser=None, proxy=None):
    """用 yt-dlp 下载音频为 mp3 (支持 B站 直连与通用 yt-dlp)"""
    if "bilibili.com" in url or "b23.tv" in url:
        return download_bilibili_audio_direct(url, tmpdir, proxy=proxy)

    print("⬇️  下载音频中...", flush=True)
    audio_path = os.path.join(tmpdir, "audio.mp3")
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-x", "--audio-format", "mp3",
        "--audio-quality", "32K",
        "--no-playlist",
        "--remote-components", "ejs:github"
    ]
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    yt_cookies_path = os.path.join(os.path.dirname(script_dir), "youtube_cookies.txt")
    if os.path.exists(yt_cookies_path) and os.path.getsize(yt_cookies_path) > 10:
        print("🍪 已检测到通用自定义 Cookies，正在注入下载进程...", flush=True)
        cmd.extend(["--cookies", yt_cookies_path])
    if cookies_from_browser and cookies_from_browser.lower() != "none":
        print(f"🍪 正在为下载进程注入浏览器 {cookies_from_browser} 的 Cookies...", flush=True)
        cmd.extend(["--cookies-from-browser", cookies_from_browser])
        
    # 显式传递 JS 运行时参数，以防自动探测失败
    js_runtime_arg = get_js_runtime_arg()
    if js_runtime_arg:
        cmd.extend(js_runtime_arg)
        
    cmd.extend(["-o", audio_path, url])
    
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=600)
    
    if result.returncode != 0:
        stderr_str = result.stderr or ""
        stdout_str = result.stdout or ""
        error_content = stderr_str + "\n" + stdout_str
        
        # 尝试自动升级并重试
        if "confirm you're not a bot" in error_content or "out of date" in error_content or "Sign in" in error_content or "HTTP Error 403" in error_content:
            print("⚠️  下载音频检测到 YouTube 机器人验证，正在自动升级 yt-dlp 并重试...", flush=True)
            try:
                subprocess.run([sys.executable, "-m", "pip", "install", "-U", "-q", "yt-dlp[default]"], check=True)
                print("✅ yt-dlp 升级成功，正在重新尝试下载...", flush=True)
                result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=600)
            except Exception as upgrade_err:
                print(f"⚠️  自动升级 yt-dlp 失败: {upgrade_err}", flush=True)

    if result.returncode != 0:
        stderr_str = result.stderr or ""
        stdout_str = result.stdout or ""
        
        guide = ""
        if "youtube" in url.lower() and (cookies_from_browser is None or cookies_from_browser.lower() == "none"):
            guide = (
                "\n\n💡 提示：YouTube 目前对无登录态请求拦截非常严格。\n"
                "请点击软件右上角的 [⚙️ 设置] 按钮，在下方选择您的主浏览器（如 Chrome 或 Edge）以自动注入 Cookies，"
                "这将大大提高绕过 YouTube 机器人拦截的成功率！"
            )
        elif "douyin.com" in url.lower() or "tiktok.com" in url.lower():
            guide = (
                "\n\n💡 提示：抖音/TikTok 目前必须使用浏览器 Cookie 才能进行解析下载。\n"
                "请点击软件右上角的 [⚙️ 设置] 按钮，在下方选择您常用且已访问过抖音的浏览器（如 Chrome, Edge 或 Firefox）以自动注入 Cookies。"
            )
        raise RuntimeError(f"yt-dlp 下载失败：{stderr_str[-500:]}{guide}")

    if not os.path.exists(audio_path):
        raise RuntimeError("音频文件未找到，下载可能失败")
    size_mb = os.path.getsize(audio_path) / 1024 / 1024
    print(f"✅ 音频下载完成（{size_mb:.1f} MB）", flush=True)
    return audio_path

def extract_audio_from_local(input_path, tmpdir):
    """用 ffmpeg 从本地视频提取音频"""
    ext = os.path.splitext(input_path)[1].lower()
    if ext in (".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"):
        return input_path
    print("🎵 提取音频中...", flush=True)
    audio_path = os.path.join(tmpdir, "audio.mp3")
    cmd = ["ffmpeg", "-i", input_path, "-vn", "-ar", "16000", "-ac", "1", "-ab", "32k", "-f", "mp3", audio_path, "-y"]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 提取音频失败：{result.stderr[-300:]}")
    return audio_path

# ─── 转录引擎：Gemini ───────────────────────────────────

def transcribe_gemini(audio_path):
    """用 Gemini 2.5 Flash 转录，结果有标点"""
    try:
        import google.genai as genai
    except ImportError:
        print("📦 安装 google-genai...", flush=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "google-genai"], check=True)
        import google.genai as genai

    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("找不到 GEMINI_API_KEY，请在环境变量中设置或通过设置面板配置。")

    print("☁️  正在上传音频文件到 Gemini...", flush=True)
    client = genai.Client(api_key=api_key)
    audio_file = call_with_retry(client.files.upload, file=pathlib.Path(audio_path))
    print("☁️  Gemini 转录中（有标点）...", flush=True)
    response = call_with_retry(
        client.models.generate_content,
        model="gemini-2.5-flash",
        contents=[
            audio_file,
            "请将这段音频完整逐字转录成文字。如果是中文就输出中文，如果是英文就输出英文。"
            "不要总结，保留原话，包括语气词和口语表达。"
        ]
    )
    return response.text

# ─── 转录引擎：mlx-whisper（本地）────────────────────────

def transcribe_mlx(audio_path):
    """用 mlx-whisper 本地转录，无标点"""
    try:
        import mlx_whisper
    except ImportError:
        raise RuntimeError("mlx-whisper 未安装，请运行：pip3 install mlx-whisper")

    print("🖥️  本地 mlx-whisper 转录中（无标点，首次需下载模型）...", flush=True)
    result = mlx_whisper.transcribe(
        audio_path,
        path_or_hf_repo="mlx-community/whisper-turbo",
        language=None,   # 自动检测语言
        verbose=False
    )
    return result["text"]

# ─── 转录引擎：Bcut ASR（在线免 API 密钥）──────────────────────

def transcribe_bcut(audio_path, proxy=None):
    """用必剪 ASR 云端接口转录，返回 ASRData 结构以支持时间戳输出"""
    from online_asr import BcutASR, ResultStateEnum
    import time

    print("☁️  必剪 ASR 云端转录中（免费在线，首轮对齐）...", flush=True)
    asr = BcutASR(audio_path, proxy=proxy)
    asr.upload()
    task_id = asr.create_task()

    while True:
        task_resp = asr.result()
        state = task_resp.state
        if state == ResultStateEnum.COMPLETE:
            print("✅ 识别成功", flush=True)
            result = task_resp.parse()
            break
        elif state == ResultStateEnum.ERROR:
            raise RuntimeError(f"必剪 ASR 识别失败：{task_resp.remark}")
        elif state == ResultStateEnum.STOP:
            print("⏳ 等待识别开始...", flush=True)
        elif state == ResultStateEnum.RUNING:
            print(f"⏳ 识别中: {task_resp.remark}", flush=True)
        time.sleep(3)

    if not result.has_data():
        raise RuntimeError("未识别到任何语音内容")

    return result

# ─── 转录引擎：自定义 OpenAI 兼容接口 ────────────────────────

def transcribe_custom(audio_path, api_url, api_key, model_name):
    """使用自定义的 OpenAI 兼容语音识别 API"""
    print(f"☁️  自定义 ASR 转录中 (模型: {model_name})...", flush=True)
    if not api_url:
        raise ValueError("未指定自定义 ASR 的 API Endpoint 链接。")
    
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        
    # 读取音频数据
    files = {
        "file": (os.path.basename(audio_path), open(audio_path, "rb"), "audio/mpeg")
    }
    data = {
        "model": model_name
    }
    
    # 发送请求
    response = requests.post(api_url, headers=headers, files=files, data=data, timeout=600)
    response.raise_for_status()
    
    result = response.json()
    if "text" in result:
        print("✅ 识别成功", flush=True)
        return result["text"]
    else:
        raise RuntimeError(f"API 返回数据解析错误，未找到 text 字段。返回结果: {result}")

# ─── 多格式输出保存逻辑 ─────────────────────────────────────

def save_outputs(text_or_result, output_base_path, formats, engine, source_input=None, video_title=None,
                 llm_provider="gemini", llm_api_url=None, llm_api_key=None, llm_model_name=None):
    """根据多选格式分别保存输出文件，并为 TXT 和 MD 格式写入下载信息头部"""
    formats_list = [f.strip().lower() for f in formats.split(",") if f.strip()]
    
    # 提前获取原始文本内容，用于优化 markdown
    raw_text = text_or_result.to_txt() if hasattr(text_or_result, 'to_txt') else str(text_or_result)
    
    for fmt in formats_list:
        # 计算该格式的具体输出文件路径
        base_no_ext, ext = os.path.splitext(output_base_path)
        
        # 如果 output_base_path 后缀刚好是当前格式，直接用；否则替换后缀
        if ext.lower() == f".{fmt}":
            out_path = output_base_path
        else:
            out_path = f"{base_no_ext}.{fmt}"

        with open(out_path, "w", encoding="utf-8") as f:
            if fmt == "md" or fmt == "markdown":
                optimized = optimize_to_markdown(raw_text, llm_provider, llm_api_url, llm_api_key, llm_model_name)
                md_header = ""
                if video_title or source_input:
                    title_display = video_title if video_title else "语音转文字文章"
                    md_header += f"# {title_display}\n\n"
                    if source_input:
                        md_header += f"- **来源链接**: {source_input}\n"
                    md_header += f"- **转录引擎**: {engine}\n"
                    md_header += f"- **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
                    md_header += "---\n\n"
                f.write(md_header + optimized)
            elif hasattr(text_or_result, 'to_srt'):
                # 含有时间戳的结构体 (Bcut ASRData 或 ParsedSubtitle 下载字幕)
                if fmt == "srt":
                    f.write(text_or_result.to_srt())
                elif fmt == "lrc":
                    f.write(text_or_result.to_lrc())
                elif fmt == "json":
                    if hasattr(text_or_result, 'model_dump_json'):
                        f.write(text_or_result.model_dump_json(indent=2))
                    else:
                        f.write(text_or_result.to_json())
                else:
                    # 对于 txt 写入头部信息
                    txt_header = ""
                    if fmt == "txt" and (video_title or source_input):
                        txt_header += "=========================================\n"
                        if video_title:
                            txt_header += f"标题: {video_title}\n"
                        if source_input:
                            txt_header += f"链接: {source_input}\n"
                        txt_header += f"引擎: {engine}\n"
                        txt_header += f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                        txt_header += "=========================================\n\n"
                    f.write(txt_header + text_or_result.to_txt())
            else:
                # 纯文本 string (Gemini/mlx/custom 等引擎)
                if fmt == "srt":
                    # 纯文本转单条简易 SRT
                    f.write(f"1\n00:00:00,000 --> 00:10:00,000\n{text_or_result}\n")
                elif fmt == "lrc":
                    f.write(f"[00:00.00]{text_or_result}\n")
                elif fmt == "json":
                    import json
                    f.write(json.dumps({"text": text_or_result}, ensure_ascii=False, indent=2))
                else:
                    # 对于 txt 写入头部信息
                    txt_header = ""
                    if fmt == "txt" and (video_title or source_input):
                        txt_header += "=========================================\n"
                        if video_title:
                            txt_header += f"标题: {video_title}\n"
                        if source_input:
                            txt_header += f"链接: {source_input}\n"
                        txt_header += f"引擎: {engine}\n"
                        txt_header += f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                        txt_header += "=========================================\n\n"
                    f.write(txt_header + text_or_result)
        
        print(f"📄 文件已保存：{out_path}", flush=True)

def run_transcription_with_fallback(engine, audio_path, args):
    """根据主引擎和配置的备用引擎执行转录，发生异常时自动降级/更换 ASR 引擎重试"""
    # 建立引擎链
    engines_to_try = [engine]
    
    # 备用选择 1：如果主引擎不是 custom，且配置了 custom api_url，则加入备选
    if engine != "custom" and args.api_url:
        engines_to_try.append("custom")
        
    # 备用选择 2：如果主引擎不是 gemini，且配置了 gemini key，则加入备选
    gemini_key = args.api_key or os.environ.get("GEMINI_API_KEY")
    if engine != "gemini" and gemini_key:
        engines_to_try.append("gemini")
        
    # 如果主引擎不是 bcut，且前述备选均失败/未配置，也可以加入 bcut 作为无 key 兜底（因为 bcut 免费免 Key！）
    if engine != "bcut":
        engines_to_try.append("bcut")
        
    last_err = None
    for idx, eng in enumerate(engines_to_try):
        try:
            if idx > 0:
                print(f"⚠️ 主引擎 [{engine}] 转录失败，正在自动更换备用 ASR 引擎转录 [{eng}]...", flush=True)
            
            if eng == "gemini":
                return transcribe_gemini(audio_path), eng
            elif eng == "bcut":
                return transcribe_bcut(audio_path, args.proxy), eng
            elif eng == "custom":
                return transcribe_custom(audio_path, args.api_url, args.api_key, args.model_name), eng
            else:
                return transcribe_mlx(audio_path), eng
        except Exception as e:
            last_err = e
            print(f"❌ 引擎 [{eng}] 转录失败: {e}", flush=True)
            
    # 如果所有引擎都失败了，抛出最后一次的异常
    raise last_err

# ─── 主流程 ─────────────────────────────────────────────

def main():
    ensure_js_runtime()
    parser = argparse.ArgumentParser(description="视频/音频 → 文字转录工具")
    parser.add_argument("--input", "-i", required=True, help="本地文件路径或视频 URL")
    parser.add_argument("--engine", "-e", choices=["gemini", "mlx", "bcut", "custom"], default="gemini",
                        help="转录引擎")
    parser.add_argument("--output", "-o", help="输出基础文件路径")
    parser.add_argument("--formats", "-f", default="srt", help="导出的目标格式，以逗号分隔，如 srt,txt,lrc")
    parser.add_argument("--no-subtitle", action="store_true", help="跳过字幕抓取，直接转录")
    parser.add_argument("--keep-media", action="store_true", help="如果是 URL 链接，转录后保留媒体音频文件")
    
    # 自定义 API 配置
    parser.add_argument("--api-url", help="自定义 ASR API 端点 URL")
    parser.add_argument("--api-key", help="自定义 ASR API Key")
    parser.add_argument("--model-name", default="whisper-1", help="自定义 ASR 模型名称")
    
    # 第三方大语言模型 (LLM) 整理配置
    parser.add_argument("--llm-provider", default="gemini", choices=["gemini", "custom", "cli"], help="AI 大模型提供商")
    parser.add_argument("--llm-api-url", help="自定义大模型 API 端点 URL")
    parser.add_argument("--llm-api-key", help="自定义大模型 API Key")
    parser.add_argument("--llm-model-name", help="自定义大模型模型名称")
    
    # 代理配置
    parser.add_argument("--proxy", help="网络代理链接，如 http://127.0.0.1:7890")
    
    # 临时目录配置
    parser.add_argument("--temp-dir", help="指定运行过程中的临时文件夹")
    
    # Cookies 来源浏览器
    parser.add_argument("--cookies-from-browser", default="none", help="绕过机器人检测的浏览器 cookies 来源，如 chrome, edge")
    
    args = parser.parse_args()

    # 注入代理环境变量
    if args.proxy:
        os.environ["HTTP_PROXY"] = args.proxy
        os.environ["HTTPS_PROXY"] = args.proxy

    # 注入 API Key 到环境变量
    if args.engine == "gemini" and args.api_key:
        os.environ["GEMINI_API_KEY"] = args.api_key

    # 输出路径解析
    if args.output:
        output_path = os.path.expanduser(args.output)
    else:
        # 默认生成格式在 Downloads 中，使用格式中的第一项作为默认后缀
        first_fmt = args.formats.split(",")[0].strip() or "txt"
        output_path = os.path.expanduser(f"~/Downloads/{timestamp_filename(ext=first_fmt)}")

    temp_dir_base = os.path.expanduser(args.temp_dir) if args.temp_dir else None
    with tempfile.TemporaryDirectory(dir=temp_dir_base) as tmpdir:
        text_or_result = None

        title = None
        if is_url(args.input):
            title = get_page_title_fallback(args.input, args.proxy)
            if title:
                translated_title = translate_and_clean_title(title, args.proxy)
                print(f"📄 视频标题: {translated_title}", flush=True)
                dir_name = os.path.dirname(output_path)
                output_path = os.path.join(dir_name, translated_title)

            # ── URL 路径 ──
            print(f"🌐 识别为 URL：{args.input}", flush=True)

            # Step 1: 尝试抓字幕
            if not args.no_subtitle:
                # 抓取自带字幕只支持导出为 txt (简易模式) 或包裹为多格式
                sub_text = try_fetch_subtitles(args.input, tmpdir, args.cookies_from_browser)
                if sub_text:
                    text_or_result = sub_text

            # Step 2: 字幕不存在，下载音频并执行 ASR
            if not text_or_result:
                audio_path = download_audio(args.input, tmpdir, args.cookies_from_browser)
                
                # 如果用户要求保留媒体文件，拷贝一份到输出目录
                if args.keep_media:
                    base_no_ext, _ = os.path.splitext(output_path)
                    media_dest = f"{base_no_ext}.mp3"
                    shutil.copy(audio_path, media_dest)
                    print(f"🎵 媒体文件已保存：{media_dest}", flush=True)

                text_or_result, final_engine = run_transcription_with_fallback(args.engine, audio_path, args)
            else:
                final_engine = "subtitle"
        else:
            # ── 本地文件路径 ──
            input_path = os.path.expanduser(args.input)
            if not os.path.exists(input_path):
                print(f"❌ 文件不存在：{input_path}", file=sys.stderr)
                sys.exit(1)

            print(f"📁 本地文件：{input_path}", flush=True)
            audio_path = extract_audio_from_local(input_path, tmpdir)

            text_or_result, final_engine = run_transcription_with_fallback(args.engine, audio_path, args)

        # 保存为选定的多格式文件
        save_outputs(text_or_result, output_path, args.formats, final_engine, source_input=args.input, video_title=title,
                     llm_provider=args.llm_provider, llm_api_url=args.llm_api_url, llm_api_key=args.llm_api_key, llm_model_name=args.llm_model_name)

    print(f"\n✅ 转录流程全部完成！")

if __name__ == "__main__":
    main()
