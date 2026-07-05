---
name: VideoTranscribe
description: 视频/音频转文字 + 核心提炼。USE WHEN 用户提到：转录、转文字、字幕、视频转文字、音频转文字、抓字幕、YouTube转文字、B站转文字、视频笔记、transcript、提炼视频重点、视频总结。
---

# VideoTranscribe

将视频/音频内容转成文字，并可进一步提炼核心要点。

支持：
- **本地文件**：MP4、MOV、MP3、M4A 等
- **在线 URL**：YouTube、B站、小宇宙、优酷等 yt-dlp 支持的平台
- **提炼模式**：转录完成后可输出结构化要点摘要

## 🔊 Voice Notification（语音通知 - 跨平台兼容）

在开始转录任务前，可通过以下跨平台 Python 命令发送通知（可选）：

```bash
python -c "import urllib.request, json; urllib.request.urlopen(urllib.request.Request('http://localhost:8888/notify', data=json.dumps({'message': 'Running VideoTranscribe skill'}).encode(), headers={'Content-Type': 'application/json'}), timeout=2)"
```

## Workflow Routing

| 用户需求 | 路由至工作流 |
|---------|--------|
| 转录 / 转文字 / 字幕 / 音视频文件或链接 | [Transcribe.md](file:///d:/0AI/转文字/video2txt/Workflows/Transcribe.md) |
| 提炼 / 总结 / 核心要点 / 重点 | [Extract.md](file:///d:/0AI/转文字/video2txt/Workflows/Extract.md) |
| 两者都要（先转录再提炼要点）| 先 [Transcribe.md](file:///d:/0AI/转文字/video2txt/Workflows/Transcribe.md)，再 [Extract.md](file:///d:/0AI/转文字/video2txt/Workflows/Extract.md) |

## Quick Reference

- **脚本路径**：项目根目录下的 `Tools/transcribe.py` (在终端中运行项目根目录下的命令)
- **优先策略**：在线 URL → 优先尝试拉取现成字幕（节省 API）→ 字幕不存在则下载音频并转录
- **转录引擎**：
  - `gemini`（默认）：使用 Gemini 2.5 Flash 进行云端智能识别与排版，提供最佳的标点与排版。
  - `bcut`：必剪云端转录，免费，支持生成带时间轴的 SRT/LRC 字幕。
  - `mlx`：Mac 专用本地离线 Whisper 引擎。
- **输出保存路径**：默认保存在 `Outputs/` 目录下（自动使用网页标题或原文件名命名，无数字编号前缀）。
