// Destructure Tauri APIs from global injection
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// UI 元素引用
const depPython = document.getElementById('dep-python');

// 主 Tab 切换逻辑
const mainTabBtns = document.querySelectorAll('.main-tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

function switchMainTab(targetId) {
    mainTabBtns.forEach(btn => {
        if (btn.getAttribute('data-target') === targetId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    tabPanels.forEach(panel => {
        if (panel.id === targetId) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });
}

mainTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        switchMainTab(targetId);
        if (targetId === 'panel-settings') {
            loadConfig();
            checkBiliStatus(); // 切换到设置面板时检测 B站 登录状态
        }
    });
});
const depFfmpeg = document.getElementById('dep-ffmpeg');
const depBili = document.getElementById('dep-bili');
const depYoutube = document.getElementById('dep-youtube');
const dropZone = document.getElementById('drop-zone');
const selectedFileInfo = document.getElementById('selected-file-info');
const clearFileBtn = document.getElementById('clear-file');
const urlInput = document.getElementById('url-input');
const engineSelect = document.getElementById('engine-select');
const skipSubCheckbox = document.getElementById('skip-sub-checkbox');
const startBtn = document.getElementById('start-btn');
const statusText = document.getElementById('status-text');
const progressBarContainer = document.getElementById('progress-bar-container');
const progressPercent = document.getElementById('progress-percent');
const progressFill = document.getElementById('progress-fill');
const logBox = document.getElementById('log-box');
const clearLogsBtn = document.getElementById('clear-logs');

// ⚙️ 配置中心元素
const settingsSave = document.getElementById('settings-save');

const modalGeminiKey = document.getElementById('modal-gemini-key');
const modalSiliconFlowKey = document.getElementById('modal-siliconflow-key');
const modalCustomUrl = document.getElementById('modal-custom-url');
const modalCustomKey = document.getElementById('modal-custom-key');
const modalCustomModel = document.getElementById('modal-custom-model');
const modalOutputDir = document.getElementById('modal-output-dir');
const modalLogDir = document.getElementById('modal-log-dir');
const modalKeepMedia = document.getElementById('modal-keep-media');
const modalProxyUrl = document.getElementById('modal-proxy-url');
const modalCookiesFromBrowser = document.getElementById('modal-cookies-from-browser');
const modalYtCookiesRaw = document.getElementById('modal-yt-cookies-raw');

const modalLlmProvider = document.getElementById('modal-llm-provider');
const modalLlmUrl = document.getElementById('modal-llm-url');
const modalLlmKey = document.getElementById('modal-llm-key');
const modalLlmModel = document.getElementById('modal-llm-model');
const modalLlmCliTemplate = document.getElementById('modal-llm-cli-template');
const llmCustomContainer = document.getElementById('llm-custom-container');
const llmCliContainer = document.getElementById('llm-cli-container');

const saveModeSame = document.getElementById('save-mode-same');
const saveModeCustom = document.getElementById('save-mode-custom');
const outputDirInputContainer = document.getElementById('output-dir-input-container');

// 批量文件 DOM
const btnSelectFiles = document.getElementById('btn-select-files');
const btnSelectFolder = document.getElementById('btn-select-folder');
const selectedFilesCount = document.getElementById('selected-files-count');
const selectedFilesList = document.getElementById('selected-files-list');

// B站扫码登录 DOM
const biliLoginStatus = document.getElementById('bili-login-status');
const btnBiliLogout = document.getElementById('btn-bili-logout');
const biliQrcodeWrapper = document.getElementById('bili-qrcode-wrapper');
const biliQrcodeImg = document.getElementById('bili-qrcode-img');
const biliQrcodeHint = document.getElementById('bili-qrcode-hint');
const btnBiliLoginTrigger = document.getElementById('btn-bili-login-trigger');

const btnBrowseOutput = document.getElementById('btn-browse-output');
const btnClearOutput = document.getElementById('btn-clear-output');
const btnBrowseLog = document.getElementById('btn-browse-log');
const btnClearLog = document.getElementById('btn-clear-log');

// 📜 历史记录元素
const tabLocal = document.getElementById('tab-local');
const tabUrl = document.getElementById('tab-url');
const historyLocalList = document.getElementById('history-local-list');
const historyUrlList = document.getElementById('history-url-list');
const clearHistoryBtn = document.getElementById('clear-history');

// 格式多选框
const fmtSrt = document.getElementById('fmt-srt');
const fmtTxt = document.getElementById('fmt-txt');
const fmtMd = document.getElementById('fmt-md');
const fmtLrc = document.getElementById('fmt-lrc');
const fmtJson = document.getElementById('fmt-json');

// 运行时变量
let selectedFilePaths = [];
let isTranscribing = false;
let completedFilePaths = []; // 保存生成的所有输出路径
let currentTaskTitle = '';   // 当前转录的视频标题
let currentTaskResolver = null;
let currentTaskRejecter = null;

// ─── 1. 配置加载与保存 (LocalStorage) ───────────────────────

const DEFAULT_CONFIG = {
    geminiKey: '',
    siliconflowKey: '',
    customUrl: '',
    customKey: '',
    customModel: 'whisper-1',
    llmProvider: 'gemini',
    llmUrl: '',
    llmKey: '',
    llmModel: '',
    llmCliTemplate: 'claude -p "请将此文本整理为Markdown" -f {input_file}',
    saveMode: 'same',
    outputDir: '',
    logDir: '',
    keepMedia: false,
    proxyUrl: '',
    theme: 'dark',
    fontSize: '14px',
    cookiesFromBrowser: 'none',
    ytCookiesRaw: ''
};

let appConfig = { ...DEFAULT_CONFIG };

function applyThemeAndFont(theme, fontSize) {
    // 应用主题
    if (theme === 'light') {
        document.body.classList.add('theme-light');
    } else {
        document.body.classList.remove('theme-light');
    }
    
    // 应用字体大小
    document.body.classList.remove('font-size-12', 'font-size-14', 'font-size-16', 'font-size-18');
    const sizeClass = `font-size-${fontSize.replace('px', '')}`;
    document.body.classList.add(sizeClass);
}

function loadConfig() {
    const saved = localStorage.getItem('video2txt_config');
    if (saved) {
        try {
            appConfig = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
        } catch (e) {
            console.error('Failed to parse config:', e);
        }
    }
    
    modalGeminiKey.value = appConfig.geminiKey;
    if (modalSiliconFlowKey) modalSiliconFlowKey.value = appConfig.siliconflowKey || '';
    modalCustomUrl.value = appConfig.customUrl;
    modalCustomKey.value = appConfig.customKey;
    modalCustomModel.value = appConfig.customModel;
    modalOutputDir.value = appConfig.outputDir;
    modalLogDir.value = appConfig.logDir;
    modalKeepMedia.checked = appConfig.keepMedia;
    modalProxyUrl.value = appConfig.proxyUrl || '';
    if (modalCookiesFromBrowser) modalCookiesFromBrowser.value = appConfig.cookiesFromBrowser || 'none';
    if (modalYtCookiesRaw) modalYtCookiesRaw.value = appConfig.ytCookiesRaw || '';
    
    if (modalLlmProvider) modalLlmProvider.value = appConfig.llmProvider || 'gemini';
    if (modalLlmUrl) modalLlmUrl.value = appConfig.llmUrl || '';
    if (modalLlmKey) modalLlmKey.value = appConfig.llmKey || '';
    if (modalLlmModel) modalLlmModel.value = appConfig.llmModel || '';
    if (modalLlmCliTemplate) modalLlmCliTemplate.value = appConfig.llmCliTemplate || '';

    // 初始化切换容器显示状态
    toggleLlmContainers(appConfig.llmProvider || 'gemini');

    const saveMode = appConfig.saveMode || 'same';
    if (saveMode === 'same') {
        if (saveModeSame) saveModeSame.checked = true;
        if (outputDirInputContainer) outputDirInputContainer.classList.add('hidden');
    } else {
        if (saveModeCustom) saveModeCustom.checked = true;
        if (outputDirInputContainer) outputDirInputContainer.classList.remove('hidden');
    }
    
    const themeSelect = document.getElementById('modal-theme-select');
    const fontSelect = document.getElementById('modal-font-size-select');
    if (themeSelect) themeSelect.value = appConfig.theme;
    if (fontSelect) fontSelect.value = appConfig.fontSize;

    // 页面初始化应用
    applyThemeAndFont(appConfig.theme, appConfig.fontSize);
}

function saveConfig() {
    appConfig.geminiKey = modalGeminiKey.value.trim();
    if (modalSiliconFlowKey) appConfig.siliconflowKey = modalSiliconFlowKey.value.trim();
    appConfig.customUrl = modalCustomUrl.value.trim();
    appConfig.customKey = modalCustomKey.value.trim();
    appConfig.customModel = modalCustomModel.value.trim() || 'whisper-1';
    appConfig.outputDir = modalOutputDir.value.trim();
    appConfig.logDir = modalLogDir.value.trim();
    appConfig.keepMedia = modalKeepMedia.checked;
    appConfig.proxyUrl = modalProxyUrl.value.trim();
    if (modalCookiesFromBrowser) appConfig.cookiesFromBrowser = modalCookiesFromBrowser.value;
    if (modalYtCookiesRaw) appConfig.ytCookiesRaw = modalYtCookiesRaw.value;
    
    if (modalLlmProvider) appConfig.llmProvider = modalLlmProvider.value;
    if (modalLlmUrl) appConfig.llmUrl = modalLlmUrl.value.trim();
    if (modalLlmKey) appConfig.llmKey = modalLlmKey.value.trim();
    if (modalLlmModel) appConfig.llmModel = modalLlmModel.value.trim();
    if (modalLlmCliTemplate) appConfig.llmCliTemplate = modalLlmCliTemplate.value.trim();
    if (saveModeSame) appConfig.saveMode = saveModeSame.checked ? 'same' : 'custom';
    
    const themeSelect = document.getElementById('modal-theme-select');
    const fontSelect = document.getElementById('modal-font-size-select');
    if (themeSelect) appConfig.theme = themeSelect.value;
    if (fontSelect) appConfig.fontSize = fontSelect.value;

    localStorage.setItem('video2txt_config', JSON.stringify(appConfig));
    applyThemeAndFont(appConfig.theme, appConfig.fontSize);
    
    // 写入 youtube_cookies.txt
    (async () => {
        try {
            const appDir = await invoke('get_app_dir');
            const ytCookiesPath = `${appDir}\\youtube_cookies.txt`;
            await invoke('write_text_file_content', {
                path: ytCookiesPath,
                content: appConfig.ytCookiesRaw || ''
            });
        } catch (err) {
            console.error('Failed to write youtube_cookies.txt:', err);
            appendLog(`⚠️ 写入 YouTube Cookies 文件失败: ${err}`, 'error');
        }
    })();
    
    const saveHint = document.getElementById('settings-save-hint');
    if (saveHint) {
        saveHint.style.opacity = '1';
        setTimeout(() => {
            saveHint.style.opacity = '0';
        }, 2000);
    }
    
    appendLog('⚙️ 配置保存成功。', 'success');
    
    // 重新检测网络以更新状态栏
    checkNetwork();
}

// ─── 2. 依赖检测 ─────────────────────────────────────────────

async function checkDependencies() {
    const cached = localStorage.getItem('video2txt_dep_checked');
    if (cached) {
        try {
            const { hasPython, hasFfmpeg } = JSON.parse(cached);
            if (hasPython && hasFfmpeg) {
                depPython.textContent = 'Python 已安装';
                depPython.className = 'dep-status installed';
                depFfmpeg.textContent = 'FFmpeg 已安装';
                depFfmpeg.className = 'dep-status installed';
                validateInputs();
                return; // 缓存命中且均正常，直接跳过检测
            }
        } catch (e) {
            console.error('Failed to parse cached dependencies:', e);
        }
    }

    appendLog('🔍 正在检测系统依赖项...', 'info');
    try {
        const [hasPython, hasFfmpeg] = await invoke('check_dependencies');
        
        if (hasPython) {
            depPython.textContent = 'Python 已安装';
            depPython.className = 'dep-status installed';
            appendLog('✅ 检测到 Python 环境。', 'success');
        } else {
            depPython.textContent = 'Python 未找到';
            depPython.className = 'dep-status missing';
            appendLog('❌ 未找到 Python 环境，请先安装 Python 并添加至 PATH。', 'error');
        }

        if (hasFfmpeg) {
            depFfmpeg.textContent = 'FFmpeg 已安装';
            depFfmpeg.className = 'dep-status installed';
            appendLog('✅ 检测到 FFmpeg。', 'success');
        } else {
            depFfmpeg.textContent = 'FFmpeg 未找到';
            depFfmpeg.className = 'dep-status missing';
            appendLog('❌ 未找到 FFmpeg，音视频转码功能将不可用，请下载并将其 bin 目录添加至 PATH。', 'error');
        }

        if (hasPython) {
            validateInputs();
        } else {
            startBtn.disabled = true;
            appendLog('⚠️ 基础依赖（Python）缺失，程序已被锁定。请修复后重启。', 'error');
        }

        // 缓存成功的检测结果
        if (hasPython && hasFfmpeg) {
            localStorage.setItem('video2txt_dep_checked', JSON.stringify({ hasPython, hasFfmpeg }));
        }
    } catch (err) {
        appendLog(`❌ 依赖检测出错: ${err}`, 'error');
    }
}

// ─── 3. 文件/目录选择与拖拽 ───────────────────────────────────

// 选择多个本地文件
async function handleSelectFile() {
    if (isTranscribing) return;
    try {
        const files = await invoke('select_multiple_files');
        if (files && files.length > 0) {
            addFiles(files);
        }
    } catch (err) {
        appendLog(`❌ 文件选择出错: ${err}`, 'error');
    }
}

// 扫描文件夹
async function handleSelectFolder() {
    if (isTranscribing) return;
    try {
        const dir = await invoke('select_directory');
        if (dir) {
            appendLog(`📂 正在扫描文件夹: ${dir}...`, 'info');
            const expanded = await invoke('expand_paths', { paths: [dir] });
            if (expanded && expanded.length > 0) {
                addFiles(expanded);
                appendLog(`✅ 文件夹扫描完毕，成功导入 ${expanded.length} 个文件。`, 'success');
            } else {
                appendLog(`⚠️ 文件夹中未检测到支持的音视频格式文件。`, 'warning');
            }
        }
    } catch (err) {
        appendLog(`❌ 扫描文件夹出错: ${err}`, 'error');
    }
}

// 窗口级拖拽文件与目录
listen('tauri://drag-drop', async (event) => {
    if (isTranscribing) return;
    const paths = event.payload.paths;
    if (paths && paths.length > 0) {
        try {
            appendLog(`📂 正在解析拖入的路径...`, 'info');
            const expanded = await invoke('expand_paths', { paths });
            if (expanded && expanded.length > 0) {
                addFiles(expanded);
                appendLog(`✅ 成功导入拖入的 ${expanded.length} 个音视频文件。`, 'success');
            } else {
                appendLog(`❌ 未能识别到任何支持的音视频格式文件。`, 'error');
            }
        } catch (err) {
            appendLog(`❌ 解析路径出错: ${err}`, 'error');
        }
    }
});

function setFile(filePath) {
    selectedFilePaths = [filePath];
    urlInput.value = ''; // 选中本地文件则清除在线 URL
    updateSelectedFilesUI();
    appendLog(`📁 已选择本地文件: ${filePath}`, 'info');
    validateInputs();
}

function updateSelectedFilesUI() {
    selectedFilesList.innerHTML = '';
    if (selectedFilePaths.length === 0) {
        selectedFileInfo.classList.add('hidden');
        selectedFilesCount.textContent = '已选择 0 个文件';
    } else {
        selectedFileInfo.classList.remove('hidden');
        selectedFilesCount.textContent = `已选择 ${selectedFilePaths.length} 个文件`;
        
        selectedFilePaths.forEach((filePath, index) => {
            const fileName = filePath.split(/[/\\]/).pop();
            
            const pill = document.createElement('div');
            pill.className = 'file-item-pill';
            
            const pathSpan = document.createElement('span');
            pathSpan.className = 'file-path-text';
            pathSpan.textContent = fileName;
            pathSpan.title = filePath;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn-remove-file';
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedFilePaths.splice(index, 1);
                updateSelectedFilesUI();
                validateInputs();
            });
            
            pill.appendChild(pathSpan);
            pill.appendChild(removeBtn);
            selectedFilesList.appendChild(pill);
        });
    }
}

function addFiles(files) {
    if (!files || files.length === 0) return;
    urlInput.value = '';
    files.forEach(file => {
        if (!selectedFilePaths.includes(file)) {
            selectedFilePaths.push(file);
        }
    });
    updateSelectedFilesUI();
    validateInputs();
}

function clearFile(e) {
    if (e) e.stopPropagation();
    selectedFilePaths = [];
    updateSelectedFilesUI();
    validateInputs();
}

// 选择保存/日志目录
async function browseDirectory(inputId) {
    try {
        const dir = await invoke('select_directory');
        if (dir) {
            document.getElementById(inputId).value = dir;
        }
    } catch (err) {
        appendLog(`❌ 选择文件夹出错: ${err}`, 'error');
    }
}

// ─── 4. 转写历史记录管理 (LocalStorage) ─────────────────────

function getHistory(type) {
    const key = `video2txt_history_${type}`;
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : [];
}

function saveHistory(type, list) {
    const key = `video2txt_history_${type}`;
    localStorage.setItem(key, JSON.stringify(list.slice(0, 100))); // 限制保存前 100 条
}

function addHistoryRecord(type, source, engine, formats, status, outputPaths, title = '') {
    const list = getHistory(type);
    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const newRecord = {
        id: Date.now().toString(),
        source,
        engine,
        formats,
        date: dateStr,
        status,
        outputPaths,
        title: title || currentTaskTitle
    };
    list.unshift(newRecord);
    saveHistory(type, list);
    renderHistory();
}

function deleteHistoryRecord(type, id, e) {
    if (e) e.stopPropagation();
    let list = getHistory(type);
    list = list.filter(item => item.id !== id);
    saveHistory(type, list);
    renderHistory();
}

function clearHistory() {
    const activeTab = tabLocal.classList.contains('active') ? 'local' : 'url';
    localStorage.removeItem(`video2txt_history_${activeTab}`);
    appendLog(`📜 已清空历史记录`, 'info');
    renderHistory();
}

function renderHistory() {
    // 渲染本地历史
    const localList = getHistory('local');
    if (localList.length === 0) {
        historyLocalList.innerHTML = '<div class="history-placeholder">暂无本地任务转写历史记录</div>';
    } else {
        historyLocalList.innerHTML = localList.map(item => {
            const engineLabel = getEngineLabel(item.engine);
            const statusClass = item.status === 'success' ? 'success' : 'failed';
            const statusLabel = item.status === 'success' ? '成功' : '失败';
            const fileName = item.source.split(/[/\\]/).pop();
            return `
                <div class="history-item" onclick="loadHistoryItem('local', '${item.id}')">
                    <span class="history-item-source" title="${item.source}">${item.title || fileName}</span>
                    <span class="history-item-engine">${engineLabel}</span>
                    <span class="history-item-date">${item.date}</span>
                    <span class="history-item-status ${statusClass}">${statusLabel}</span>
                    <button class="btn-history-del" onclick="deleteHistoryRecord('local', '${item.id}', event)">&times;</button>
                </div>
            `;
        }).join('');
    }

    // 渲染链接历史
    const urlList = getHistory('url');
    if (urlList.length === 0) {
        historyUrlList.innerHTML = '<div class="history-placeholder">暂无在线链接转写历史记录</div>';
    } else {
        historyUrlList.innerHTML = urlList.map(item => {
            const engineLabel = getEngineLabel(item.engine);
            const statusClass = item.status === 'success' ? 'success' : 'failed';
            const statusLabel = item.status === 'success' ? '成功' : '失败';
            const displayTitle = item.title ? `📄 ${item.title}` : `🌐 ${item.source}`;
            return `
                <div class="history-item" onclick="loadHistoryItem('url', '${item.id}')">
                    <span class="history-item-source" title="${item.source}">
                        <span onclick="window.openFile('${item.source}'); event.stopPropagation();" style="color: var(--primary-color); text-decoration: underline; cursor: pointer;">${displayTitle}</span>
                    </span>
                    <span class="history-item-engine">${engineLabel}</span>
                    <span class="history-item-date">${item.date}</span>
                    <span class="history-item-status ${statusClass}">${statusLabel}</span>
                    <button class="btn-history-del" onclick="deleteHistoryRecord('url', '${item.id}', event)">&times;</button>
                </div>
            `;
        }).join('');
    }
}

function getEngineLabel(engine) {
    switch (engine) {
        case 'bcut': return '必剪 ASR';
        case 'gemini': return 'Gemini API';
        case 'siliconflow-sensevoice': return '硅基 SenseVoice';
        case 'siliconflow-whisper': return '硅基 Whisper';
        case 'custom': return '自定义 ASR';
        case 'mlx': return 'Local MLX';
        default: return engine;
    }
}

// 选中历史条目自动加载数据预览
async function loadHistoryItem(type, id) {
    const list = getHistory(type);
    const item = list.find(r => r.id === id);
    if (!item) return;

    if (type === 'local') {
        setFile(item.source);
    } else {
        urlInput.value = item.source;
        clearFile();
    }
    validateInputs();

    // 如果任务成功并且有输出文件，展示文件卡片并切换到执行任务 Tab
    if (item.status === 'success' && item.outputPaths && item.outputPaths.length > 0) {
        completedFilePaths = item.outputPaths;
        renderOutputFiles();
        appendLog(`📂 已从历史记录加载生成的文件列表（共 ${completedFilePaths.length} 个文件）`, 'success');
        switchMainTab('panel-logs');
    } else {
        completedFilePaths = [];
        renderOutputFiles();
        switchMainTab('panel-logs');
        appendLog(`⚠️ 该历史任务无成功的输出文件记录。`, 'info');
    }
}

// ─── 5. UI 交互验证与配置控制 ───────────────────────────────

function validateInputs() {
    const hasInput = selectedFilePaths.length > 0 || urlInput.value.trim() !== '';
    
    // 检查是否勾选了至少一个导出格式
    const formats = getSelectedFormats();
    const hasFormat = formats.length > 0;
    
    startBtn.disabled = !hasInput || !hasFormat || isTranscribing;
}

function getSelectedFormats() {
    const formats = [];
    if (fmtSrt.checked) formats.push('srt');
    if (fmtTxt.checked) formats.push('txt');
    if (fmtMd && fmtMd.checked) formats.push('md');
    if (fmtLrc.checked) formats.push('lrc');
    if (fmtJson.checked) formats.push('json');
    return formats;
}

// 选项卡切换
tabLocal.addEventListener('click', () => {
    tabLocal.classList.add('active');
    tabUrl.classList.remove('active');
    historyLocalList.classList.remove('hidden');
    historyUrlList.classList.add('hidden');
});

tabUrl.addEventListener('click', () => {
    tabUrl.classList.add('active');
    tabLocal.classList.remove('active');
    historyUrlList.classList.remove('hidden');
    historyLocalList.classList.add('hidden');
});

// URL 输入框与格式多选框的监听
urlInput.addEventListener('input', () => {
    if (urlInput.value.trim() !== '') {
        clearFile();
    }
    validateInputs();
});
[fmtSrt, fmtTxt, fmtMd, fmtLrc, fmtJson].forEach(checkbox => {
    if (checkbox) checkbox.addEventListener('change', validateInputs);
});

// 配置中心保存与事件绑定
if (settingsSave) {
    settingsSave.addEventListener('click', () => {
        saveConfig();
    });
}

function toggleLlmContainers(provider) {
    if (!llmCustomContainer || !llmCliContainer) return;
    if (provider === 'custom') {
        llmCustomContainer.classList.remove('hidden');
        llmCliContainer.classList.add('hidden');
    } else if (provider === 'cli') {
        llmCustomContainer.classList.add('hidden');
        llmCliContainer.classList.remove('hidden');
    } else {
        llmCustomContainer.classList.add('hidden');
        llmCliContainer.classList.add('hidden');
    }
}

if (modalLlmProvider) {
    modalLlmProvider.addEventListener('change', () => {
        toggleLlmContainers(modalLlmProvider.value);
    });
}

if (saveModeSame && saveModeCustom && outputDirInputContainer) {
    saveModeSame.addEventListener('change', () => {
        if (saveModeSame.checked) {
            outputDirInputContainer.classList.add('hidden');
        }
    });
    saveModeCustom.addEventListener('change', () => {
        if (saveModeCustom.checked) {
            outputDirInputContainer.classList.remove('hidden');
        }
    });
}

// 原生目录选择按钮绑定
btnBrowseOutput.addEventListener('click', () => browseDirectory('modal-output-dir'));
btnClearOutput.addEventListener('click', () => document.getElementById('modal-output-dir').value = '');
btnBrowseLog.addEventListener('click', () => browseDirectory('modal-log-dir'));
btnClearLog.addEventListener('click', () => document.getElementById('modal-log-dir').value = '');

// 本地多文件与目录选择按钮绑定
if (btnSelectFiles) {
    btnSelectFiles.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            const files = await invoke('select_multiple_files');
            if (files && files.length > 0) {
                addFiles(files);
            }
        } catch (err) {
            appendLog(`❌ 选择文件出错: ${err}`, 'error');
        }
    });
}
if (btnSelectFolder) {
    btnSelectFolder.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleSelectFolder();
    });
}

dropZone.addEventListener('click', async (e) => {
    if (e.target === dropZone || e.target.classList.contains('upload-text') || e.target.classList.contains('upload-icon') || e.target.classList.contains('upload-hint')) {
        try {
            const files = await invoke('select_multiple_files');
            if (files && files.length > 0) {
                addFiles(files);
            }
        } catch (err) {
            appendLog(`❌ 选择文件出错: ${err}`, 'error');
        }
    }
});

// ─── 6. 执行转写任务 ──────────────────────────────────────────

function getUrlFallbackName(url) {
    try {
        if (url.includes('bilibili.com') || url.includes('b23.tv')) {
            const bvMatch = url.match(/(BV[a-zA-Z0-9]{10})/);
            if (bvMatch) return bvMatch[1];
        }
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const regV = /[?&]v=([^&#]*)/;
            const matchV = url.match(regV);
            if (matchV && matchV[1]) return matchV[1];
            
            const parts = url.split('?')[0].split('/').filter(p => p);
            if (parts.length > 0) return parts[parts.length - 1];
        }
        const parts = url.split('?')[0].split('/').filter(p => p);
        if (parts.length > 0) {
            const last = parts[parts.length - 1];
            const clean = last.replace(/[\\/:*?"<>|]/g, '');
            if (clean) return clean;
        }
    } catch (e) {
        // ignore
    }
    return 'online_video';
}

function runSingleTask(input, type, engine, formats, noSubtitle, taskIndex, totalTasks) {
    return new Promise(async (resolve, reject) => {
        currentTaskResolver = resolve;
        currentTaskRejecter = reject;

        appendLog(`\n──────────────────────────────────────────────────`, 'info');
        appendLog(`[${taskIndex + 1}/${totalTasks}] 正在处理: ${input}`, 'info');
        updateProgress(5, `[${taskIndex + 1}/${totalTasks}] 正在初始化当前任务...`);

        let outputBasePath = '';
        const firstFormat = formats.split(',')[0];

        if (type === 'local') {
            const baseName = input.split(/[/\\]/).pop();
            const dotIndex = baseName.lastIndexOf('.');
            const fileName = dotIndex !== -1 ? baseName.substring(0, dotIndex) : baseName;
            currentTaskTitle = fileName;
            
            if (appConfig.saveMode === 'custom' && appConfig.outputDir) {
                outputBasePath = `${appConfig.outputDir}\\${fileName}.${firstFormat}`;
            } else {
                const lastSlash = Math.max(input.lastIndexOf('\\'), input.lastIndexOf('/'));
                const dirPath = lastSlash !== -1 ? input.substring(0, lastSlash + 1) : '';
                outputBasePath = dirPath + fileName + '.' + firstFormat;
            }
        } else {
            const fallbackName = getUrlFallbackName(input);
            currentTaskTitle = fallbackName;
            
            if (appConfig.saveMode === 'custom' && appConfig.outputDir) {
                outputBasePath = `${appConfig.outputDir}\\${fallbackName}.${firstFormat}`;
            } else {
                outputBasePath = '';
            }
        }

        if (outputBasePath) {
            appendLog(`📂 导出基础路径: ${outputBasePath}`, 'info');
        } else {
            appendLog(`📂 在线链接将自动输出到软件 Outputs 文件夹下，并根据视频标题命名`, 'info');
        }

        let customUrl = appConfig.customUrl;
        let customKey = appConfig.customKey;
        let customModel = appConfig.customModel;

        if (engine === 'siliconflow-sensevoice') {
            customUrl = 'https://api.siliconflow.cn/v1/audio/transcriptions';
            customKey = appConfig.siliconflowKey;
            customModel = 'FunAudioLLM/SenseVoiceSmall';
            engine = 'custom';
        } else if (engine === 'siliconflow-whisper') {
            customUrl = 'https://api.siliconflow.cn/v1/audio/transcriptions';
            customKey = appConfig.siliconflowKey;
            customModel = 'openai/whisper-large-v3';
            engine = 'custom';
        }

        try {
            await invoke('start_transcription', {
                inputPath: input,
                engine: engine,
                outputPath: outputBasePath,
                geminiKey: appConfig.geminiKey,
                noSubtitle: noSubtitle,
                customApiUrl: customUrl,
                customApiKey: customKey,
                customModelName: customModel,
                proxyUrl: appConfig.proxyUrl,
                formats: formats,
                cookiesFromBrowser: appConfig.cookiesFromBrowser || 'none',
                llmProvider: appConfig.llmProvider || 'gemini',
                llmApiUrl: appConfig.llmProvider === 'cli' ? (appConfig.llmCliTemplate || '') : (appConfig.llmUrl || ''),
                llmApiKey: appConfig.llmProvider === 'cli' ? '' : (appConfig.llmKey || ''),
                llmModelName: appConfig.llmProvider === 'cli' ? '' : (appConfig.llmModel || '')
            });
            updateProgress(15, `[${taskIndex + 1}/${totalTasks}] 正在等待后台引擎就绪...`);
        } catch (err) {
            reject(err);
        }
    });
}

async function startTranscription() {
    if (isTranscribing) return;

    const queue = [];
    selectedFilePaths.forEach(file => {
        queue.push({ input: file, type: 'local' });
    });
    
    const urlVal = urlInput.value.trim();
    if (urlVal) {
        const lines = urlVal.split('\n').map(l => l.trim()).filter(l => l !== '');
        lines.forEach(line => {
            queue.push({ input: line, type: 'url' });
        });
    }

    if (queue.length === 0) {
        appendLog('❌ 请先选择本地音视频文件，或者输入在线视频链接。', 'error');
        return;
    }

    const engine = engineSelect.value;
    const formats = getSelectedFormats().join(',');
    const noSubtitle = skipSubCheckbox.checked;

    loadConfig();

    let customUrl = appConfig.customUrl;
    let customKey = appConfig.customKey;
    let customModel = appConfig.customModel;

    if (engine === 'siliconflow-sensevoice' || engine === 'siliconflow-whisper') {
        if (!appConfig.siliconflowKey) {
            appendLog('❌ 使用 硅基流动 引擎前，请前往 [配置中心] tab 配置 SiliconFlow API Key。', 'error');
            return;
        }
    }

    if (engine === 'gemini' && !appConfig.geminiKey) {
        appendLog('❌ 使用 Gemini 引擎前，请前往 [配置中心] tab 配置 Gemini API Key。', 'error');
        return;
    }

    if (engine === 'custom' && !customUrl) {
        appendLog('❌ 使用自定义 ASR 引擎前，请前往 [配置中心] tab 配置 API Endpoint URL。', 'error');
        return;
    }

    isTranscribing = true;
    startBtn.disabled = true;
    completedFilePaths = [];
    currentTaskTitle = '';
    renderOutputFiles();

    switchMainTab('panel-logs');

    progressBarContainer.classList.remove('hidden');
    updateProgress(5, '正在初始化批量任务...');

    logBox.innerHTML = '';
    
    // 输出系统依赖和网络自检状态至日志区
    const hasPython = depPython.classList.contains('installed');
    const hasFfmpeg = depFfmpeg.classList.contains('installed');
    const biliOk = depBili.classList.contains('installed');
    const ytOk = depYoutube.classList.contains('installed');

    if (!hasPython) {
        appendLog('❌ 环境自检异常: 未检测到 Python 环境！请确认已正确安装并将其加入 PATH。', 'error');
    }
    if (!hasFfmpeg) {
        appendLog('⚠️ 环境自检警告: 未检测到 FFmpeg！音视频伴音提取与转码合并功能将无法使用。', 'warning');
    }
    if (!biliOk) {
        appendLog('⚠️ 网络自检提示: 无法访问哔哩哔哩链接，请检查您的网络连接。', 'warning');
    }
    if (!ytOk && appConfig.proxyUrl) {
        appendLog(`🌐 代理自检提示: YouTube 网络连接受限。当前已配置并启用网络代理: ${appConfig.proxyUrl}`, 'info');
    } else if (!ytOk) {
        appendLog('⚠️ 网络自检提示: YouTube 访问受限。若要转录海外视频，请前往 [配置中心] 设置代理。', 'warning');
    }

    appendLog(`🚀 启动批量转录任务 (共 ${queue.length} 个任务)...`, 'info');
    appendLog(`👉 ASR 引擎: ${engine}`, 'info');
    appendLog(`👉 导出格式: ${formats}`, 'info');

    let successCount = 0;
    for (let i = 0; i < queue.length; i++) {
        const task = queue[i];
        try {
            await runSingleTask(task.input, task.type, engine, formats, noSubtitle, i, queue.length);
            successCount++;
            addHistoryRecord(task.type, task.input, engineSelect.value, formats, 'success', completedFilePaths);
        } catch (err) {
            appendLog(`❌ 任务 [${i + 1}/${queue.length}] 失败: ${err}`, 'error');
            addHistoryRecord(task.type, task.input, engineSelect.value, formats, 'failed', []);
        }
    }

    updateProgress(100, `批量任务全部完成！(成功: ${successCount}/${queue.length})`);
    appendLog(`\n🎉 批量转录任务已全部结束！成功: ${successCount}，失败: ${queue.length - successCount}。`, 'success');
    
    selectedFilePaths = [];
    updateSelectedFilesUI();
    urlInput.value = '';

    resetUI();
}

// ─── 7. Tauri 进程日志与状态监听 ─────────────────────────────

const CRITICAL_KEYWORDS = [
    '正在', '成功', '失败', '完成', '文件已保存', 
    '识别中', 'Downloading', '提取音频', '下载音频', 
    '转录中', 'ASR', '启动', '识别为', '标题:', 
    '格式转换', '音频下载', '已选择', '读取', '加载'
];

function isCriticalLog(line) {
    if (line.includes('[调试]') || line.includes('Traceback') || line.includes('Exception') || line.includes('Error') || line.includes('RuntimeError') || line.includes('失败')) {
        return true;
    }
    return CRITICAL_KEYWORDS.some(keyword => line.includes(keyword));
}

listen('transcribe-log', (event) => {
    const line = event.payload;
    
    // 分析日志更新进度条
    if (line.includes('下载音频中')) {
        updateProgress(35, '正在下载在线视频音频中...');
    } else if (line.includes('提取音频中')) {
        updateProgress(45, '正在从本地视频提取音频伴音...');
    } else if (line.includes('转录中') || line.includes('转录中')) {
        updateProgress(65, '音频提取完毕，正在云端进行识别 (可能需要几分钟)...');
    } else if (line.includes('转录完成') || line.includes('识别成功')) {
        updateProgress(85, '语音分析成功，正在生成导出文件...');
    }
    
    // 捕获生成的所有导出文件路径
    if (line.includes('文件已保存：')) {
        const filePath = line.split('文件已保存：')[1].trim();
        if (!completedFilePaths.includes(filePath)) {
            completedFilePaths.push(filePath);
            renderOutputFiles(); // 实时展示生成的文件卡片
        }
    }

    // 捕获网页标题
    if (line.includes('📄 视频标题:')) {
        currentTaskTitle = line.split('📄 视频标题:')[1].trim();
    }

    // 过滤精简日志，避免杂乱
    if (!isCriticalLog(line)) {
        return;
    }

    // 区分日志级别
    let type = 'default';
    if (line.includes('✅') || line.includes('成功')) type = 'success';
    else if (line.includes('❌') || line.includes('失败') || line.includes('错误')) type = 'error';
    else if (line.includes('⚠️') || line.includes('警告') || line.includes('等待')) type = 'info';

    appendLog(line, type);
});

listen('transcribe-success', async (event) => {
    updateProgress(100, '当前任务成功完成！');

    if (currentTaskResolver) {
        currentTaskResolver(event.payload);
        currentTaskResolver = null;
        currentTaskRejecter = null;
    }
});

listen('transcribe-error', (event) => {
    updateProgress(0, '当前任务失败');
    appendLog(`❌ 当前任务失败: ${event.payload}`, 'error');

    if (currentTaskRejecter) {
        currentTaskRejecter(event.payload);
        currentTaskResolver = null;
        currentTaskRejecter = null;
    }
});

// ─── 8. 辅助实用函数 ──────────────────────────────────────────

function appendLog(message, type = 'default') {
    const item = document.createElement('div');
    item.className = `log-item ${type}`;
    item.textContent = message;
    
    const placeholder = logBox.querySelector('.log-placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    logBox.appendChild(item);
    logBox.scrollTop = logBox.scrollHeight;
}

function updateProgress(percent, status) {
    statusText.textContent = status;
    progressPercent.textContent = `${percent}%`;
    progressFill.style.width = `${percent}%`;
}

function resetUI() {
    isTranscribing = false;
    validateInputs();
}

// ─── 9. 初始化 ────────────────────────────────────────────────

// 双击环境依赖栏强制清除缓存并重新检测
const depChecker = document.getElementById('dep-checker');
if (depChecker) {
    depChecker.addEventListener('dblclick', () => {
        localStorage.removeItem('video2txt_dep_checked');
        appendLog('🔄 正在强制重新检测环境依赖...', 'info');
        checkDependencies();
    });
}

// 🌓 Theme toggle
const themeToggleBtn = document.getElementById('theme-toggle-btn');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
        const newTheme = appConfig.theme === 'dark' ? 'light' : 'dark';
        appConfig.theme = newTheme;
        localStorage.setItem('video2txt_config', JSON.stringify(appConfig));
        applyThemeAndFont(appConfig.theme, appConfig.fontSize);
        
        // Update modal select too
        const modalThemeSelect = document.getElementById('modal-theme-select');
        if (modalThemeSelect) {
            modalThemeSelect.value = newTheme;
        }
        appendLog(`🌓 已快速切换为 ${newTheme === 'dark' ? '🌙 深色' : '☀️ 浅色'} 主题模式`, 'success');
    });
}

// Render dynamic file cards
function renderOutputFiles() {
    const listContainer = document.getElementById('output-files-list');
    if (!listContainer) return;
    
    if (!completedFilePaths || completedFilePaths.length === 0) {
        listContainer.innerHTML = `
            <div class="output-placeholder-card">
                <div class="placeholder-icon">📄</div>
                <p>暂无输出文件</p>
                <span class="placeholder-tip">开始并完成转录任务后，这里会直接呈现结果文件链接，可一键打开或定位。</span>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = completedFilePaths.map(filePath => {
        const fileName = filePath.split(/[/\\]/).pop();
        const ext = fileName.split('.').pop().toUpperCase();
        const escapedPath = filePath.replace(/"/g, '&quot;');
        return `
            <div class="output-file-card">
                <div class="output-file-card-header">
                    <span class="output-file-card-type">${ext}</span>
                    <span class="output-file-card-name" title="${filePath}" data-path="${escapedPath}">${fileName}</span>
                </div>
                <div class="output-file-card-actions">
                    <button class="btn-file-open" data-path="${escapedPath}">预览</button>
                    <button class="btn-file-open-sys" data-path="${escapedPath}">💻 默认软件打开</button>
                    <button class="btn-file-folder" data-path="${escapedPath}">定位文件夹</button>
                </div>
            </div>
        `;
    }).join('');
}

// 事件代理绑定
const outputFilesList = document.getElementById('output-files-list');
if (outputFilesList) {
    outputFilesList.addEventListener('click', (e) => {
        const btnOpen = e.target.closest('.btn-file-open');
        const nameEl = e.target.closest('.output-file-card-name');
        const btnOpenSys = e.target.closest('.btn-file-open-sys');
        const btnFolder = e.target.closest('.btn-file-folder');
        
        if (btnOpen || nameEl) {
            const target = btnOpen || nameEl;
            const filePath = target.getAttribute('data-path');
            if (filePath) {
                window.previewFile(filePath);
            }
        } else if (btnOpenSys) {
            const filePath = btnOpenSys.getAttribute('data-path');
            if (filePath) {
                window.openFile(filePath);
            }
        } else if (btnFolder) {
            const filePath = btnFolder.getAttribute('data-path');
            if (filePath) {
                window.showInFolder(filePath);
            }
        }
    });
}

window.openFile = async function(path) {
    try {
        await invoke('open_file', { path });
        appendLog(`📂 正在打开文件: ${path.split(/[/\\]/).pop()}`, 'success');
    } catch (e) {
        appendLog(`❌ 打开文件失败: ${e}`, 'error');
    }
};

window.showInFolder = async function(path) {
    try {
        await invoke('show_in_folder', { path });
        appendLog(`📂 已在资源管理器中定位并选中文件: ${path.split(/[/\\]/).pop()}`, 'success');
    } catch (e) {
        appendLog(`❌ 定位文件失败: ${e}`, 'error');
    }
};

// 绑定主转录按钮与其他控件
startBtn.addEventListener('click', startTranscription);
clearLogsBtn.addEventListener('click', () => logBox.innerHTML = '');
clearHistoryBtn.addEventListener('click', clearHistory);

// ─── B站 扫码登录逻辑 ──────────────────────────────────────────

let biliPollInterval = null;

async function checkBiliStatus() {
    if (!biliLoginStatus) return;
    biliLoginStatus.textContent = '正在检测 B站 登录状态...';
    biliLoginStatus.style.color = 'var(--text-secondary)';
    
    try {
        const resStr = await invoke('run_bili_login', { cmd: 'status', arg: '' });
        const res = JSON.parse(resStr);
        if (res.status === 'logged_in') {
            biliLoginStatus.textContent = `已登录: ${res.uname}`;
            biliLoginStatus.style.color = 'var(--success-color)';
            btnBiliLogout.classList.remove('hidden');
            btnBiliLoginTrigger.classList.add('hidden');
            biliQrcodeWrapper.classList.add('hidden');
        } else {
            biliLoginStatus.textContent = res.status === 'expired' ? 'B站登录已过期，请重新登录' : '未登录 B站 账号';
            biliLoginStatus.style.color = 'var(--text-muted)';
            btnBiliLogout.classList.add('hidden');
            btnBiliLoginTrigger.classList.remove('hidden');
            biliQrcodeWrapper.classList.add('hidden');
        }
    } catch (err) {
        biliLoginStatus.textContent = '检测登录状态失败';
        biliLoginStatus.style.color = 'var(--error-color)';
        console.error('Check B站 status error:', err);
    }
}

async function triggerBiliLogin() {
    if (biliPollInterval) clearInterval(biliPollInterval);
    biliQrcodeHint.textContent = '正在生成二维码...';
    biliQrcodeWrapper.classList.remove('hidden');
    btnBiliLoginTrigger.classList.add('hidden');
    
    try {
        const resStr = await invoke('run_bili_login', { cmd: 'generate', arg: '' });
        const res = JSON.parse(resStr);
        
        if (res.code === 0 && res.data && res.data.url) {
            const url = res.data.url;
            const qrcodeKey = res.data.qrcode_key;
            
            // 使用公共 API 生成二维码图片
            biliQrcodeImg.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}" alt="B站登录二维码" style="width:150px; height:150px;" />`;
            biliQrcodeHint.textContent = '请打开手机哔哩哔哩 App 扫码登录';
            
            // 开始轮询扫码状态
            biliPollInterval = setInterval(async () => {
                // 如果设置弹窗被关闭了，立刻停止轮询
                if (settingsModal.classList.contains('hidden')) {
                    clearInterval(biliPollInterval);
                    biliPollInterval = null;
                    return;
                }
                
                try {
                    const pollStr = await invoke('run_bili_login', { cmd: 'poll', arg: qrcodeKey });
                    const pollRes = JSON.parse(pollStr);
                    
                    if (pollRes.code === 0 && pollRes.data) {
                        const status = pollRes.data.code;
                        if (status === 0) {
                            // 登录成功
                            clearInterval(biliPollInterval);
                            biliPollInterval = null;
                            biliQrcodeWrapper.classList.add('hidden');
                            appendLog('🎉 B站 账号扫码登录成功！', 'success');
                            checkBiliStatus();
                        } else if (status === 86038) {
                            // 二维码过期
                            clearInterval(biliPollInterval);
                            biliPollInterval = null;
                            biliQrcodeHint.textContent = '二维码已过期，请重新点击登录';
                            btnBiliLoginTrigger.classList.remove('hidden');
                        } else if (status === 86090) {
                            biliQrcodeHint.textContent = '扫码成功，请在手机端确认登录';
                        }
                    }
                } catch (err) {
                    console.error('Polling B站 QR status error:', err);
                }
            }, 2000);
            
        } else {
            biliQrcodeHint.textContent = '生成二维码失败，请重试';
            btnBiliLoginTrigger.classList.remove('hidden');
            biliQrcodeWrapper.classList.add('hidden');
        }
    } catch (err) {
        biliQrcodeHint.textContent = `生成失败: ${err}`;
        btnBiliLoginTrigger.classList.remove('hidden');
        console.error('Trigger B站 login error:', err);
    }
}

async function logoutBili() {
    if (confirm('确定要退出 B站 账号登录吗？')) {
        try {
            await invoke('run_bili_login', { cmd: 'logout', arg: '' });
            appendLog('👋 已成功退出 B站 登录状态，相关 Cookie 已清空。', 'info');
            checkBiliStatus();
        } catch (err) {
            appendLog(`❌ 退出登录失败: ${err}`, 'error');
        }
    }
}

async function checkNetwork() {
    if (!depBili || !depYoutube) return;
    depBili.textContent = 'B站检测中...';
    depBili.className = 'dep-status loading';
    depYoutube.textContent = 'YouTube检测中...';
    depYoutube.className = 'dep-status loading';

    try {
        const status = await invoke('check_network', { proxyUrl: appConfig.proxyUrl || '' });
        if (status.bili_ok) {
            depBili.textContent = 'B站: 连通';
            depBili.className = 'dep-status installed';
        } else {
            depBili.textContent = 'B站: 失败';
            depBili.className = 'dep-status missing';
        }

        if (status.yt_ok) {
            depYoutube.textContent = 'YouTube: 连通';
            depYoutube.className = 'dep-status installed';
        } else {
            depYoutube.textContent = 'YouTube: 阻断';
            depYoutube.className = 'dep-status missing';
        }
    } catch (err) {
        console.error('Network check error:', err);
        depBili.textContent = 'B站检测失败';
        depBili.className = 'dep-status missing';
        depYoutube.textContent = 'YouTube检测失败';
        depYoutube.className = 'dep-status missing';
    }
}

if (btnBiliLoginTrigger) btnBiliLoginTrigger.addEventListener('click', triggerBiliLogin);
if (btnBiliLogout) btnBiliLogout.addEventListener('click', logoutBili);

// 初始化加载
loadConfig();
checkBiliStatus();
renderHistory();
checkDependencies();
checkNetwork(); // 新增启动网络检测
window.__TAURI__.event.listen = listen; // 为全局拖放挂载
window.__TAURI__.core.invoke = invoke;

// ─── 10. 文件预览器功能 ────────────────────────────────────────

let currentPreviewPath = '';
let currentPreviewFontSize = 14;

// 简易 Markdown 解析器 (支持作为 Marked CDN 失败时的备用方案)
function simpleMarkdown(md) {
    if (window.marked && window.marked.parse) {
        try {
            return window.marked.parse(md);
        } catch (e) {
            console.error('marked parsing error, falling back', e);
        }
    }
    
    // 简易 Regex 备用解析
    let html = md
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // 标题
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    
    // 粗体
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // 列表项
    html = html.replace(/^\- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    
    // 引用块
    html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');
    
    // 段落与换行
    html = html.replace(/\n\n/g, '<p></p>');
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

window.previewFile = async function(filePath) {
    try {
        currentPreviewPath = filePath;
        const fileName = filePath.split(/[/\\]/).pop();
        
        // 显示预览面板
        const previewer = document.getElementById('file-previewer');
        if (previewer) {
            previewer.classList.remove('hidden');
        }
        
        // 设置标题
        const titleEl = document.getElementById('previewer-filename');
        if (titleEl) {
            titleEl.textContent = fileName;
            titleEl.title = filePath;
        }
        
        // 读取文本内容
        const content = await invoke('read_text_file', { path: filePath });
        const contentBody = document.getElementById('previewer-content');
        
        if (contentBody) {
            const ext = fileName.split('.').pop().toLowerCase();
            if (ext === 'md' || ext === 'markdown') {
                contentBody.innerHTML = simpleMarkdown(content);
            } else {
                // 纯文本展示
                const pre = document.createElement('pre');
                pre.style.whiteSpace = 'pre-wrap';
                pre.style.fontFamily = 'inherit';
                pre.style.margin = '0';
                pre.textContent = content;
                contentBody.innerHTML = '';
                contentBody.appendChild(pre);
            }
            // 确保字号同步
            contentBody.style.fontSize = `${currentPreviewFontSize}px`;
        }
        
        appendLog(`📂 已载入预览文件: ${fileName}`, 'success');
    } catch (e) {
        appendLog(`❌ 预览文件加载失败: ${e}`, 'error');
    }
};

// 绑定预览面板工具栏按钮事件
document.addEventListener('DOMContentLoaded', () => {
    const btnClose = document.getElementById('previewer-close-btn');
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            document.getElementById('file-previewer').classList.add('hidden');
        });
    }

    const btnSysOpen = document.getElementById('previewer-system-open-btn');
    if (btnSysOpen) {
        btnSysOpen.addEventListener('click', async () => {
            if (currentPreviewPath) {
                window.openFile(currentPreviewPath);
            }
        });
    }

    const btnFontDec = document.getElementById('previewer-font-dec');
    const btnFontInc = document.getElementById('previewer-font-inc');
    const fontSizeText = document.getElementById('previewer-font-size-text');
    const contentBody = document.getElementById('previewer-content');

    if (btnFontDec) {
        btnFontDec.addEventListener('click', () => {
            currentPreviewFontSize = Math.max(12, currentPreviewFontSize - 1);
            if (fontSizeText) fontSizeText.textContent = `${currentPreviewFontSize}px`;
            if (contentBody) contentBody.style.fontSize = `${currentPreviewFontSize}px`;
        });
    }

    if (btnFontInc) {
        btnFontInc.addEventListener('click', () => {
            currentPreviewFontSize = Math.min(24, currentPreviewFontSize + 1);
            if (fontSizeText) fontSizeText.textContent = `${currentPreviewFontSize}px`;
            if (contentBody) contentBody.style.fontSize = `${currentPreviewFontSize}px`;
        });
    }

    // 绑定清空文件按钮
    if (clearFileBtn) {
        clearFileBtn.addEventListener('click', clearFile);
    }
});

// ─── 11. 自定义标题栏与操作系统特性 ─────────────────────────────────

// 1. 操作系统检测
const isMac = navigator.userAgent.toLowerCase().includes('mac');
if (isMac) {
    document.body.classList.add('os-macos');
} else {
    document.body.classList.add('os-windows');
}

// 2. 绑定标题栏按钮事件
const appWindow = window.__TAURI__.window.getCurrentWindow();
appWindow.setDecorations(false).catch(err => console.error("Failed to remove window decorations:", err));

document.getElementById('win-min')?.addEventListener('click', () => appWindow.minimize());
document.getElementById('win-max')?.addEventListener('click', async () => {
    if (await appWindow.isMaximized()) {
        appWindow.unmaximize();
    } else {
        appWindow.maximize();
    }
});
document.getElementById('win-close')?.addEventListener('click', () => appWindow.close());

document.getElementById('mac-min')?.addEventListener('click', () => appWindow.minimize());
document.getElementById('mac-max')?.addEventListener('click', async () => {
    if (await appWindow.isMaximized()) {
        appWindow.unmaximize();
    } else {
        appWindow.maximize();
    }
});
document.getElementById('mac-close')?.addEventListener('click', () => appWindow.close());

// 3. 彻底清除网页特征 (右键菜单、触控板缩放、键盘缩放、网页拖拽打开)
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '=' || e.key === '-' || e.key === '+' || e.key === '0')) {
        e.preventDefault();
    }
});

// 防止默认的拖动打开文件行为
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});
document.addEventListener('drop', (e) => {
    e.preventDefault();
});

