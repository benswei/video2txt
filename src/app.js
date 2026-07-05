// Destructure Tauri APIs from global injection
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ─── 运行状态变量 ──────────────────────────────────────────
let selectedFilePaths = [];       // 本地转写音视频文件列表
let selectedMdFilePaths = [];     // 优化转Markdown文档文件列表
let isTranscribing = false;       // 是否正在执行任务
let completedFilePaths = [];      // 成功输出的文件路径列表
let currentTaskTitle = '';        // 当前处理中的任务标题
let currentTaskResolver = null;   // 当前运行任务的 Promise resolver
let currentTaskRejecter = null;   // 当前运行任务的 Promise rejecter
let currentPreviewPath = '';      // 当前预览中的文件路径
let currentPreviewFontSize = 14;  // 当前预览字体大小

// ─── 提示词模板默认值 ────────────────────────────────────────
const DEFAULT_TEMPLATES = [
    {
        id: "tpl_1",
        title: "网课直播",
        content: "请将以下音视频转文字的文本整理为清晰、逻辑结构完整的网课笔记。去掉口水话、语气词、重复句，按照课程的逻辑顺序提炼出大纲、重点概念、核心结论和公式，尽量保留重要的细节与专业术语。不需要进行大幅压缩或精简，重点是提升文档逻辑性、清晰度与可读性。"
    },
    {
        id: "tpl_2",
        title: "专业课程",
        content: "你是一个专业学术课程助教。请将此段课程录音文本整理为逻辑严密的专业课学习指南。去除冗余词汇，修正语音识别错误，提取核心理论、推导过程、关键定义，并以学术化、结构化的Markdown排版。注意保留全部专业论述，去掉各类口头禅与语气词。"
    },
    {
        id: "tpl_3",
        title: "会议深度挖掘",
        content: "请深度整理以下会议录音文本。过滤口水话，按照议程、发言人主要观点、讨论争论焦点、做出的决策、待办行动项（Action Items）以及负责人进行结构化梳理，提炼为一份专业、干练的会议纪要。务必保证论点与事实的完整对应。"
    },
    {
        id: "tpl_4",
        title: "2人沟通",
        content: "这是两个人之间的对话/访谈文本。请去除无意义的语气词、重复和寒暄，将其整理成易读的访谈对话记录或对话纪要。保留双方的核心观点与沟通脉络，用清晰的对话排版呈现。剔除全部口语化、口水话词汇。"
    },
    {
        id: "tpl_5",
        title: "干货提炼",
        content: "请将以下文本中所有废话和背景寒暄删去，保留百分之百的知识与实用干货。以结构化的段落、清晰的要点列表，提炼出其中的方法论、实操步骤、核心原则或技巧。不需要过度压缩内容深度，只需将多余的修饰性口语全部滤除。"
    },
    {
        id: "tpl_6",
        title: "系列课程",
        content: "这是一个系列课程/文稿的一部分。请根据整体系列课程的宏观框架，将本节文本整理成高逻辑性的Wiki知识库文档，保持概念的一致性与体系化。重点突出前后课程的关联、本节核心要点，符合知识库（Wiki）规范，以便于检索和下一步AI调用。去除所有口语词汇与低逻辑的句子。"
    }
];

// ─── 提示词模板管理逻辑 ─────────────────────────────────────
let promptTemplates = [];
let currentEditingTemplateId = null;

function loadTemplates() {
    const saved = localStorage.getItem('video2txt_prompt_templates');
    if (saved) {
        try {
            promptTemplates = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse templates, fallback to default:', e);
            promptTemplates = [...DEFAULT_TEMPLATES];
        }
    } else {
        promptTemplates = [...DEFAULT_TEMPLATES];
        localStorage.setItem('video2txt_prompt_templates', JSON.stringify(promptTemplates));
    }
    renderTemplateSelects();
    renderTemplateManagerList();
}

function saveTemplates() {
    localStorage.setItem('video2txt_prompt_templates', JSON.stringify(promptTemplates));
    renderTemplateSelects();
    renderTemplateManagerList();
}

function renderTemplateSelects() {
    const select = document.getElementById('md-template-select');
    if (!select) return;
    
    select.innerHTML = promptTemplates.map(t => {
        return `<option value="${t.id}">${t.title}</option>`;
    }).join('');
}

function renderTemplateManagerList() {
    const listContainer = document.getElementById('settings-template-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = promptTemplates.map(t => {
        const activeClass = currentEditingTemplateId === t.id ? 'active' : '';
        return `<button type="button" class="template-item ${activeClass}" data-id="${t.id}">${t.title}</button>`;
    }).join('');
    
    // Bind click events to list items
    const btns = listContainer.querySelectorAll('.template-item');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            loadTemplateToEditor(id);
        });
    });
}

function loadTemplateToEditor(id) {
    currentEditingTemplateId = id;
    const template = promptTemplates.find(t => t.id === id);
    const titleInput = document.getElementById('editor-template-title');
    const contentText = document.getElementById('editor-template-content');
    
    if (template) {
        titleInput.value = template.title;
        contentText.value = template.content;
    } else {
        titleInput.value = '';
        contentText.value = '';
    }
    
    // Refresh selection styling in list
    renderTemplateManagerList();
}

function setupTemplateEditorEvents() {
    const btnAdd = document.getElementById('btn-add-template');
    const btnDelete = document.getElementById('btn-delete-template');
    const btnSave = document.getElementById('btn-save-template');
    
    const titleInput = document.getElementById('editor-template-title');
    const contentText = document.getElementById('editor-template-content');
    
    btnAdd?.addEventListener('click', () => {
        currentEditingTemplateId = "tpl_" + Date.now();
        titleInput.value = '新模板';
        contentText.value = '请输入系统提示词...';
        // Add temporary template so it shows in list
        promptTemplates.push({
            id: currentEditingTemplateId,
            title: titleInput.value,
            content: contentText.value
        });
        saveTemplates();
        loadTemplateToEditor(currentEditingTemplateId);
    });
    
    btnDelete?.addEventListener('click', () => {
        if (!currentEditingTemplateId) return;
        promptTemplates = promptTemplates.filter(t => t.id !== currentEditingTemplateId);
        saveTemplates();
        currentEditingTemplateId = promptTemplates.length > 0 ? promptTemplates[0].id : null;
        loadTemplateToEditor(currentEditingTemplateId);
    });
    
    btnSave?.addEventListener('click', () => {
        if (!currentEditingTemplateId) return;
        const title = titleInput.value.trim();
        const content = contentText.value.trim();
        if (!title || !content) {
            alert('模板标题和内容不能为空！');
            return;
        }
        
        const template = promptTemplates.find(t => t.id === currentEditingTemplateId);
        if (template) {
            template.title = title;
            template.content = content;
        } else {
            promptTemplates.push({
                id: currentEditingTemplateId,
                title,
                content
            });
        }
        saveTemplates();
        alert('模板已成功保存！');
    });
}

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
    theme: 'light',
    fontSize: '14px',
    cookiesFromBrowser: 'none',
    ytCookiesRaw: ''
};

let appConfig = { ...DEFAULT_CONFIG };

function applyThemeAndFont(theme, fontSize) {
    if (theme === 'light') {
        document.body.classList.add('theme-light');
    } else {
        document.body.classList.remove('theme-light');
    }
    
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
    
    // Set settings inputs
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

    if (modalGeminiKey) modalGeminiKey.value = appConfig.geminiKey || '';
    if (modalSiliconFlowKey) modalSiliconFlowKey.value = appConfig.siliconflowKey || '';
    if (modalCustomUrl) modalCustomUrl.value = appConfig.customUrl || '';
    if (modalCustomKey) modalCustomKey.value = appConfig.customKey || '';
    if (modalCustomModel) modalCustomModel.value = appConfig.customModel || 'whisper-1';
    if (modalOutputDir) modalOutputDir.value = appConfig.outputDir || '';
    if (modalLogDir) modalLogDir.value = appConfig.logDir || '';
    if (modalKeepMedia) modalKeepMedia.checked = appConfig.keepMedia || false;
    if (modalProxyUrl) modalProxyUrl.value = appConfig.proxyUrl || '';
    if (modalCookiesFromBrowser) modalCookiesFromBrowser.value = appConfig.cookiesFromBrowser || 'none';
    if (modalYtCookiesRaw) modalYtCookiesRaw.value = appConfig.ytCookiesRaw || '';
    
    if (modalLlmProvider) modalLlmProvider.value = appConfig.llmProvider || 'gemini';
    if (modalLlmUrl) modalLlmUrl.value = appConfig.llmUrl || '';
    if (modalLlmKey) modalLlmKey.value = appConfig.llmKey || '';
    if (modalLlmModel) modalLlmModel.value = appConfig.llmModel || '';
    if (modalLlmCliTemplate) modalLlmCliTemplate.value = appConfig.llmCliTemplate || '';

    toggleLlmContainers(appConfig.llmProvider || 'gemini');
    
    const themeSelect = document.getElementById('modal-theme-select');
    const fontSelect = document.getElementById('modal-font-size-select');
    if (themeSelect) themeSelect.value = appConfig.theme;
    if (fontSelect) fontSelect.value = appConfig.fontSize;

    applyThemeAndFont(appConfig.theme, appConfig.fontSize);
}

function saveConfig() {
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

    if (modalGeminiKey) appConfig.geminiKey = modalGeminiKey.value.trim();
    if (modalSiliconFlowKey) appConfig.siliconflowKey = modalSiliconFlowKey.value.trim();
    if (modalCustomUrl) appConfig.customUrl = modalCustomUrl.value.trim();
    if (modalCustomKey) appConfig.customKey = modalCustomKey.value.trim();
    if (modalCustomModel) appConfig.customModel = modalCustomModel.value.trim() || 'whisper-1';
    if (modalOutputDir) appConfig.outputDir = modalOutputDir.value.trim();
    if (modalLogDir) appConfig.logDir = modalLogDir.value.trim();
    if (modalKeepMedia) appConfig.keepMedia = modalKeepMedia.checked;
    if (modalProxyUrl) appConfig.proxyUrl = modalProxyUrl.value.trim();
    if (modalCookiesFromBrowser) appConfig.cookiesFromBrowser = modalCookiesFromBrowser.value;
    if (modalYtCookiesRaw) appConfig.ytCookiesRaw = modalYtCookiesRaw.value;
    
    if (modalLlmProvider) appConfig.llmProvider = modalLlmProvider.value;
    if (modalLlmUrl) appConfig.llmUrl = modalLlmUrl.value.trim();
    if (modalLlmKey) appConfig.llmKey = modalLlmKey.value.trim();
    if (modalLlmModel) appConfig.llmModel = modalLlmModel.value.trim();
    if (modalLlmCliTemplate) appConfig.llmCliTemplate = modalLlmCliTemplate.value.trim();
    
    const themeSelect = document.getElementById('modal-theme-select');
    const fontSelect = document.getElementById('modal-font-size-select');
    if (themeSelect) appConfig.theme = themeSelect.value;
    if (fontSelect) appConfig.fontSize = fontSelect.value;

    localStorage.setItem('video2txt_config', JSON.stringify(appConfig));
    applyThemeAndFont(appConfig.theme, appConfig.fontSize);
    
    // Write youtube_cookies.txt
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
            appendLog(`⚠️ 写入 YouTube Cookies 失败: ${err}`, 'error');
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
    checkNetwork();
}

function toggleLlmContainers(provider) {
    const llmCustomContainer = document.getElementById('llm-custom-container');
    const llmCliContainer = document.getElementById('llm-cli-container');
    const llmCustomModelContainer = document.getElementById('llm-custom-model-container');
    
    if (!llmCustomContainer || !llmCliContainer) return;
    
    if (provider === 'custom') {
        llmCustomContainer.classList.remove('hidden');
        if (llmCustomModelContainer) llmCustomModelContainer.classList.remove('hidden');
        llmCliContainer.classList.add('hidden');
    } else if (provider === 'cli') {
        llmCustomContainer.classList.add('hidden');
        if (llmCustomModelContainer) llmCustomModelContainer.classList.add('hidden');
        llmCliContainer.classList.remove('hidden');
    } else {
        llmCustomContainer.classList.add('hidden');
        if (llmCustomModelContainer) llmCustomModelContainer.classList.add('hidden');
        llmCliContainer.classList.add('hidden');
    }
}

// ─── 2. 依赖检测 ─────────────────────────────────────────────
const depPython = document.getElementById('dep-python');
const depFfmpeg = document.getElementById('dep-ffmpeg');
const depBili = document.getElementById('dep-bili');
const depYoutube = document.getElementById('dep-youtube');

async function checkDependencies() {
    const btnGuide = document.getElementById('btn-dep-guide-trigger');
    const cached = localStorage.getItem('video2txt_dep_checked');
    if (cached) {
        try {
            const { hasPython, hasFfmpeg } = JSON.parse(cached);
            if (hasPython && hasFfmpeg) {
                depPython.textContent = 'Python 已安装';
                depPython.className = 'dep-status installed';
                depFfmpeg.textContent = 'FFmpeg 已安装';
                depFfmpeg.className = 'dep-status installed';
                btnGuide?.classList.add('hidden');
                validateAllInputs();
                return;
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
            appendLog('❌ 未找到 FFmpeg，音视频转码功能将不可用。', 'error');
        }

        if (!hasPython || !hasFfmpeg) {
            btnGuide?.classList.remove('hidden');
        } else {
            btnGuide?.classList.add('hidden');
        }

        if (hasPython) {
            validateAllInputs();
        } else {
            document.getElementById('start-online-btn').disabled = true;
            document.getElementById('start-local-btn').disabled = true;
            document.getElementById('start-md-btn').disabled = true;
            appendLog('⚠️ 基础依赖（Python）缺失，程序已被锁定。请修复后重启。', 'error');
        }

        if (hasPython && hasFfmpeg) {
            localStorage.setItem('video2txt_dep_checked', JSON.stringify({ hasPython, hasFfmpeg }));
        }
    } catch (err) {
        appendLog(`❌ 依赖检测出错: ${err}`, 'error');
    }
}

// ─── 3. 文件/目录选择与拖拽 ───────────────────────────────────

// Tab 2 (本地转写) 文件选择与拖拽
const selectedFileInfo = document.getElementById('selected-file-info');
const selectedFilesCount = document.getElementById('selected-files-count');
const selectedFilesList = document.getElementById('selected-files-list');

async function handleSelectLocalFiles() {
    if (isTranscribing) return;
    try {
        const files = await invoke('select_multiple_files');
        if (files && files.length > 0) {
            addLocalFiles(files);
        }
    } catch (err) {
        appendLog(`❌ 文件选择出错: ${err}`, 'error');
    }
}

async function handleSelectLocalFolder() {
    if (isTranscribing) return;
    try {
        const dir = await invoke('select_directory');
        if (dir) {
            appendLog(`📂 正在扫描文件夹: ${dir}...`, 'info');
            const expanded = await invoke('expand_paths', { paths: [dir] });
            if (expanded && expanded.length > 0) {
                addLocalFiles(expanded);
                appendLog(`✅ 文件夹扫描完毕，成功导入 ${expanded.length} 个音视频。`, 'success');
            } else {
                appendLog(`⚠️ 文件夹中未检测到支持的音视频格式文件。`, 'warning');
            }
        }
    } catch (err) {
        appendLog(`❌ 扫描文件夹出错: ${err}`, 'error');
    }
}

function addLocalFiles(files) {
    files.forEach(file => {
        if (!selectedFilePaths.includes(file)) {
            selectedFilePaths.push(file);
        }
    });
    updateLocalSelectedUI();
    validateAllInputs();
}

function updateLocalSelectedUI() {
    selectedFilesList.innerHTML = '';
    if (selectedFilePaths.length === 0) {
        selectedFileInfo.classList.add('hidden');
        selectedFilesCount.textContent = '已选择 0 个文件';
    } else {
        selectedFileInfo.classList.remove('hidden');
        selectedFilesCount.textContent = `已选择 ${selectedFilePaths.length} 个音视频文件`;
        
        selectedFilePaths.forEach((filePath, index) => {
            const fileName = filePath.split(/[/\\]/).pop();
            const pill = document.createElement('div');
            pill.className = 'file-item-pill';
            pill.innerHTML = `
                <span class="file-path-text" title="${filePath}">${fileName}</span>
                <button class="btn-remove-file" type="button">&times;</button>
            `;
            pill.querySelector('.btn-remove-file').addEventListener('click', (e) => {
                e.stopPropagation();
                selectedFilePaths.splice(index, 1);
                updateLocalSelectedUI();
                validateAllInputs();
            });
            selectedFilesList.appendChild(pill);
        });
    }
}

// Tab 3 (Markdown 优化) 文件选择与拖拽
const selectedMdFileInfo = document.getElementById('selected-md-file-info');
const selectedMdFilesCount = document.getElementById('selected-md-files-count');
const selectedMdFilesList = document.getElementById('selected-md-files-list');

async function handleSelectMdFiles() {
    if (isTranscribing) return;
    try {
        const files = await invoke('select_document_files');
        if (files && files.length > 0) {
            addMdFiles(files);
        }
    } catch (err) {
        appendLog(`❌ 选择文档文件出错: ${err}`, 'error');
    }
}

async function handleSelectMdFolder() {
    if (isTranscribing) return;
    try {
        const dir = await invoke('select_directory');
        if (dir) {
            appendLog(`📂 正在扫描文档目录: ${dir}...`, 'info');
            const expanded = await invoke('expand_document_paths', { paths: [dir] });
            if (expanded && expanded.length > 0) {
                addMdFiles(expanded);
                appendLog(`✅ 文件夹扫描完毕，成功导入 ${expanded.length} 个文本或PDF。`, 'success');
            } else {
                appendLog(`⚠️ 文件夹中未检测到 txt, srt, md, pdf 文档格式文件。`, 'warning');
            }
        }
    } catch (err) {
        appendLog(`❌ 扫描文件夹出错: ${err}`, 'error');
    }
}

function addMdFiles(files) {
    files.forEach(file => {
        if (!selectedMdFilePaths.includes(file)) {
            selectedMdFilePaths.push(file);
        }
    });
    updateMdSelectedUI();
    validateAllInputs();
}

function updateMdSelectedUI() {
    selectedMdFilesList.innerHTML = '';
    if (selectedMdFilePaths.length === 0) {
        selectedMdFileInfo.classList.add('hidden');
        selectedMdFilesCount.textContent = '已选择 0 个文件';
    } else {
        selectedMdFileInfo.classList.remove('hidden');
        selectedMdFilesCount.textContent = `已选择 ${selectedMdFilePaths.length} 个文档文件`;
        
        selectedMdFilePaths.forEach((filePath, index) => {
            const fileName = filePath.split(/[/\\]/).pop();
            const pill = document.createElement('div');
            pill.className = 'file-item-pill';
            pill.innerHTML = `
                <span class="file-path-text" title="${filePath}">${fileName}</span>
                <button class="btn-remove-file" type="button">&times;</button>
            `;
            pill.querySelector('.btn-remove-file').addEventListener('click', (e) => {
                e.stopPropagation();
                selectedMdFilePaths.splice(index, 1);
                updateMdSelectedUI();
                validateAllInputs();
            });
            selectedMdFilesList.appendChild(pill);
        });
    }
}

// 统一拖拽文件监听 (根据当前活跃 Tab 路由路径)
listen('tauri://drag-drop', async (event) => {
    if (isTranscribing) return;
    const paths = event.payload.paths;
    if (paths && paths.length > 0) {
        const activeTab = document.querySelector('.main-tab-btn.active');
        const targetId = activeTab ? activeTab.getAttribute('data-target') : '';
        
        try {
            if (targetId === 'panel-local-transcribe') {
                appendLog(`📂 正在解析拖入的音视频路径...`, 'info');
                const expanded = await invoke('expand_paths', { paths });
                if (expanded && expanded.length > 0) {
                    addLocalFiles(expanded);
                    appendLog(`✅ 成功拖入并导入 ${expanded.length} 个音视频。`, 'success');
                } else {
                    appendLog(`❌ 未能识别到任何支持的音视频格式文件。`, 'error');
                }
            } else if (targetId === 'panel-optimize-markdown') {
                appendLog(`📂 正在解析拖入的文档路径...`, 'info');
                const expanded = await invoke('expand_document_paths', { paths });
                if (expanded && expanded.length > 0) {
                    addMdFiles(expanded);
                    appendLog(`✅ 成功拖入并导入 ${expanded.length} 个文档。`, 'success');
                } else {
                    appendLog(`❌ 未能识别到任何支持的 txt, srt, md, pdf 格式。`, 'error');
                }
            }
        } catch (err) {
            appendLog(`❌ 解析拖入路径出错: ${err}`, 'error');
        }
    }
});

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
    localStorage.setItem(key, JSON.stringify(list.slice(0, 100)));
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

// Delete globally so elements can call it
window.deleteHistoryRecord = function(type, id, e) {
    if (e) e.stopPropagation();
    let list = getHistory(type);
    list = list.filter(item => item.id !== id);
    saveHistory(type, list);
    renderHistory();
};

function renderHistory() {
    const historyLocalList = document.getElementById('history-local-list');
    const historyUrlList = document.getElementById('history-url-list');
    
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
                    <button class="btn-history-del" onclick="window.deleteHistoryRecord('local', '${item.id}', event)">&times;</button>
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
                    <button class="btn-history-del" onclick="window.deleteHistoryRecord('url', '${item.id}', event)">&times;</button>
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

// 选中历史条目自动加载数据预览并打开任务进度面板呈现生成文件
async function loadHistoryItem(type, id) {
    const list = getHistory(type);
    const item = list.find(r => r.id === id);
    if (!item) return;

    if (type === 'local') {
        selectedFilePaths = [item.source];
        updateLocalSelectedUI();
    } else {
        const urlInput = document.getElementById('url-input');
        if (urlInput) urlInput.value = item.source;
        selectedFilePaths = [];
        updateLocalSelectedUI();
    }
    validateAllInputs();
    
    // Close history modal, expand progress sidebar
    document.getElementById('history-modal').classList.remove('active');
    const taskProgressPanel = document.getElementById('task-progress-panel');
    taskProgressPanel.classList.remove('collapsed');

    if (item.status === 'success' && item.outputPaths && item.outputPaths.length > 0) {
        completedFilePaths = item.outputPaths;
        renderOutputFiles();
        
        const checkpoints = document.getElementById('task-checkpoint-list');
        checkpoints.innerHTML = `
            <div style="color:var(--success-color); font-weight:600;">✨ 历史文件载入成功 (${item.date})</div>
            <div style="color:var(--text-secondary); font-size:10px;">${item.source}</div>
        `;
        
        document.getElementById('task-error-log-container').classList.add('hidden');
    } else {
        completedFilePaths = [];
        renderOutputFiles();
        
        const checkpoints = document.getElementById('task-checkpoint-list');
        checkpoints.innerHTML = `
            <div style="color:var(--error-color); font-weight:600;">❌ 该历史任务执行失败或未生成文件</div>
        `;
    }
}

// ─── 5. UI 交互验证与配置控制 ───────────────────────────────

function validateAllInputs() {
    // 1. 在线转文字验证
    const urlInput = document.getElementById('url-input');
    const onlineFormats = getSelectedFormats('online');
    const startOnlineBtn = document.getElementById('start-online-btn');
    if (startOnlineBtn && urlInput) {
        const hasUrl = urlInput.value.trim() !== '';
        startOnlineBtn.disabled = !hasUrl || onlineFormats.length === 0 || isTranscribing;
    }

    // 2. 本地转文字验证
    const localFormats = getSelectedFormats('local');
    const startLocalBtn = document.getElementById('start-local-btn');
    if (startLocalBtn) {
        const hasLocal = selectedFilePaths.length > 0;
        startLocalBtn.disabled = !hasLocal || localFormats.length === 0 || isTranscribing;
    }

    // 3. 优化转Markdown验证
    const startMdBtn = document.getElementById('start-md-btn');
    if (startMdBtn) {
        const hasMd = selectedMdFilePaths.length > 0;
        startMdBtn.disabled = !hasMd || isTranscribing;
    }
}

function getSelectedFormats(panelType) {
    const formats = [];
    if (panelType === 'online') {
        const checkboxed = document.querySelectorAll('.online-fmt:checked');
        checkboxed.forEach(cb => formats.push(cb.value));
    } else if (panelType === 'local') {
        const checkboxed = document.querySelectorAll('.local-fmt:checked');
        checkboxed.forEach(cb => formats.push(cb.value));
    }
    return formats;
}

// ─── 6. 执行转录/整理任务 (队列并发控制) ─────────────────────

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

function runSingleTask(input, type, engine, formats, noSubtitle, promptTemplate, taskIndex, totalTasks) {
    return new Promise(async (resolve, reject) => {
        currentTaskResolver = resolve;
        currentTaskRejecter = reject;

        appendLog(`\n──────────────────────────────────────────────────`, 'info');
        appendLog(`[${taskIndex + 1}/${totalTasks}] 正在处理: ${input}`, 'info');
        updateProgress(5, `[${taskIndex + 1}/${totalTasks}] 初始化任务...`);

        // Check if direct optimization for text file bypassing ASR
        const isDoc = input.endsWith('.txt') || input.endsWith('.srt') || input.endsWith('.md') || input.endsWith('.pdf');
        
        let outputBasePath = '';
        // If formats string is empty, fallback to 'md'
        const baseFmts = formats || 'md';
        const firstFormat = baseFmts.split(',')[0];

        if (isDoc || type === 'local') {
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
            appendLog(`📂 导出路径将自动存放在软件 Outputs 目录下`, 'info');
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
                formats: baseFmts,
                cookiesFromBrowser: appConfig.cookiesFromBrowser || 'none',
                llmProvider: appConfig.llmProvider || 'gemini',
                llmApiUrl: appConfig.llmProvider === 'cli' ? (appConfig.llmCliTemplate || '') : (appConfig.llmUrl || ''),
                llmApiKey: appConfig.llmProvider === 'cli' ? '' : (appConfig.llmKey || ''),
                llmModelName: appConfig.llmProvider === 'cli' ? '' : (appConfig.llmModel || ''),
                promptTemplate: promptTemplate
            });
            updateProgress(15, `[${taskIndex + 1}/${totalTasks}] 等待后台引擎就绪...`);
        } catch (err) {
            reject(err);
        }
    });
}

async function runBatchTasks(queue, engine, formats, noSubtitle, promptTemplate = '') {
    if (isTranscribing || queue.length === 0) return;
    
    loadConfig();
    
    // Validate engine keys
    if (engine === 'siliconflow-sensevoice' || engine === 'siliconflow-whisper') {
        if (!appConfig.siliconflowKey) {
            alert('⚠️ 使用 硅基流动 ASR 前，请在 [设置中心] 配置 SiliconFlow API Key！');
            return;
        }
    }
    if (engine === 'gemini' && !appConfig.geminiKey) {
        if (queue.some(q => q.input.endsWith('.txt') || q.input.endsWith('.srt') || q.input.endsWith('.md') || q.input.endsWith('.pdf'))) {
            // Document optimization uses LLM settings, not engine select directly
        } else {
            alert('⚠️ 使用 Gemini 引擎前，请在 [设置中心] 配置 Gemini API Key！');
            return;
        }
    }
    
    isTranscribing = true;
    validateAllInputs();
    
    completedFilePaths = [];
    currentTaskTitle = '';
    renderOutputFiles();
    
    // Expand right progress sidebar
    const taskProgressPanel = document.getElementById('task-progress-panel');
    taskProgressPanel.classList.remove('collapsed');
    
    // Clear and show progress
    const progressBarContainer = document.getElementById('progress-bar-container');
    progressBarContainer.classList.remove('hidden');
    updateProgress(0, '正在初始化批量任务...');
    
    const checkpoints = document.getElementById('task-checkpoint-list');
    checkpoints.innerHTML = `<div>⏳ 启动批量任务 (共 ${queue.length} 个)...</div>`;
    
    const logBox = document.getElementById('log-box');
    logBox.innerHTML = '';
    
    const errorContainer = document.getElementById('task-error-log-container');
    const errorLog = document.getElementById('task-error-log');
    errorContainer.classList.add('hidden');
    errorLog.textContent = '';
    
    // Check local dependencies
    const hasPython = depPython.classList.contains('installed');
    const hasFfmpeg = depFfmpeg.classList.contains('installed');
    if (!hasPython) {
        appendLog('❌ 环境自检异常: 未检测到 Python 环境！', 'error');
        addCheckpoint('❌ 失败: 缺失 Python 环境');
        isTranscribing = false;
        validateAllInputs();
        return;
    }
    
    let successCount = 0;
    for (let i = 0; i < queue.length; i++) {
        const task = queue[i];
        const taskName = task.input.split(/[/\\]/).pop();
        addCheckpoint(`⏳ [${i + 1}/${queue.length}] ${taskName} - 处理中...`);
        
        try {
            await runSingleTask(task.input, task.type, engine, formats, noSubtitle, promptTemplate, i, queue.length);
            successCount++;
            updateCheckpointStatus(i, `✅ [${i + 1}/${queue.length}] ${taskName} - 成功`);
            
            // Determine task type for history mapping
            const historyType = (task.type === 'url') ? 'url' : 'local';
            addHistoryRecord(historyType, task.input, engine, formats, 'success', [...completedFilePaths], taskName);
        } catch (err) {
            updateCheckpointStatus(i, `❌ [${i + 1}/${queue.length}] ${taskName} - 失败`);
            appendLog(`❌ 任务 [${i + 1}/${queue.length}] 失败: ${err}`, 'error');
            errorContainer.classList.remove('hidden');
            errorLog.textContent += `\n[任务 ${i + 1}] ${taskName} 错误原因:\n${err}\n`;
            
            const historyType = (task.type === 'url') ? 'url' : 'local';
            addHistoryRecord(historyType, task.input, engine, formats, 'failed', [], taskName);
        }
    }
    
    isTranscribing = false;
    validateAllInputs();
    updateProgress(100, `批量任务执行完成 (成功 ${successCount}/${queue.length})`);
    
    // Append done message to checkpoints
    const finalDiv = document.createElement('div');
    finalDiv.style.fontWeight = '600';
    finalDiv.style.marginTop = '8px';
    if (successCount === queue.length) {
        finalDiv.style.color = 'var(--success-color)';
        finalDiv.innerHTML = `✨ 批量处理全部完成！`;
    } else {
        finalDiv.style.color = 'var(--warning-color)';
        finalDiv.innerHTML = `⚠️ 批量处理部分完成 (${successCount} 成功, ${queue.length - successCount} 失败)`;
    }
    checkpoints.appendChild(finalDiv);
    checkpoints.scrollTop = checkpoints.scrollHeight;
}

// ─── 7. 进度面板辅助函数 ────────────────────────────────────

function addCheckpoint(message) {
    const list = document.getElementById('task-checkpoint-list');
    const placeholder = list.querySelector('.log-placeholder') || list.querySelector('div:only-child');
    if (placeholder && placeholder.textContent.includes('等待任务启动')) {
        list.innerHTML = '';
    }
    
    const div = document.createElement('div');
    div.className = 'checkpoint-item';
    div.style.padding = '3px 0';
    div.style.borderBottom = '1px solid rgba(255,255,255,0.02)';
    div.textContent = message;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
}

function updateCheckpointStatus(index, newMessage) {
    const list = document.getElementById('task-checkpoint-list');
    const items = list.querySelectorAll('.checkpoint-item');
    if (items && items[index + 1]) { // +1 because index 0 is general header
        items[index + 1].textContent = newMessage;
    } else if (items && items[index]) {
        items[index].textContent = newMessage;
    }
}

const CRITICAL_KEYWORDS = [
    'ASR', '转写', '提取', '合并', '优化', '整理', 'HTML', 'Markdown',
    '格式转换', '音频下载', '已选择', '读取', '加载'
];

function isCriticalLog(line) {
    if (line.includes('[调试]') || line.includes('Traceback') || line.includes('Exception') || line.includes('Error') || line.includes('RuntimeError') || line.includes('失败')) {
        return true;
    }
    return CRITICAL_KEYWORDS.some(keyword => line.includes(keyword));
}

// Listen to raw python outputs and populate stdout logs + trigger checkpoints
listen('transcribe-log', (event) => {
    const line = event.payload;
    
    // Append to raw debug logs modal always
    const logBox = document.getElementById('log-box');
    if (logBox) {
        const rawItem = document.createElement('div');
        rawItem.textContent = line;
        
        const placeholder = logBox.querySelector('.log-placeholder');
        if (placeholder) placeholder.remove();
        
        logBox.appendChild(rawItem);
        logBox.scrollTop = logBox.scrollHeight;
    }
    
    // Parse progress checkpoints for right sidebar
    if (line.includes('下载音频中')) {
        updateProgress(35, '正在下载在线视频音频中...');
    } else if (line.includes('提取音频中')) {
        updateProgress(45, '正在从本地视频提取音频伴音...');
    } else if (line.includes('转录中')) {
        updateProgress(65, '音视频提取完毕，正在云端进行识别...');
    } else if (line.includes('转录完成') || line.includes('识别成功')) {
        updateProgress(85, '语音分析成功，正在生成导出文件...');
    } else if (line.includes('优化完成') || line.includes('优化生成')) {
        updateProgress(90, '正在将 Markdown 文本渲染为 HTML 网页...');
    }
    
    // Capture generated output file paths
    if (line.includes('文件已保存：')) {
        const filePath = line.split('文件已保存：')[1].trim();
        if (!completedFilePaths.includes(filePath)) {
            completedFilePaths.push(filePath);
            renderOutputFiles();
            
            const fileName = filePath.split(/[/\\]/).pop();
            addCheckpoint(`📄 文件生成成功: ${fileName}`);
        }
    }

    if (line.includes('📄 视频标题:')) {
        currentTaskTitle = line.split('📄 视频标题:')[1].trim();
    }
    
    // Add critical checkpoints to status sidebar too
    if (isCriticalLog(line)) {
        let cleanLine = line;
        if (line.includes('[INFO]')) cleanLine = line.split('[INFO]')[1].trim();
        else if (line.includes('[ERROR]')) cleanLine = line.split('[ERROR]')[1].trim();
        addCheckpoint(`ℹ️ ${cleanLine}`);
    }
});

listen('transcribe-success', async (event) => {
    updateProgress(100, '任务成功完成！');
    if (currentTaskResolver) {
        currentTaskResolver(event.payload);
        currentTaskResolver = null;
        currentTaskRejecter = null;
    }
});

listen('transcribe-error', (event) => {
    updateProgress(0, '任务失败');
    if (currentTaskRejecter) {
        currentTaskRejecter(event.payload);
        currentTaskResolver = null;
        currentTaskRejecter = null;
    }
});

// ─── 8. 辅助实用函数 ──────────────────────────────────────────

function appendLog(message, type = 'default') {
    const logBox = document.getElementById('log-box');
    if (!logBox) return;
    
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
    const statusText = document.getElementById('status-text');
    const progressPercent = document.getElementById('progress-percent');
    const progressFill = document.getElementById('progress-fill');
    
    if (statusText) statusText.textContent = status;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressFill) progressFill.style.width = `${percent}%`;
}

// Render dynamic file cards inside right sidebar
function renderOutputFiles() {
    const listContainer = document.getElementById('output-files-list');
    if (!listContainer) return;
    
    if (!completedFilePaths || completedFilePaths.length === 0) {
        listContainer.innerHTML = `
            <div style="font-size: 10px; color: var(--text-muted); text-align: center; margin-top: 10px;">暂无生成文件</div>
        `;
        return;
    }
    
    listContainer.innerHTML = completedFilePaths.map(filePath => {
        const fileName = filePath.split(/[/\\]/).pop();
        const ext = fileName.split('.').pop().toUpperCase();
        const escapedPath = filePath.replace(/"/g, '&quot;');
        return `
            <div class="output-file-card" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border:1px solid var(--border-color); border-radius:6px; padding:6px; margin-bottom:4px; font-size:11px;">
                <div class="output-file-info" style="display:flex; flex-direction:column; overflow:hidden; flex:1; margin-right:8px;">
                    <span style="font-weight:600; color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">[${ext}] ${fileName}</span>
                </div>
                <div class="output-file-actions" style="display:flex; gap:4px;">
                    <button class="btn-file-open btn-secondary btn-sm" data-path="${escapedPath}" style="padding:2px 6px; font-size:10px; cursor:pointer;">预览</button>
                    <button class="btn-file-folder btn-secondary btn-sm" data-path="${escapedPath}" style="padding:2px 6px; font-size:10px; cursor:pointer;">📂</button>
                </div>
            </div>
        `;
    }).join('');
}

// Dynamic output list action delegates
document.getElementById('output-files-list')?.addEventListener('click', (e) => {
    const btnOpen = e.target.closest('.btn-file-open');
    const btnFolder = e.target.closest('.btn-file-folder');
    
    if (btnOpen) {
        const filePath = btnOpen.getAttribute('data-path');
        if (filePath) {
            window.previewFile(filePath);
        }
    } else if (btnFolder) {
        const filePath = btnFolder.getAttribute('data-path');
        if (filePath) {
            window.showInFolder(filePath);
        }
    }
});

window.openFile = async function(path) {
    try {
        await invoke('open_file', { path });
        appendLog(`📂 已使用默认应用打开: ${path.split(/[/\\]/).pop()}`, 'success');
    } catch (e) {
        appendLog(`❌ 打开文件失败: ${e}`, 'error');
    }
};

window.showInFolder = async function(path) {
    try {
        await invoke('show_in_folder', { path });
        appendLog(`📂 定位到文件夹: ${path.split(/[/\\]/).pop()}`, 'success');
    } catch (e) {
        appendLog(`❌ 定位文件失败: ${e}`, 'error');
    }
};

// ─── 9. B站 扫码登录与网络环境自检 ─────────────────────────────

let biliPollInterval = null;

async function checkBiliStatus() {
    try {
        const biliLoginStatus = document.getElementById('bili-login-status');
        const btnBiliLogout = document.getElementById('btn-bili-logout');
        
        const status = await invoke('run_bili_login', { action: 'check' });
        if (status && status.startsWith('SUCCESS:')) {
            const name = status.split('SUCCESS:')[1];
            if (biliLoginStatus) {
                biliLoginStatus.textContent = `已登录 B站 (用户: ${name})`;
                biliLoginStatus.style.color = 'var(--success-color)';
            }
            if (btnBiliLogout) btnBiliLogout.classList.remove('hidden');
        } else {
            if (biliLoginStatus) {
                biliLoginStatus.textContent = '未登录 (部分超高清视频转写可能受限)';
                biliLoginStatus.style.color = 'var(--text-muted)';
            }
            if (btnBiliLogout) btnBiliLogout.classList.add('hidden');
        }
    } catch (err) {
        console.error('Check Bili login failed:', err);
    }
}

async function triggerBiliLogin() {
    try {
        const biliQrcodeWrapper = document.getElementById('bili-qrcode-wrapper');
        const biliQrcodeImg = document.getElementById('bili-qrcode-img');
        const biliQrcodeHint = document.getElementById('bili-qrcode-hint');
        
        if (biliQrcodeWrapper) biliQrcodeWrapper.classList.remove('hidden');
        if (biliQrcodeHint) biliQrcodeHint.textContent = '正在获取登录二维码...';
        
        const qrUrl = await invoke('run_bili_login', { action: 'qrcode' });
        if (qrUrl.startsWith('ERROR:')) {
            if (biliQrcodeHint) biliQrcodeHint.textContent = `二维码获取失败: ${qrUrl}`;
            return;
        }
        
        if (biliQrcodeImg) biliQrcodeImg.src = qrUrl;
        if (biliQrcodeHint) biliQrcodeHint.textContent = '请打开手机哔哩哔哩客户端扫描上方二维码进行登录';
        
        if (biliPollInterval) clearInterval(biliPollInterval);
        
        biliPollInterval = setInterval(async () => {
            try {
                const pollRes = await invoke('run_bili_login', { action: 'poll' });
                if (pollRes === 'WAITING') {
                    // continue polling
                } else if (pollRes.startsWith('SUCCESS:')) {
                    clearInterval(biliPollInterval);
                    if (biliQrcodeWrapper) biliQrcodeWrapper.classList.add('hidden');
                    checkBiliStatus();
                    appendLog('🎉 哔哩哔哩扫码登录成功！', 'success');
                } else {
                    clearInterval(biliPollInterval);
                    if (biliQrcodeHint) biliQrcodeHint.textContent = `登录失效或过期: ${pollRes}`;
                }
            } catch (err) {
                clearInterval(biliPollInterval);
                console.error(err);
            }
        }, 3000);
    } catch (err) {
        console.error('Trigger Bili login failed:', err);
    }
}

async function logoutBili() {
    try {
        await invoke('run_bili_login', { action: 'logout' });
        checkBiliStatus();
        appendLog('🚪 哔哩哔哩已退出登录', 'info');
    } catch (err) {
        console.error(err);
    }
}

async function checkNetwork() {
    try {
        const [biliOk, ytOk] = await invoke('check_network', { proxyUrl: appConfig.proxyUrl || '' });
        
        if (biliOk) {
            depBili.textContent = 'B站连接正常';
            depBili.className = 'dep-status installed';
        } else {
            depBili.textContent = 'B站连接异常';
            depBili.className = 'dep-status missing';
        }
        
        if (ytOk) {
            depYoutube.textContent = 'YouTube连接正常';
            depYoutube.className = 'dep-status installed';
        } else {
            depYoutube.textContent = 'YouTube受限 (境外)';
            depYoutube.className = 'dep-status warning';
        }
    } catch (err) {
        console.error('Network check error:', err);
    }
}

// ─── 10. 文件预览与字号控制 ───────────────────────────────────

function simpleMarkdown(md) {
    if (window.marked && window.marked.parse) {
        try {
            return window.marked.parse(md);
        } catch (e) {
            console.error('marked parsing error, falling back', e);
        }
    }
    
    let html = md
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/\n\n/g, '<p></p>');
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

window.previewFile = async function(filePath) {
    try {
        currentPreviewPath = filePath;
        const fileName = filePath.split(/[/\\]/).pop();
        
        const previewer = document.getElementById('file-previewer');
        if (previewer) {
            previewer.classList.remove('hidden');
        }
        
        const titleEl = document.getElementById('previewer-filename');
        if (titleEl) {
            titleEl.textContent = fileName;
            titleEl.title = filePath;
        }
        
        const content = await invoke('read_text_file', { path: filePath });
        const contentBody = document.getElementById('previewer-content');
        
        if (contentBody) {
            const ext = fileName.split('.').pop().toLowerCase();
            if (ext === 'md' || ext === 'markdown') {
                contentBody.innerHTML = simpleMarkdown(content);
            } else {
                const pre = document.createElement('pre');
                pre.style.whiteSpace = 'pre-wrap';
                pre.style.fontFamily = 'inherit';
                pre.style.margin = '0';
                pre.textContent = content;
                contentBody.innerHTML = '';
                contentBody.appendChild(pre);
            }
            contentBody.style.fontSize = `${currentPreviewFontSize}px`;
        }
        
        appendLog(`📂 载入预览: ${fileName}`, 'success');
    } catch (e) {
        appendLog(`❌ 预览失败: ${e}`, 'error');
    }
};

// ─── 11. 初始化与 DOM 事件绑定 ─────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // 1. 初始化加载
    loadTemplates();
    loadConfig();
    checkDependencies();
    checkBiliStatus();
    checkNetwork();
    renderHistory();
    
    // Default template display in editor
    if (promptTemplates.length > 0) {
        loadTemplateToEditor(promptTemplates[0].id);
    }
    
    // Template Editor Events
    setupTemplateEditorEvents();
    
    // 2. 主 Tab 切换
    const mainTabBtns = document.querySelectorAll('.main-tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    
    mainTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            mainTabBtns.forEach(b => b.classList.toggle('active', b === btn));
            tabPanels.forEach(p => p.classList.toggle('active', p.id === targetId));
        });
    });

    // 3. 弹窗打开/关闭
    const settingsModal = document.getElementById('settings-modal');
    const historyModal = document.getElementById('history-modal');
    const debugLogsModal = document.getElementById('debug-logs-modal');
    const depGuideModal = document.getElementById('dep-guide-modal');
    
    document.getElementById('btn-settings-trigger')?.addEventListener('click', () => {
        loadConfig();
        checkBiliStatus();
        settingsModal.classList.add('active');
    });
    
    document.getElementById('btn-history-trigger')?.addEventListener('click', () => {
        renderHistory();
        historyModal.classList.add('active');
    });

    document.getElementById('btn-dep-guide-trigger')?.addEventListener('click', () => {
        depGuideModal.classList.add('active');
    });
    
    document.getElementById('btn-close-settings')?.addEventListener('click', () => settingsModal.classList.remove('active'));
    document.getElementById('btn-close-history')?.addEventListener('click', () => historyModal.classList.remove('active'));
    document.getElementById('btn-close-debug-logs')?.addEventListener('click', () => debugLogsModal.classList.remove('active'));
    document.getElementById('btn-close-dep-guide')?.addEventListener('click', () => depGuideModal.classList.remove('active'));
    
    [settingsModal, historyModal, debugLogsModal, depGuideModal].forEach(modal => {
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    });
    
    // Collapsible Progress close & expand logs
    document.getElementById('btn-close-progress')?.addEventListener('click', () => {
        document.getElementById('task-progress-panel').classList.add('collapsed');
    });
    
    document.getElementById('btn-expand-debug-logs')?.addEventListener('click', () => {
        debugLogsModal.classList.add('active');
    });

    // Settings actions
    document.getElementById('settings-save')?.addEventListener('click', saveConfig);
    document.getElementById('clear-history')?.addEventListener('click', () => {
        const activeTab = document.querySelector('.history-tabs .tab-btn.active');
        const type = activeTab ? (activeTab.id === 'tab-local' ? 'local' : 'url') : 'local';
        localStorage.removeItem(`video2txt_history_${type}`);
        appendLog('📜 历史记录已清空。', 'info');
        renderHistory();
    });
    
    // Settings layout path selectors
    document.getElementById('btn-browse-output')?.addEventListener('click', () => browseDirectory('modal-output-dir'));
    document.getElementById('btn-browse-log')?.addEventListener('click', () => browseDirectory('modal-log-dir'));

    // B站 scan trigger
    document.getElementById('btn-bili-login-trigger')?.addEventListener('click', triggerBiliLogin);
    document.getElementById('btn-bili-logout')?.addEventListener('click', logoutBili);

    // Double-click dependency banner to force check
    document.getElementById('dep-checker')?.addEventListener('click', () => {
        localStorage.removeItem('video2txt_dep_checked');
        appendLog('🔄 重新检测环境依赖中...', 'info');
        checkDependencies();
    });

    // Outer headers Theme toggle
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
        const newTheme = appConfig.theme === 'dark' ? 'light' : 'dark';
        appConfig.theme = newTheme;
        localStorage.setItem('video2txt_config', JSON.stringify(appConfig));
        applyThemeAndFont(newTheme, appConfig.fontSize);
        
        const modalTheme = document.getElementById('modal-theme-select');
        if (modalTheme) modalTheme.value = newTheme;
        appendLog(`🌓 切换至 ${newTheme === 'dark' ? '🌙 暗黑' : '☀️ 明亮'} 模式`, 'info');
    });

    // Modal interior theme changer
    document.getElementById('modal-theme-select')?.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        appConfig.theme = newTheme;
        localStorage.setItem('video2txt_config', JSON.stringify(appConfig));
        applyThemeAndFont(newTheme, appConfig.fontSize);
        appendLog(`🌓 主题更新为 ${newTheme === 'dark' ? '🌙 暗黑' : '☀️ 明亮'}`, 'info');
    });
    
    document.getElementById('modal-font-size-select')?.addEventListener('change', (e) => {
        const newSize = e.target.value;
        appConfig.fontSize = newSize;
        localStorage.setItem('video2txt_config', JSON.stringify(appConfig));
        applyThemeAndFont(appConfig.theme, newSize);
        appendLog(`全局字体大小更新为 ${newSize}`, 'info');
    });

    // 4. Tab 1 (在线转文字) Events
    const urlInput = document.getElementById('url-input');
    urlInput?.addEventListener('input', () => {
        validateAllInputs();
    });
    
    document.querySelectorAll('.online-fmt').forEach(cb => {
        cb.addEventListener('change', validateAllInputs);
    });
    
    document.getElementById('start-online-btn')?.addEventListener('click', () => {
        const urlVal = urlInput.value.trim();
        if (!urlVal) return;
        
        const urls = urlVal.split('\n').map(u => u.trim()).filter(u => u !== '');
        const queue = urls.map(u => ({ input: u, type: 'url' }));
        
        const engine = document.getElementById('engine-select-online').value;
        const formats = getSelectedFormats('online').join(',');
        const noSubtitle = document.getElementById('skip-sub-checkbox').checked;
        
        runBatchTasks(queue, engine, formats, noSubtitle);
    });

    // 5. Tab 2 (本地转文字) Events
    document.getElementById('btn-select-files')?.addEventListener('click', handleSelectLocalFiles);
    document.getElementById('btn-select-folder')?.addEventListener('click', handleSelectLocalFolder);
    document.getElementById('clear-file')?.addEventListener('click', () => {
        selectedFilePaths = [];
        updateLocalSelectedUI();
        validateAllInputs();
    });
    
    document.getElementById('drop-zone')?.addEventListener('click', (e) => {
        if (e.target.id === 'drop-zone' || e.target.closest('#drop-zone')) {
            // Pick files only if they clicked on main elements (excluding buttons)
            if (!e.target.closest('button')) {
                handleSelectLocalFiles();
            }
        }
    });

    document.querySelectorAll('.local-fmt').forEach(cb => {
        cb.addEventListener('change', validateAllInputs);
    });

    document.getElementById('start-local-btn')?.addEventListener('click', () => {
        if (selectedFilePaths.length === 0) return;
        const queue = selectedFilePaths.map(f => ({ input: f, type: 'local' }));
        
        const engine = document.getElementById('engine-select-local').value;
        const formats = getSelectedFormats('local').join(',');
        
        runBatchTasks(queue, engine, formats, false);
    });

    // 6. Tab 3 (优化转Markdown) Events
    document.getElementById('btn-select-md-files')?.addEventListener('click', handleSelectMdFiles);
    document.getElementById('btn-select-md-folder')?.addEventListener('click', handleSelectMdFolder);
    document.getElementById('clear-md-file')?.addEventListener('click', () => {
        selectedMdFilePaths = [];
        updateMdSelectedUI();
        validateAllInputs();
    });
    
    document.getElementById('md-drop-zone')?.addEventListener('click', (e) => {
        if (e.target.id === 'md-drop-zone' || e.target.closest('#md-drop-zone')) {
            if (!e.target.closest('button')) {
                handleSelectMdFiles();
            }
        }
    });

    document.getElementById('start-md-btn')?.addEventListener('click', () => {
        if (selectedMdFilePaths.length === 0) return;
        const queue = selectedMdFilePaths.map(f => ({ input: f, type: 'local' }));
        
        const engine = 'gemini'; // default engine is gemini, will use LLM settings
        
        // formats is checked for HTML visualization too
        const isHtmlChecked = document.getElementById('md-html-checkbox').checked;
        const formats = isHtmlChecked ? 'md,html' : 'md';
        
        const selectedTplId = document.getElementById('md-template-select').value;
        const templateObj = promptTemplates.find(t => t.id === selectedTplId);
        let promptTemplate = templateObj ? templateObj.content : '';
        
        // If series wiki mode checked, append modifier instructions to system prompt
        const isSeriesChecked = document.getElementById('md-series-checkbox').checked;
        if (isSeriesChecked) {
            promptTemplate += "\n\n⚠️ 重要修饰要求：此任务属于“系列课程/文档”的一部分。整理编写时，必须符合 LLM Wiki 知识网格规范。请保证文章结构能够完美融入课程 WIKI 文库体系，用清晰的分级标题与关联导图式脉络组织内容，概念定义必须独立且标准化，以便于将来做向量检索与大模型微调调用。";
        }
        
        runBatchTasks(queue, engine, formats, false, promptTemplate);
    });

    // History interior sub-tab buttons toggle
    const hTabLocal = document.getElementById('tab-local');
    const hTabUrl = document.getElementById('tab-url');
    const hListLocal = document.getElementById('history-local-list');
    const hListUrl = document.getElementById('history-url-list');
    
    hTabLocal?.addEventListener('click', () => {
        hTabLocal.classList.add('active');
        hTabUrl?.classList.remove('active');
        hListLocal?.classList.remove('hidden');
        hListUrl?.classList.add('hidden');
    });
    
    hTabUrl?.addEventListener('click', () => {
        hTabUrl.classList.add('active');
        hTabLocal?.classList.remove('active');
        hListUrl?.classList.remove('hidden');
        hListLocal?.classList.add('hidden');
    });

    // Debug logs clear button
    document.getElementById('clear-logs')?.addEventListener('click', () => {
        const logBox = document.getElementById('log-box');
        if (logBox) logBox.innerHTML = '<div class="log-placeholder">等待任务启动...</div>';
    });

    // 7. Preview pane tool events
    document.getElementById('previewer-close-btn')?.addEventListener('click', () => {
        document.getElementById('file-previewer').classList.add('hidden');
    });

    document.getElementById('previewer-system-open-btn')?.addEventListener('click', () => {
        if (currentPreviewPath) {
            window.openFile(currentPreviewPath);
        }
    });

    const btnFontDec = document.getElementById('previewer-font-dec');
    const btnFontInc = document.getElementById('previewer-font-inc');
    const fontSizeText = document.getElementById('previewer-font-size-text');
    const contentBody = document.getElementById('previewer-content');

    btnFontDec?.addEventListener('click', () => {
        currentPreviewFontSize = Math.max(12, currentPreviewFontSize - 1);
        if (fontSizeText) fontSizeText.textContent = `${currentPreviewFontSize}px`;
        if (contentBody) contentBody.style.fontSize = `${currentPreviewFontSize}px`;
    });

    btnFontInc?.addEventListener('click', () => {
        currentPreviewFontSize = Math.min(24, currentPreviewFontSize + 1);
        if (fontSizeText) fontSizeText.textContent = `${currentPreviewFontSize}px`;
        if (contentBody) contentBody.style.fontSize = `${currentPreviewFontSize}px`;
    });
});

// ─── 12. 自定义标题栏与操作系统特性 ─────────────────────────────────
const isMac = navigator.userAgent.toLowerCase().includes('mac');
document.body.classList.add(isMac ? 'os-macos' : 'os-windows');

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

// 徹底清除网页缩放与右键等操作
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => {
    if (e.ctrlKey) e.preventDefault();
}, { passive: false });
document.addEventListener('keydown', e => {
    if (e.ctrlKey && (e.key === '=' || e.key === '-' || e.key === '+' || e.key === '0')) {
        e.preventDefault();
    }
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());
