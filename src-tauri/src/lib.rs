use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ─── 辅助函数：定位 Python 脚本 ──────────────────────────────

fn find_transcribe_script(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    // 1. 尝试从 Tauri 资源目录中查找（适用于打包安装后的情况）
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let resource_path = resource_dir.join("Tools/transcribe.py");
        if resource_path.exists() {
            return Some(resource_path);
        }
        // 打包之后 Tools 被铺平或就在根目录的情况
        let resource_path_direct = resource_dir.join("transcribe.py");
        if resource_path_direct.exists() {
            return Some(resource_path_direct);
        }
    }

    // 2. 尝试从可执行文件所在目录开始，递归向上查找 Tools/transcribe.py
    if let Ok(exe_path) = std::env::current_exe() {
        let mut current_dir = exe_path.parent();
        while let Some(dir) = current_dir {
            let tool_path = dir.join("Tools/transcribe.py");
            if tool_path.exists() {
                return Some(tool_path);
            }
            current_dir = dir.parent();
        }
    }

    // 3. 尝试当前工作目录下的 Tools/transcribe.py
    let cwd_path = PathBuf::from("Tools/transcribe.py");
    if cwd_path.exists() {
        return Some(cwd_path);
    }

    // 4. 尝试上级目录下的 Tools/transcribe.py
    let parent_path = PathBuf::from("../Tools/transcribe.py");
    if parent_path.exists() {
        return Some(parent_path);
    }

    None
}

fn get_url_fallback_name(url: &str) -> String {
    if url.contains("bilibili.com") || url.contains("b23.tv") {
        if let Some(pos) = url.find("BV") {
            if url.len() >= pos + 12 {
                let bv = &url[pos..pos+12];
                if bv.chars().all(|c| c.is_alphanumeric()) {
                    return bv.to_string();
                }
            }
        }
    }
    
    if url.contains("youtube.com") || url.contains("youtu.be") {
        if let Some(pos) = url.find("v=") {
            let end_pos = url[pos+2..].find('&').map(|idx| pos + 2 + idx).unwrap_or(url.len());
            let v = &url[pos+2..end_pos];
            if !v.is_empty() {
                return v.to_string();
            }
        }
    }

    let clean_url = url.trim_end_matches('/');
    if let Some(pos) = clean_url.rfind('/') {
        let segment = &clean_url[pos+1..];
        let end_idx = segment.find('?').unwrap_or(segment.len());
        let segment_clean = &segment[..end_idx];
        if !segment_clean.is_empty() {
            let filtered: String = segment_clean.chars()
                .filter(|c| !r#"\/:*?"<>|"#.contains(*c))
                .collect();
            if !filtered.is_empty() {
                return filtered;
            }
        }
    }
    
    "online_video".to_string()
}

// ─── Tauri 命令实现 ──────────────────────────────────────────

/// 检测系统依赖项 (Python, FFmpeg) 是否已安装
#[tauri::command]
fn check_dependencies() -> Result<(bool, bool), String> {
    let mut py_cmd = Command::new("python");
    py_cmd.arg("--version");
    
    let mut py3_cmd = Command::new("python3");
    py3_cmd.arg("--version");

    let mut ff_cmd = Command::new("ffmpeg");
    ff_cmd.arg("-version");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        py_cmd.creation_flags(0x08000000);
        py3_cmd.creation_flags(0x08000000);
        ff_cmd.creation_flags(0x08000000);
    }

    let has_python = py_cmd.output().is_ok() || py3_cmd.output().is_ok();
    let has_ffmpeg = ff_cmd.output().is_ok();
    Ok((has_python, has_ffmpeg))
}

/// 打开系统原生文件选择对话框
#[tauri::command]
fn select_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let file = rfd::FileDialog::new()
            .add_filter("音视频文件", &["mp4", "mov", "avi", "mkv", "mp3", "m4a", "wav", "aac", "flac", "ogg"])
            .pick_file();
        let path = file.map(|p| p.to_string_lossy().to_string());
        let _ = tx.send(path);
    }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

/// 打开系统原生选择目录对话框
#[tauri::command]
fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let dir = rfd::FileDialog::new()
            .pick_folder();
        let path = dir.map(|p| p.to_string_lossy().to_string());
        let _ = tx.send(path);
    }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

fn visit_dirs(dir: &std::path::Path, valid_exts: &[&str], result: &mut Vec<String>) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let _ = visit_dirs(&path, valid_exts, result);
            } else {
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if valid_exts.contains(&ext.to_lowercase().as_str()) {
                        result.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    Ok(())
}

/// 批量选择多个本地文件
#[tauri::command]
fn select_multiple_files(app: tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let files = rfd::FileDialog::new()
            .add_filter("音视频文件", &["mp4", "mov", "avi", "mkv", "mp3", "m4a", "wav", "aac", "flac", "ogg"])
            .pick_files();
        let paths = files.map(|list| list.into_iter().map(|p| p.to_string_lossy().to_string()).collect());
        let _ = tx.send(paths);
    }).map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

/// 展开拖拽或选择的文件和目录，递归扫描所有有效媒体文件
#[tauri::command]
fn expand_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let valid_exts = ["mp4", "mov", "avi", "mkv", "mp3", "m4a", "wav", "aac", "flac", "ogg"];
    
    for path_str in paths {
        let path = std::path::Path::new(&path_str);
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                if valid_exts.contains(&ext.to_lowercase().as_str()) {
                    result.push(path_str);
                }
            }
        } else if path.is_dir() {
            let mut files = Vec::new();
            if let Err(e) = visit_dirs(path, &valid_exts, &mut files) {
                return Err(format!("读取文件夹失败 {}: {}", path_str, e));
            }
            result.extend(files);
        }
    }
    Ok(result)
}

/// 异步启动 Python 转录进程并实时向前端发送日志
#[tauri::command]
fn start_transcription(
    app: tauri::AppHandle,
    window: tauri::Window,
    input_path: String,
    engine: String,
    output_path: String,
    gemini_key: String,
    no_subtitle: bool,
    custom_api_url: String,
    custom_api_key: String,
    custom_model_name: String,
    proxy_url: String,
    formats: String,
    cookies_from_browser: String,
    llm_provider: String,
    llm_api_url: String,
    llm_api_key: String,
    llm_model_name: String,
) -> Result<(), String> {
    let script_path = find_transcribe_script(&app)
        .ok_or_else(|| "未找到 Tools/transcribe.py 脚本文件，请确保它存存放程序主目录下。".to_string())?;

    // 检测可用的 python 命令
    let python_cmd = if Command::new("python").arg("--version").output().is_ok() {
        "python"
    } else if Command::new("python3").arg("--version").output().is_ok() {
        "python3"
    } else {
        return Err("未找到 Python 环境。请先安装 Python 并添加到环境变量 PATH。".to_string());
    };

    let script_str = script_path.to_string_lossy().to_string();

    // 计算便携式绝对目录（Outputs, Logs, Temp）
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|dir| dir.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    // 1. 默认未指定输出目录时，将输出重定向至 app.exe 同级下的 Outputs 文件夹
    let final_output = if output_path.trim().is_empty() {
        let out_dir = exe_dir.join("Outputs");
        let _ = std::fs::create_dir_all(&out_dir);

        let file_name = if input_path.starts_with("http://") || input_path.starts_with("https://") {
            get_url_fallback_name(&input_path)
        } else {
            std::path::Path::new(&input_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("transcript")
                .to_string()
        };
        out_dir.join(file_name).to_string_lossy().to_string()
    } else {
        // 前端传来了绝对路径，直接使用
        output_path
    };

    // 2. 默认临时目录设为 app.exe 同级下的 Temp 文件夹
    let temp_dir = exe_dir.join("Temp");
    let _ = std::fs::create_dir_all(&temp_dir);

    // 3. 默认日志目录设为 app.exe 同级下的 Logs 文件夹
    let log_dir = exe_dir.join("Logs");
    let _ = std::fs::create_dir_all(&log_dir);

    // 组装参数
    let mut args = vec![
        script_str,
        "--input".to_string(),
        input_path.clone(),
        "--engine".to_string(),
        engine.clone(),
        "--output".to_string(),
        final_output,
        "--formats".to_string(),
        formats,
        "--temp-dir".to_string(),
        temp_dir.to_string_lossy().to_string(),
    ];

    if no_subtitle {
        args.push("--no-subtitle".to_string());
    }

    if !llm_provider.trim().is_empty() {
        args.push("--llm-provider".to_string());
        args.push(llm_provider);
    }
    if !llm_api_url.trim().is_empty() {
        args.push("--llm-api-url".to_string());
        args.push(llm_api_url);
    }
    if !llm_api_key.trim().is_empty() {
        args.push("--llm-api-key".to_string());
        args.push(llm_api_key);
    }
    if !llm_model_name.trim().is_empty() {
        args.push("--llm-model-name".to_string());
        args.push(llm_model_name);
    }

    // 如果使用自定义 OpenAI ASR 接口，则追加参数
    if engine == "custom" {
        if !custom_api_url.trim().is_empty() {
            args.push("--api-url".to_string());
            args.push(custom_api_url);
        }
        if !custom_api_key.trim().is_empty() {
            args.push("--api-key".to_string());
            args.push(custom_api_key);
        }
        if !custom_model_name.trim().is_empty() {
            args.push("--model-name".to_string());
            args.push(custom_model_name);
        }
    }

    // 如果指定了 cookies 来源浏览器，则追加参数
    if !cookies_from_browser.trim().is_empty() && cookies_from_browser != "none" {
        args.push("--cookies-from-browser".to_string());
        args.push(cookies_from_browser);
    }

    // 如果指定了代理，则追加代理参数
    if !proxy_url.trim().is_empty() {
        args.push("--proxy".to_string());
        args.push(proxy_url);
    }

    // 创建持久化日志文件路径：Logs/[视频/链接名称]_[时间戳].log
    let safe_name = std::path::Path::new(&input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("task")
        .replace(|c: char| !c.is_alphanumeric() && c != '_', "");
    let log_filename = format!("{}_{}.log", safe_name, chrono::Local::now().format("%Y%m%d_%H%M%S"));
    let log_path = log_dir.join(log_filename);

    // 在后台线程中执行进程，防止阻塞 GUI 线程
    std::thread::spawn(move || {
        let mut cmd = Command::new(python_cmd);
        cmd.args(&args)
           .stdout(Stdio::piped())
           .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        // 注入 Gemini 密钥
        if !gemini_key.trim().is_empty() {
            cmd.env("GEMINI_API_KEY", gemini_key);
        }

        // 强行指定 Python IO 编码为 UTF-8，防止在中文 Windows (GBK) 环境下因打印 Emoji 而出现 UnicodeEncodeError
        cmd.env("PYTHONIOENCODING", "utf-8");

        // 打开或创建持久化日志文件，追加写入
        use std::io::Write;
        let mut log_file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(true)
            .open(&log_path)
            .ok();

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = window.emit("transcribe-error", format!("启动转录程序失败: {}", e));
                return;
            }
        };

        // 读取标准输出并流式返回日志，同时写入日志文件
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout);
            let mut buf = Vec::new();
            while let Ok(n) = reader.read_until(b'\n', &mut buf) {
                if n == 0 { break; }
                let line = String::from_utf8_lossy(&buf).trim_end_matches(|c| c == '\r' || c == '\n').to_string();
                if let Some(ref mut f) = log_file {
                    let _ = writeln!(f, "{}", line);
                }
                let _ = window.emit("transcribe-log", line);
                buf.clear();
            }
        }

        // 读取标准错误输出以获取异常信息，同时写入日志文件
        let mut err_msg = String::new();
        if let Some(stderr) = child.stderr.take() {
            let mut err_reader = BufReader::new(stderr);
            let mut buf = Vec::new();
            while let Ok(n) = err_reader.read_until(b'\n', &mut buf) {
                if n == 0 { break; }
                let line = String::from_utf8_lossy(&buf).trim_end_matches(|c| c == '\r' || c == '\n').to_string();
                err_msg.push_str(&line);
                err_msg.push('\n');
                if let Some(ref mut f) = log_file {
                    let _ = writeln!(f, "[调试] {}", line);
                }
                let _ = window.emit("transcribe-log", format!("[调试] {}", line));
                buf.clear();
            }
        }

        // 等待进程结束并检查退出码
        match child.wait() {
            Ok(status) => {
                if status.success() {
                    let _ = window.emit("transcribe-success", "转录完成！");
                } else {
                    let _ = window.emit("transcribe-error", "转录异常结束，详细错误栈已输出至下方调试日志。".to_string());
                }
            }
            Err(e) => {
                let _ = window.emit("transcribe-error", format!("等待进程结束时出错: {}", e));
            }
        }
    });

    Ok(())
}

/// 读取本地文本文件内容
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// 将文本内容写入到本地文件 (另存为)
#[tauri::command]
fn write_text_file_content(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// 以系统默认关联方式打开文件
#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", &path])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 打开所在文件夹并高亮选中文件
#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let path = path.replace("/", "\\");
        Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
        Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 获取当前可执行程序所在目录的绝对路径
#[tauri::command]
fn get_app_dir() -> Result<String, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|dir| dir.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    Ok(exe_dir.to_string_lossy().to_string())
}

/// 运行 B站 扫码登录原生 Rust 实现
#[tauri::command]
async fn run_bili_login(_app: tauri::AppHandle, cmd: String, arg: String) -> Result<String, String> {
    use std::fs;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|dir| dir.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let cookies_path = exe_dir.join("bili_cookies.json");
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    match cmd.as_str() {
        "generate" => {
            let resp = ureq::get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
                .set("User-Agent", ua)
                .call()
                .map_err(|e| format!("生成二维码请求失败: {}", e))?;
            let body: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
            Ok(body.to_string())
        }
        "poll" => {
            let url = format!("https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key={}", arg);
            let resp = ureq::get(&url)
                .set("User-Agent", ua)
                .call()
                .map_err(|e| format!("扫码状态轮询请求失败: {}", e))?;
            
            let cookies: Vec<String> = resp.all("set-cookie").iter().map(|s| s.to_string()).collect();
            let body: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
            
            if body["code"] == 0 && body["data"]["code"] == 0 {
                // 登录成功，解析 Cookies
                let mut cookie_map = serde_json::Map::new();
                for cookie_str in cookies {
                    if let Some(first_part) = cookie_str.split(';').next() {
                        let mut parts = first_part.splitn(2, '=');
                        if let (Some(key), Some(value)) = (parts.next(), parts.next()) {
                            cookie_map.insert(key.trim().to_string(), serde_json::Value::String(value.trim().to_string()));
                        }
                    }
                }
                
                if !cookie_map.is_empty() {
                    let _ = fs::write(&cookies_path, serde_json::to_string_pretty(&cookie_map).unwrap());
                }
            }
            Ok(body.to_string())
        }
        "status" => {
            if !cookies_path.exists() {
                return Ok(r#"{"status":"not_logged_in"}"#.to_string());
            }
            
            let cookies_content = fs::read_to_string(&cookies_path).map_err(|e| e.to_string())?;
            let cookies: serde_json::Value = serde_json::from_str(&cookies_content).map_err(|e| e.to_string())?;
            
            let cookie_header = cookies.as_object().map(|obj| {
                obj.iter()
                    .map(|(k, v)| format!("{}={}", k, v.as_str().unwrap_or("")))
                    .collect::<Vec<String>>()
                    .join("; ")
            }).unwrap_or_default();
            
            let resp = ureq::get("https://api.bilibili.com/x/web-interface/nav")
                .set("User-Agent", ua)
                .set("Cookie", &cookie_header)
                .call();
                
            match resp {
                Ok(r) => {
                    let body: serde_json::Value = r.into_json().map_err(|e| e.to_string())?;
                    if body["code"] == 0 && body["data"]["isLogin"].as_bool().unwrap_or(false) {
                        let uname = body["data"]["uname"].as_str().unwrap_or("未知");
                        let mid = body["data"]["mid"].as_i64().unwrap_or(0);
                        Ok(format!(r#"{{"status":"logged_in","uname":"{}","mid":{}}}"#, uname, mid))
                    } else {
                        Ok(r#"{"status":"expired"}"#.to_string())
                    }
                }
                Err(e) => {
                    Ok(format!(r#"{{"status":"error","message":"{}"}}"#, e))
                }
            }
        }
        "logout" => {
            if cookies_path.exists() {
                let _ = fs::remove_file(&cookies_path);
            }
            Ok(r#"{"status":"logged_out","code":0}"#.to_string())
        }
        _ => Err(format!("未知命令: {}", cmd))
    }
}

#[derive(serde::Serialize)]
struct NetworkStatus {
    bili_ok: bool,
    yt_ok: bool,
}

/// 启动时检测 B站 和 YouTube 的网络连通性
#[tauri::command]
async fn check_network(proxy_url: String) -> Result<NetworkStatus, String> {
    let bili_ok = test_url_connect("https://www.bilibili.com", None);
    let yt_ok = test_url_connect("https://www.youtube.com", if proxy_url.is_empty() { None } else { Some(&proxy_url) });
    
    Ok(NetworkStatus { bili_ok, yt_ok })
}

fn test_url_connect(url: &str, proxy: Option<&str>) -> bool {
    let mut agent_builder = ureq::AgentBuilder::new();
    if let Some(proxy_str) = proxy {
        let trimmed = proxy_str.trim();
        if !trimmed.is_empty() {
            if let Ok(p) = ureq::Proxy::new(trimmed) {
                agent_builder = agent_builder.proxy(p);
            }
        }
    }
    let agent = agent_builder.build();
    agent.get(url)
         .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
         .timeout(std::time::Duration::from_secs(4))
         .call()
         .is_ok()
}

// ─── Tauri 应用入口 ──────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Apply vibrancy/mica window effects
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                #[cfg(target_os = "windows")]
                {
                    let _ = window_vibrancy::apply_mica(&window, None);
                }
                #[cfg(target_os = "macos")]
                {
                    let _ = window_vibrancy::apply_vibrancy(
                        &window,
                        window_vibrancy::NSVisualEffectMaterial::Sidebar,
                        None,
                        None,
                    );
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_dependencies,
            select_file,
            select_multiple_files,
            select_directory,
            expand_paths,
            start_transcription,
            read_text_file,
            write_text_file_content,
            open_file,
            show_in_folder,
            get_app_dir,
            run_bili_login,
            check_network
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
