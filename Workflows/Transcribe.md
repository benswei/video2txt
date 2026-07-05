# Workflow: Transcribe

将视频/音频转成完整文字稿。

---

## 1. 确认 Python 执行环境
根据当前操作系统，在终端运行 Python 脚本时使用可用的 Python 命令（Windows 通常为 `python`，macOS/Linux 通常为 `python3` 或 `python`）。

## 2. 运行转录脚本
在 **项目根目录** 下执行转录任务。

### A. 处理本地文件
```bash
python Tools/transcribe.py --input "/path/to/video.mp4" --engine bcut --formats srt,txt,md
```
*提示：本地路径请根据实际情况替换，`--engine` 可选 `bcut` / `gemini` / `custom` / `mlx`。*

### B. 处理在线视频链接 (YouTube / B站 / 其它)
```bash
python Tools/transcribe.py --input "https://www.youtube.com/watch?v=eA6R37fGuog" --engine gemini --formats srt,txt,md
```
*提示：脚本会自动拉取该网页的视频标题并翻译成中文，然后作为保存文件的名字，不使用编号或临时时间戳。*

---

## 3. 执行完毕后续步骤
1. 转录生成的文件会自动保存在软件的 `Outputs/` 目录下。
2. 为用户展示转录稿前 500 字的预览。
3. 告知用户保存文件的具体路径。
4. 询问用户："需要我为您进一步提炼和总结核心要点吗？"

---

## 4. 引擎说明

| 引擎 | 参数选项 | 优点 | 缺点 |
|------|------|------|------|
| `gemini`（默认）| `--engine gemini` | 有标点、段落重构与排版好 | 需网络 + API Key |
| `bcut` | `--engine bcut` | 免 API 密钥，直接解析时间轴 | 云端接口，无标点 |
| `mlx` | `--engine mlx` | Mac 专属完全本地离线，免费 | 无标点，首次运行需要下载模型 |
| `custom` | `--engine custom` | 支持 SiliconFlow 等自定义 ASR 端点 | 需自行配置 API Key 与 API URL |
