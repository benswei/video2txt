# Video2Txt (音视频免显卡快速转文字工具)

**Video2Txt** 是一款界面优雅、运行极速的音视频转文字桌面客户端。它基于 **Tauri (Rust) + JavaScript** 开发前端界面，并以 **Python** 作为底层转录引擎，专为自媒体创作者、内容提取者和学习者量身定制。支持本地音视频批量转录、主流视频网站链接（YouTube/B站）一键抓取、云端/离线多种转录引擎，并支持 AI 智能段落重构与排版优化。

---

## ✨ 核心特性

- 🖥️ **精美毛玻璃 GUI**：现代质感的桌面端应用，完美支持**深色 (Dark) / 浅色 (Light) 主题**一键切换。
- 🔍 **环境依赖一键预检**：启动时自动检测并指示系统 Python、FFmpeg、B站连接以及 YouTube 连接状态，免去复杂的排错步骤。
- 📦 **多文件与文件夹批量导入**：支持将多个音视频文件或整个文件夹**拖拽**至列表，支持排队批量顺序执行，提供实时的日志面板与进度百分比。
- ☁️ **丰富的转录引擎支持**：
  - **Gemini 2.5 Flash** (推荐)：智能高精度转录，生成完美带有标点的文本。已实现**自动重试与指数退避**，从容应对临时网络波动与 API 繁忙。
  - **必剪 ASR (Bcut)**：B站官方语音识别接口，**完全免费且免 API 密钥**，支持自动生成精确时间轴。
  - **自定义 OpenAI 兼容接口**：可配置接入 SiliconFlow (SenseVoice)、Groq (Whisper) 等第三方大模型 ASR API。
  - **mlx-whisper** (本地离线)：Apple Silicon Mac 设备专属，完全离线运行，保护隐私。
- 📝 **AI 智能段落优化 (Markdown)**：调用大语言模型（Gemini 或自定义 API）在**保留 90% 以上核心细节、观点及数据**的前提下，将杂乱的口语化转录稿重构成层级清晰、重点突出的 Markdown 格式文章。
- 📄 **多格式一键导出**：一键完成 SRT 字幕、LRC 歌词、TXT 纯文本、Markdown 格式化笔记的同步导出。
- 🌐 **在线视频直接抓取**：直接输入 YouTube 或 B 站链接，程序自动解析、提取音频并转写，对于 YouTube 还可以优先抓取现成字幕。

---

## 🛠️ 环境要求

Video2Txt 的桌面客户端需要系统具备以下底层环境：

1. **Python 3.9+** (需添加到系统环境变量 `PATH` 中)。
2. **FFmpeg** (音视频剪辑核心，需添加到系统环境变量 `PATH` 中)。

---

## 🚀 快速开始

### 桌面客户端使用 (GUI)
1. 下载并运行 `app.exe` (或在 Mac/Linux 下运行打包生成的对应安装包)。
2. 软件右上角点击 **[⚙️ 设置]**，填入您的 **Gemini API Key**，并按需配置代理服务器端口（如 Clash `http://127.0.0.1:7892`）。
3. 拖拽视频/音频文件到 **[选择音视频源]** 区域，或者在下方输入 YouTube/B 站链接。
4. 在右侧 **[转录配置]** 中选择转录引擎及想要导出的格式（推荐勾选 **Markdown 优化**）。
5. 点击下方 **[开始执行]** 按钮，等待任务完成。转录好的文件将自动导出在 app 同级的 `Outputs/` 目录下。

### 命令行工具使用 (CLI)
如果您习惯在终端下工作，或者需要将转录功能集成至您的 AI Agent 工作流中，可以直接运行 Python 核心脚本：

```bash
# 转录本地视频并输出多种格式
python Tools/transcribe.py --input "D:\path\to\video.mp4" --engine bcut --formats srt,txt,md

# 转录 YouTube/B站 视频并使用 Gemini 引擎进行转写
python Tools/transcribe.py --input "https://www.youtube.com/watch?v=xxxx" --engine gemini --formats srt,txt,md

# 使用系统代理
python Tools/transcribe.py --input "https://www.youtube.com/watch?v=xxxx" --engine gemini --proxy "http://127.0.0.1:7892"
```

---

## ⚙️ 开发者说明

### 1. 运行开发服务器

在 `video2txt` 根目录下执行：

```bash
# 安装 Node 依赖
npm install

# 启动 Tauri 桌面开发版本
npm run dev
```

### 2. 构建打包

生成免安装的高性能 `.exe` 桌面程序：

```bash
npm run build
```
编译生成的可执行文件将存放在 `src-tauri/target/release/` 下。

---

## 📂 项目结构

```
video2txt/
├── src-tauri/            # Tauri 桌面客户端 Rust 后端及打包配置
├── src/                  # 桌面端 GUI 界面 (HTML / CSS / JavaScript)
├── Tools/
│   ├── transcribe.py     # 核心转录与控制脚本 (Python)
│   └── online_asr.py     # 必剪 ASR 云端接口客户端实现
├── Workflows/
│   ├── Transcribe.md     # 转录核心逻辑工作流说明
│   └── Extract.md        # AI 文章提炼与重构模版
├── SKILL.md              # Claude Code Skill 入口定义
└── package.json          # Node.js 依赖及构建配置
```

## 📄 开源协议

本项目基于 **MIT License** 开源，详情请参阅 [LICENSE](LICENSE) 文件。
