# Video2Txt 视频/音频中文语音转文字工具

这是一个基于 Tauri v2 + Rust + Python 的桌面级音视频转文字应用。项目以 `claude-skill-video-transcribe` 的核心逻辑为基础，并集成了国产大厂（Bilibili 必剪）的在线 ASR 接口，解决了官方接口的 `412` 错误和验证问题，为用户提供完全免费、无 GPU 要求、高性能的语音转文字桌面体验。

## 💡 核心特性

1. **多引擎支持**：
   - **必剪 ASR (Bcut)**: 免费在线转写，速度极快，无需 API 密钥，适合日常使用（已修复 `412 Precondition Failed` 与 Pydantic 响应解析错误）。
   - **Google Gemini API**: 使用 `gemini-2.5-flash` 引擎进行高精度的智能语音转录，自动生成标点符号与精美格式。
   - **本地离线 MLX Whisper**: 支持 Apple Silicon 芯片的本地硬件加速离线转写（适合 Mac 用户）。
2. **多音视频源**：
   - 支持拖拽本地 `.mp4`, `.mov`, `.mp3`, `.m4a`, `.wav`, `.aac`, `.flac` 等格式文件进行转录。
   - 输入在线视频 URL（如 Bilibili、YouTube 等），程序自动提取并下载音频转写。
3. **字幕优先策略**：
   - 对于在线视频，优先通过 `yt-dlp` 抓取现成的 CC 字幕，秒级完成，零 API 消耗。
4. **精美中文桌面交互**：
   - 采用 **Tauri v2** + 原生极简 HTML/CSS 开发。
   - 现代玻璃拟态（Glassmorphism）暗色主题，带有微动画和流畅交互。
   - 带有文件选择器、配置面板、实时转录日志预览、转写文本展示以及一键导出功能。

---

## 🛠️ 环境准备 (Prerequisites)

在运行或编译本项目之前，请确保系统中已安装以下环境：

1. **Python 3.10+** (并添加到环境变量 `PATH`)
2. **Node.js 18+** (前端开发及打包)
3. **Rust & Cargo** (Tauri v2 编译必需)
4. **FFmpeg** (音视频提取和转码必需，需确保在终端输入 `ffmpeg -version` 能正常运行)

---

## 📁 项目目录结构

```text
video2txt/
├── Tools/
│   ├── transcribe.py          # 核心 Python 转录入口（已整合在线 ASR 选项）
│   └── online_asr.py          # [新增] 修复并优化的 Bcut ASR 客户端
├── src-tauri/                 # Tauri v2 后端目录
│   ├── src/
│   │   └── main.rs            # Rust 后端命令实现 (执行 python、依赖检测、系统交互)
│   ├── Cargo.toml             # Rust 依赖配置
│   └── tauri.conf.json        # Tauri 配置文件
├── index.html                 # 极简玻璃拟态中文前端界面
├── style.css                  # 精美暗色 CSS 样式
├── app.js                     # 前端 JavaScript 控制器
├── README_zh.md               # [当前] 中文文档说明
└── package.json               # Node 开发依赖
```

---

## 🚀 开发者说明

### 1. 运行开发服务器

在 `video2txt` 根目录下执行：

```bash
# 安装 Node 依赖
npm install

# 启动 Tauri 桌面开发版本
npm run tauri dev
```

### 2. 构建打包

生成免安装的高性能 `.exe` 桌面程序：

```bash
npm run tauri build
```
编译生成的可执行文件将存放在 `src-tauri/target/release/` 下。
