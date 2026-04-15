// ===== OneREE Frontend Engine =====
let allData = [];
let currentPage = 1;
const itemsPerPage = 10;
let filteredData = [];
let sortConfig = { key: null, direction: null };
let columnFilters = {};
let statusInterval = null;
let currentLocale = 'ja';
let i18nData = {};
let currentProject = '';
let projectList = [];
let diffNodes = [];
let currentDiffIndex = -1;
/** 当前详情弹窗打开的文件 id（用于上一个/下一个文件） */
let modalOpenFileId = null;

// ===== i18n Engine =====
async function loadLocale(locale) {
    try {
        const res = await fetch(`/i18n/${locale}.json?t=${Date.now()}`);
        if (res.ok) {
            i18nData = await res.json();
            currentLocale = locale;
            localStorage.setItem('oneree_locale', locale);
            applyI18n();
        }
    } catch (e) {
        console.error('Failed to load locale:', locale, e);
    }
}

function t(key, params = {}) {
    let str = i18nData[key] || key;
    Object.keys(params).forEach(k => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
    return str;
}

/** 旧 report-data 无 requirementKey 时的英文文案 → i18n 键 */
const LEGACY_REQUIREMENT_MAP = {
    'Source file modified (Hash mismatch).': 'req_hash_modified',
    'Binary file change detected.': 'req_binary_changed',
    'New source file added.': 'req_new_source',
    'New binary file added.': 'req_new_binary',
    'Standard feature removed in customization.': 'req_standard_removed'
};

function translateTypeLabel(type) {
    if (!type) return '';
    return t(`type_${String(type).toLowerCase()}`);
}

function translateRequirement(item) {
    if (item.requirementKey) return t(item.requirementKey);
    const legacy = LEGACY_REQUIREMENT_MAP[item.requirement];
    if (legacy) return t(legacy);
    return item.requirement || '';
}

function translateDetailLine(d) {
    if (d && typeof d === 'object' && d.key) {
        return t(d.key, d.params || {});
    }
    if (typeof d !== 'string') return String(d);
    if (d === 'Hash mismatch detected. Detailed comparison available in code view.') {
        return `${t('detail_hash_mismatch')} ${t('detail_code_compare_hint')}`;
    }
    const legacyDetail = {
        'Hash mismatch detected.': 'detail_hash_mismatch',
        'Detailed comparison available in code view.': 'detail_code_compare_hint'
    };
    if (legacyDetail[d]) return t(legacyDetail[d]);
    if (d.startsWith('Decompilation failed:')) {
        const err = d.slice('Decompilation failed:'.length).trim();
        return t('detail_decompile_failed', { error: err });
    }
    return d;
}

function applyI18n() {
    document.title = t('app_title');
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (el.tagName === 'INPUT') {
            el.placeholder = t(key);
        } else {
            el.textContent = t(key);
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    // 先同步类型下拉与 columnFilters，再 applyFiltersAndSort（内含 renderTable），避免切换语言后筛选状态与 DOM 不一致
    renderStats();
    populateTypeFilter();
    applyFiltersAndSort();
    if (!document.getElementById('modal').classList.contains('hidden') && modalOpenFileId != null) {
        updateModalFileNav(modalOpenFileId);
    }
}

// ===== Project Management =====
async function loadProjects() {
    try {
        const res = await fetch(`/api/projects?t=${Date.now()}`);
        if (res.ok) {
            projectList = await res.json();
            const selector = document.getElementById('project-selector');
            selector.innerHTML = '';
            projectList.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                selector.appendChild(opt);
            });
            if (projectList.length > 0) {
                currentProject = projectList[0].id;
                selector.value = currentProject;
            }
        }
    } catch (e) {
        console.error('Failed to load projects', e);
    }
}

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();

    // Load saved locale or default
    const savedLocale = localStorage.getItem('oneree_locale') || 'ja';
    document.getElementById('lang-selector').value = savedLocale;
    await loadLocale(savedLocale);
    await loadProjects();

    // Check backend status first: if processing, reconnect UI
    const statusResp = await fetch(`/api/status?project=${currentProject}&t=${Date.now()}`);
    const statusData = (statusResp.ok) ? await statusResp.json() : { status: 'idle' };

    if (statusData.status === 'analyzing') {
        showAnalysisUI();
    } else {
        await fetchData();
    }

    // Event Listeners
    const analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) analyzeBtn.addEventListener('click', startAnalysis);

    const prevPage = document.getElementById('prev-page');
    if (prevPage) prevPage.addEventListener('click', () => changePage(-1));

    const nextPage = document.getElementById('next-page');
    if (nextPage) nextPage.addEventListener('click', () => changePage(1));

    const thead = document.querySelector('thead');
    if (thead) {
        thead.addEventListener('click', handleHeaderClick);
        thead.addEventListener('input', handleColumnFilter);
    }

    const filterType = document.getElementById('filter-type');
    if (filterType) filterType.addEventListener('change', handleColumnFilter);

    const closeModal = document.getElementById('close-modal');
    if (closeModal) closeModal.addEventListener('click', () => {
        document.getElementById('modal').classList.add('hidden');
        modalOpenFileId = null;
    });

    // Minimize & Stop controls
    const minBtn = document.getElementById('minimize-progress');
    if (minBtn) minBtn.addEventListener('click', () => {
        document.getElementById('progress-overlay').classList.add('hidden');
        document.getElementById('progress-mini').classList.remove('hidden');
    });

    const pill = document.getElementById('progress-mini');
    if (pill) pill.addEventListener('click', () => {
        pill.classList.add('hidden');
        document.getElementById('progress-overlay').classList.remove('hidden');
    });

    const stopBtn = document.getElementById('stop-progress');
    if (stopBtn) stopBtn.addEventListener('click', async () => {
        if (confirm(t('confirm_stop'))) {
            // Immediately stop polling and reset UI
            if (statusInterval) {
                clearInterval(statusInterval);
                statusInterval = null;
            }
            try {
                await fetch(`/api/stop-analyze?project=${currentProject}`, { method: 'POST' });
            } catch (e) {
                console.error('Stop request failed:', e);
            }
            resetAnalysisUI(true);
        }
    });

    const langSelector = document.getElementById('lang-selector');
    if (langSelector) langSelector.addEventListener('change', (e) => {
        loadLocale(e.target.value);
    });

    const projectSelector = document.getElementById('project-selector');
    if (projectSelector) projectSelector.addEventListener('change', async (e) => {
        currentProject = e.target.value;
        await fetchData();
        startAnalysis();
    });

    const manageIgnoreBtn = document.getElementById('manage-ignore-btn');
    if (manageIgnoreBtn) manageIgnoreBtn.addEventListener('click', openIgnoreList);

    const ignoreAllAddedBtn = document.getElementById('ignore-all-added-btn');
    if (ignoreAllAddedBtn) ignoreAllAddedBtn.addEventListener('click', ignoreAllAddedFiles);

    const closeIgnoreModal = document.getElementById('close-ignore-modal');
    if (closeIgnoreModal) closeIgnoreModal.addEventListener('click', () => {
        document.getElementById('ignore-modal').classList.add('hidden');
    });

    const modalPrevFile = document.getElementById('modal-prev-file');
    if (modalPrevFile) modalPrevFile.addEventListener('click', () => openModalAdjacentFile(-1));
    const modalNextFile = document.getElementById('modal-next-file');
    if (modalNextFile) modalNextFile.addEventListener('click', () => openModalAdjacentFile(1));
});

// ===== Data Fetching =====
async function fetchData() {
    try {
        const response = await fetch(`/api/report?project=${currentProject}&t=${Date.now()}`);
        if (response.ok) {
            allData = await response.json();
            populateTypeFilter();
            applyFiltersAndSort();
            renderStats();
            return allData.length > 0;
        }
    } catch (e) {
        showToast(t("toast_fetch_error"), "error");
    }
    return false;
}

function populateTypeFilter() {
    const types = [...new Set(allData.map(item => item.type))].sort();
    const select = document.getElementById('filter-type');
    select.innerHTML = `<option value="">${t('filter_all_types')}</option>`;
    types.forEach(tp => {
        const opt = document.createElement('option');
        opt.value = tp;
        opt.textContent = translateTypeLabel(tp);
        select.appendChild(opt);
    });
    // 与 columnFilters 同步：重建 option 后必须恢复选中项；数据变化后若已无该种别则清除筛选（避免「界面像全種別、实际仍按 ADDED 过滤」）
    const saved = columnFilters['type'];
    if (saved && types.includes(saved)) {
        select.value = saved;
    } else {
        if (saved && !types.includes(saved)) {
            delete columnFilters['type'];
        }
        select.value = '';
    }
}

// ===== Analysis & Progress =====
let lastLogIndex = 0;

function showAnalysisUI() {
    const btn = document.getElementById('analyze-btn');
    const overlay = document.getElementById('progress-overlay');
    const logContainer = document.getElementById('terminal-log');

    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="spinning"></i> <span>${t('btn_analyzing')}</span>`;
    lucide.createIcons();

    overlay.classList.remove('hidden');
    // Don't clear logs if we are reconnecting
    if (lastLogIndex === 0) {
        logContainer.innerHTML = `<div class="log-entry system">> ${t('progress_session_start')}</div>`;
    }
    document.getElementById('progress-bar-fill').style.width = '0%';
    document.getElementById('progress-percent').textContent = '0%';
    document.getElementById('current-file').textContent = t('progress_init');

    if (statusInterval) clearInterval(statusInterval);
    statusInterval = setInterval(checkStatus, 800);
}

async function startAnalysis() {
    lastLogIndex = 0;
    showAnalysisUI();

    try {
        const response = await fetch(`/api/analyze?project=${currentProject}`, { method: 'POST' });
        // 202 = Started, 409 = Already running (successful "start" in both cases)
        if (!response.ok && response.status !== 409) {
            throw new Error(`Server error: ${response.status}`);
        }
    } catch (e) {
        showToast(t("toast_request_fail"), "error");
        const btn = document.getElementById('analyze-btn');
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="refresh-cw"></i> <span>${t('btn_reanalyze')}</span>`;
        lucide.createIcons();
        document.getElementById('progress-overlay').classList.add('hidden');
    }
}

async function checkStatus() {
    try {
        const response = await fetch(`/api/status?project=${currentProject}&t=${Date.now()}`);
        if (!response.ok) return;

        const data = await response.json();
        if (data.status === 'idle') {
            // If we are actively polling (statusInterval is set), 'idle' means
            // analysis was stopped or completed outside our tracking. Reset UI.
            if (statusInterval) {
                resetAnalysisUI(true);
            }
            return;
        }

        document.getElementById('progress-bar-fill').style.width = `${data.progress}%`;
        document.getElementById('progress-percent').textContent = `${data.progress}%`;
        document.getElementById('current-file').textContent = data.currentFile || t('progress_processing');

        // Update mini indicator too
        document.getElementById('mini-bar-fill').style.width = `${data.progress}%`;
        document.getElementById('mini-percent').textContent = `${data.progress}%`;

        // Periodically refresh the data table to show incremental results
        // Trigger a refresh every 5% progress or if we are near the end
        if (data.progress % 5 === 0 || data.progress > 95) {
            fetchData();
        }

        // Render ALL new log entries since last poll (no gaps)
        if (data.logs && data.logs.length > lastLogIndex) {
            const logContainer = document.getElementById('terminal-log');
            const newEntries = data.logs.slice(lastLogIndex);
            for (const msg of newEntries) {
                const entry = document.createElement('div');
                entry.className = 'log-entry';
                entry.textContent = `> ${msg}`;
                logContainer.appendChild(entry);
            }
            lastLogIndex = data.logs.length;
            logContainer.scrollTop = logContainer.scrollHeight;
        }

        if (data.status === 'done') {
            clearInterval(statusInterval);
            statusInterval = null;
            setTimeout(() => resetAnalysisUI(), 1000);
        }
    } catch (e) {
        console.error("Status check failed", e);
    }
}

async function resetAnalysisUI(isAborted = false) {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
    await fetchData();
    document.getElementById('progress-overlay').classList.add('hidden');
    document.getElementById('progress-mini').classList.add('hidden');
    
    const btn = document.getElementById('analyze-btn');
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="refresh-cw"></i> <span>${t('btn_reanalyze')}</span>`;
    lucide.createIcons();
    
    if (isAborted) {
        showToast(t("toast_aborted"), "info");
    } else {
        showToast(t("toast_done"), "success");
    }
}

// ===== Filtering & Sorting =====
function handleColumnFilter(e) {
    if (e.target.classList.contains('col-filter') || e.target.id === 'filter-type') {
        const col = e.target.dataset.col;
        columnFilters[col] = e.target.value;
        currentPage = 1;
        applyFiltersAndSort();
    }
}

function handleHeaderClick(e) {
    const th = e.target.closest('.sortable');
    if (th && !e.target.classList.contains('col-filter') && e.target.tagName !== 'SELECT') {
        const col = th.dataset.col;
        if (sortConfig.key === col) {
            if (sortConfig.direction === 'asc') sortConfig.direction = 'desc';
            else if (sortConfig.direction === 'desc') {
                sortConfig.direction = null;
                sortConfig.key = null;
            }
        } else {
            sortConfig.key = col;
            sortConfig.direction = 'asc';
        }
        applyFiltersAndSort();
    }
}

function wildcardToRegex(str) {
    if (!str) return null;
    let pattern = str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    pattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
    if (!str.includes('*') && !str.includes('?')) {
        return new RegExp(pattern, 'i');
    }
    return new RegExp(`^${pattern}$`, 'i');
}

function getDirOnly(fullPath) {
    const lastSlash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
    if (lastSlash === -1) return './';
    return fullPath.substring(0, lastSlash);
}

function applyFiltersAndSort() {
    let data = [...allData];

    Object.keys(columnFilters).forEach(col => {
        const query = columnFilters[col];
        if (query) {
            const regex = wildcardToRegex(query);
            data = data.filter(item => {
                if (col === 'requirement') {
                    const tr = translateRequirement(item);
                    const raw = String(item.requirement || '');
                    const key = String(item.requirementKey || '');
                    return regex.test(tr) || regex.test(raw) || regex.test(key);
                }
                let target = String(item[col] || '');
                if (col === 'path') target = getDirOnly(item.path);
                return regex.test(target);
            });
        }
    });

    if (sortConfig.key && sortConfig.direction) {
        data.sort((a, b) => {
            let valA = String(a[sortConfig.key] || '');
            let valB = String(b[sortConfig.key] || '');
            if (sortConfig.key === 'path') {
                valA = getDirOnly(valA);
                valB = getDirOnly(valB);
            } else if (sortConfig.key === 'requirement') {
                valA = translateRequirement(a);
                valB = translateRequirement(b);
            } else if (sortConfig.key === 'type') {
                valA = translateTypeLabel(a.type);
                valB = translateTypeLabel(b.type);
            }
            const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
            return sortConfig.direction === 'asc' ? cmp : -cmp;
        });
    }

    filteredData = data;
    renderTable();
    updateSortIcons();
}

function updateSortIcons() {
    document.querySelectorAll('.sortable').forEach(th => {
        const col = th.dataset.col;
        const icon = th.querySelector('.sort-icon');
        if (col === sortConfig.key) {
            icon.dataset.lucide = sortConfig.direction === 'asc' ? 'chevron-up' : 'chevron-down';
            icon.classList.add('active');
        } else {
            icon.dataset.lucide = 'arrow-up-down';
            icon.classList.remove('active');
        }
    });
    lucide.createIcons();
}

// ===== Rendering =====
function renderStats() {
    document.getElementById('stat-total').textContent = allData.length;
    document.getElementById('stat-modified').textContent = allData.filter(i => i.type === 'MODIFIED').length;
    document.getElementById('stat-delta').textContent = allData.filter(i => i.type === 'ADDED' || i.type === 'DELETED').length;
}

function renderTable() {
    const totalPagesSafe = Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
    if (currentPage > totalPagesSafe) currentPage = totalPagesSafe;

    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = filteredData.slice(start, end);

    const body = document.getElementById('report-body');
    body.innerHTML = '';

    pageItems.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="cell-id">${item.id}</td>
            <td class="cell-path">${getDirOnly(item.path)}</td>
            <td class="cell-name">${item.name}</td>
            <td><span class="type-badge type-${item.type}">${translateTypeLabel(item.type)}</span></td>
            <td class="requirement-text">
                ${item.type === 'MODIFIED'
                    ? `<span class="requirement-link" data-id="${item.id}">${translateRequirement(item)}</span>`
                    : translateRequirement(item)}
            </td>
            <td class="cell-actions">
                <button class="ignore-btn-sm" title="${t('btn_ignore')}">
                    <i data-lucide="ban"></i>
                </button>
            </td>
        `;

        // Safe event attachment to avoid path escaping issues
        const reqLink = row.querySelector('.requirement-link');
        if (reqLink) reqLink.onclick = () => openDetail(item.id);
        
        row.querySelector('.ignore-btn-sm').onclick = () => toggleIgnore(item.path);
        
        body.appendChild(row);
    });
    lucide.createIcons();

    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    document.getElementById('page-info').textContent = t('page_info', { current: currentPage, total: totalPages || 1 });
    document.getElementById('prev-page').disabled = currentPage === 1;
    document.getElementById('next-page').disabled = currentPage >= totalPages || totalPages === 0;
}

function changePage(delta) {
    currentPage += delta;
    renderTable();
}

function showToast(msg, type) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ===== Detail Modal =====
function updateModalFileNav(currentId) {
    const pathEl = document.getElementById('modal-file-path');
    const prevBtn = document.getElementById('modal-prev-file');
    const nextBtn = document.getElementById('modal-next-file');
    const prevName = document.getElementById('modal-prev-file-name');
    const nextName = document.getElementById('modal-next-file-name');
    const posEl = document.getElementById('modal-file-position');
    if (!prevBtn || !nextBtn || !posEl) return;

    const idx = filteredData.findIndex(i => i.id === currentId);
    const prevItem = idx > 0 ? filteredData[idx - 1] : null;
    const nextItem = idx >= 0 && idx < filteredData.length - 1 ? filteredData[idx + 1] : null;

    prevBtn.disabled = !prevItem;
    nextBtn.disabled = !nextItem;
    prevBtn.title = t('modal_prev_file');
    nextBtn.title = t('modal_next_file');

    if (prevName) {
        prevName.textContent = prevItem ? prevItem.name : '';
        prevName.title = prevItem ? prevItem.path : '';
    }
    if (nextName) {
        nextName.textContent = nextItem ? nextItem.name : '';
        nextName.title = nextItem ? nextItem.path : '';
    }
    posEl.textContent = idx >= 0 && filteredData.length > 0
        ? `${idx + 1} / ${filteredData.length}`
        : '0 / 0';
    if (pathEl) pathEl.title = pathEl.textContent || '';
}

function openModalAdjacentFile(delta) {
    if (modalOpenFileId == null) return;
    const idx = filteredData.findIndex(i => i.id === modalOpenFileId);
    if (idx < 0) return;
    const target = filteredData[idx + delta];
    if (target) openDetail(target.id);
}

function openDetail(id) {
    const item = allData.find(i => i.id === id);
    if (!item) return;

    modalOpenFileId = id;
    diffNodes = [];
    currentDiffIndex = -1;

    document.getElementById('modal-title').textContent = t('modal_title', { file: item.name });
    const pathEl = document.getElementById('modal-file-path');
    pathEl.textContent = item.path;
    pathEl.title = item.path;

    const list = document.getElementById('modal-details-list');
    list.innerHTML = '';
    const details = item.detailedAnalysis || [];
    if (details.length === 0) {
        list.innerHTML = `<li class="no-data">${t('modal_no_detail')}</li>`;
    } else {
        details.forEach(d => {
            const li = document.createElement('li');
            li.textContent = translateDetailLine(d);
            list.appendChild(li);
        });
    }

    const diffContainer = document.getElementById('modal-diff-container');
    diffContainer.innerHTML = '';

    if (item.standardCode && item.customCode) {
        renderDiff(item.standardCode, item.customCode, diffContainer);
    } else {
        const msg = item.type === 'MODIFIED' ? t('modal_no_source') : t('modal_non_modified');
        diffContainer.innerHTML = `<div class="diff-placeholder">${msg}</div>`;
        updateDiffLabel();
    }

    document.getElementById('modal').classList.remove('hidden');
    lucide.createIcons();
    updateModalFileNav(id);

    // 切换文件后重置弹窗滚动，避免沿用上一文件的 scrollTop，导致「下一处差异」像往回滚
    const modalBody = document.querySelector('#modal .modal-body');
    if (modalBody) modalBody.scrollTop = 0;
}

// ===== Diff Engine (Side-By-Side with LCS) =====
function renderDiff(oldCode, newCode, container) {
    const oldLines = (oldCode || "").split('\n');
    const newLines = (newCode || "").split('\n');
    
    // Performance optimization for extremely large files
    if (oldLines.length + newLines.length > 5000) {
        renderSimpleDiff(oldLines, newLines, container);
        return;
    }

    const m = oldLines.length;
    const n = newLines.length;
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

    // Whitespace-insensitive comparison helper
    const compareLines = (l1, l2) => l1.trim() === l2.trim();

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (compareLines(oldLines[i - 1], newLines[j - 1])) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const rawRows = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && compareLines(oldLines[i - 1], newLines[j - 1])) {
            rawRows.unshift({ type: 'unchanged', oldLine: oldLines[i - 1], newLine: newLines[j - 1], oldNum: i, newNum: j });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            rawRows.unshift({ type: 'added', oldLine: '', newLine: newLines[j - 1], oldNum: '-', newNum: j });
            j--;
        } else {
            rawRows.unshift({ type: 'removed', oldLine: oldLines[i - 1], newLine: '', oldNum: i, newNum: '-' });
            i--;
        }
    }

    // Consolidation: Merge adjacent removed/added into modified, and ignore empty noise.
    const alignedRows = [];
    let r = 0;
    while (r < rawRows.length) {
        if (rawRows[r].type === 'unchanged') {
            alignedRows.push(rawRows[r]);
            r++;
            continue;
        }

        // Collect contiguous blocks of changes
        let blockRemoved = [];
        let blockAdded = [];
        while (r < rawRows.length && rawRows[r].type !== 'unchanged') {
            if (rawRows[r].type === 'removed') blockRemoved.push(rawRows[r]);
            if (rawRows[r].type === 'added') blockAdded.push(rawRows[r]);
            r++;
        }

        // Post-process the block
        let maxLen = Math.max(blockRemoved.length, blockAdded.length);
        for (let k = 0; k < maxLen; k++) {
            let rem = blockRemoved[k];
            let add = blockAdded[k];

            if (rem && add) {
                // Ignore if both are just empty strings/spaces being modified (noise)
                if (rem.oldLine.trim() === '' && add.newLine.trim() === '') {
                   alignedRows.push({ type: 'unchanged', oldLine: rem.oldLine, newLine: add.newLine, oldNum: rem.oldNum, newNum: add.newNum }); 
                } else {
                   alignedRows.push({ type: 'modified', oldLine: rem.oldLine, newLine: add.newLine, oldNum: rem.oldNum, newNum: add.newNum });
                }
            } else if (rem) {
                if (rem.oldLine.trim() === '') { // Ignore removed blank lines
                    alignedRows.push({ type: 'unchanged', oldLine: rem.oldLine, newLine: '', oldNum: rem.oldNum, newNum: '-' });
                } else {
                    alignedRows.push(rem);
                }
            } else if (add) {
                if (add.newLine.trim() === '') { // Ignore added blank lines
                    alignedRows.push({ type: 'unchanged', oldLine: '', newLine: add.newLine, oldNum: '-', newNum: add.newNum });
                } else {
                    alignedRows.push(add);
                }
            }
        }
    }

    renderAlignedDiff(alignedRows, container);
}


function renderAlignedDiff(rows, container) {
    const table = document.createElement('div');
    table.className = 'diff-table';
    container.innerHTML = '';
    
    // Add Labels Row
    const project = projectList.find(p => p.id === currentProject) || {};
    const stdLabel = project.standard_dir || 'Standard';
    const custLabel = project.customized_dir || 'Customized';
    
    const headerRow = document.createElement('div');
    headerRow.className = 'diff-header-row';
    headerRow.innerHTML = `
        <div class="header-cell side-label left">Standard [${stdLabel}]</div>
        <div class="header-cell side-label right">Customized [${custLabel}]</div>
    `;
    container.appendChild(headerRow);
    container.appendChild(table);

    diffNodes = [];
    currentDiffIndex = -1;

    rows.forEach(row => {
        const domRow = document.createElement('div');
        domRow.className = `diff-row ${row.type}`;
        
        const leftNum = document.createElement('div');
        const leftCell = document.createElement('div');
        const rightNum = document.createElement('div');
        const rightCell = document.createElement('div');
        
        leftNum.className = 'diff-cell diff-num';
        leftCell.className = 'diff-cell left';
        rightNum.className = 'diff-cell diff-num';
        rightCell.className = 'diff-cell right';

        leftNum.textContent = row.oldNum;
        rightNum.textContent = row.newNum;

        if (row.type === 'modified') {
            // Character-level diff: highlight only changed portions
            const [leftHtml, rightHtml] = buildInlineDiff(row.oldLine, row.newLine);
            leftCell.innerHTML = leftHtml;
            rightCell.innerHTML = rightHtml;
        } else {
            leftCell.textContent = row.oldLine;
            rightCell.textContent = row.newLine;
        }

        if (row.type !== 'unchanged') {
            diffNodes.push(domRow);
        }

        domRow.appendChild(leftNum);
        domRow.appendChild(leftCell);
        domRow.appendChild(rightNum);
        domRow.appendChild(rightCell);
        table.appendChild(domRow);
    });

    updateDiffLabel();
}

// Character-level inline diff: finds common prefix/suffix and highlights only the changed middle
function buildInlineDiff(oldStr, newStr) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    if (!oldStr && !newStr) return ['', ''];
    if (!oldStr) return ['', `<span class="char-diff">${esc(newStr)}</span>`];
    if (!newStr) return [`<span class="char-diff">${esc(oldStr)}</span>`, ''];

    // Find common prefix length
    let prefixLen = 0;
    const minLen = Math.min(oldStr.length, newStr.length);
    while (prefixLen < minLen && oldStr[prefixLen] === newStr[prefixLen]) {
        prefixLen++;
    }

    // Find common suffix length (not overlapping with prefix)
    let suffixLen = 0;
    while (suffixLen < (minLen - prefixLen) 
        && oldStr[oldStr.length - 1 - suffixLen] === newStr[newStr.length - 1 - suffixLen]) {
        suffixLen++;
    }

    const prefix = oldStr.substring(0, prefixLen);
    const oldMid = oldStr.substring(prefixLen, oldStr.length - suffixLen);
    const newMid = newStr.substring(prefixLen, newStr.length - suffixLen);
    const suffix = oldStr.substring(oldStr.length - suffixLen);

    const leftHtml = esc(prefix) 
        + (oldMid ? `<span class="char-diff">${esc(oldMid)}</span>` : '') 
        + esc(suffix);
    const rightHtml = esc(prefix) 
        + (newMid ? `<span class="char-diff">${esc(newMid)}</span>` : '') 
        + esc(suffix);

    return [leftHtml, rightHtml];
}

// Fallback for huge files to prevent browser hang
function renderSimpleDiff(oldLines, newLines, container) {
    const rows = [];
    const len = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < len; i++) {
        const oldL = oldLines[i] || "";
        const newL = newLines[i] || "";
        if (oldL === newL) {
            rows.push({ type: 'unchanged', oldLine: oldL, newLine: newL, oldNum: i+1, newNum: i+1 });
        } else {
            rows.push({ type: 'modified', oldLine: oldL, newLine: newL, oldNum: i+1, newNum: i+1 });
        }
    }
    renderAlignedDiff(rows, container);
}

function updateDiffLabel() {
    const label = document.getElementById('diff-count-label');
    if (label) {
        label.textContent = diffNodes.length > 0 
            ? `${currentDiffIndex + 1} / ${diffNodes.length}`
            : `0 / 0`;
    }
}

function jumpToChange(direction) {
    if (diffNodes.length === 0) return;
    
    currentDiffIndex += direction;
    if (currentDiffIndex >= diffNodes.length) currentDiffIndex = 0;
    if (currentDiffIndex < 0) currentDiffIndex = diffNodes.length - 1;
    
    const target = diffNodes[currentDiffIndex];
    if (target && target.firstElementChild) {
        target.firstElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Add temporary highlight
    diffNodes.forEach(n => n.classList.remove('nav-highlight'));
    // We need to highlight the actual cells.
    // Because we used display: contents on the row, we need a way to style segments.
    // Let's rely on the row class being shared or just style the numbers.
    updateDiffLabel();
}

function appendDiffLine(container, lineNum, content, type) {
    const div = document.createElement('div');
    div.className = `diff-line diff-${type}`;
    const sign = type === 'added' ? '+' : (type === 'removed' ? '-' : ' ');
    div.innerHTML = `
        <span class="line-num">${lineNum}</span>
        <span class="diff-sign">${sign}</span>
        <span class="line-content">${escapeHtml(content)}</span>
    `;
    container.appendChild(div);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Ignore List Management =====
async function openIgnoreList() {
    document.getElementById('ignore-modal').classList.remove('hidden');
    renderIgnoreList();
}

async function renderIgnoreList() {
    const container = document.getElementById('ignore-list-container');
    container.innerHTML = `<div class="loading-spinner"><i data-lucide="loader" class="spinning"></i></div>`;
    lucide.createIcons();

    try {
        const [ignoreRes, reportRes] = await Promise.all([
            fetch(`/api/ignore-list?project=${currentProject}&t=${Date.now()}`),
            fetch(`/api/report?project=${currentProject}&t=${Date.now()}`)
        ]);
        if (!ignoreRes.ok) throw new Error('Fetch ignore-list failed');
        const list = await ignoreRes.json();
        
        // Build a set of paths currently visible in report for cross-reference
        // (report already excludes ignored items, so we compare against the FULL report)
        // We need to know which ignored files WOULD appear if unignored
        // The simplest proxy: an ignored file is "effective" if it exists in report-data.json
        // Since we can't access raw report-data from frontend, we just show all entries.
        
        container.innerHTML = '';
        if (list.length === 0) {
            container.innerHTML = `<div class="empty-ignore-msg">${t('ignore_modal_empty')}</div>`;
            return;
        }

        // Show count
        const countDiv = document.createElement('div');
        countDiv.style.cssText = 'padding: 6px 12px; color: #888; font-size: 0.85em; border-bottom: 1px solid #eee;';
        countDiv.textContent = t('ignore_list_count', { count: list.length });
        container.appendChild(countDiv);

        list.sort().forEach(filePath => {
            const row = document.createElement('div');
            row.className = 'ignore-row';
            
            const pathSpan = document.createElement('span');
            pathSpan.className = 'file-path';
            pathSpan.textContent = filePath;
            
            const undoBtn = document.createElement('button');
            undoBtn.className = 'unignore-btn';
            undoBtn.textContent = t('btn_unignore');
            undoBtn.onclick = async () => {
                undoBtn.disabled = true;
                undoBtn.textContent = '…';
                await unignoreFile(filePath);
            };
            
            row.appendChild(pathSpan);
            row.appendChild(undoBtn);
            container.appendChild(row);
        });
    } catch (e) {
        container.innerHTML = `<div class="error-msg">${escapeHtml(t('ignore_list_load_error'))}</div>`;
        console.error('renderIgnoreList error:', e);
    }
}

async function toggleIgnore(filePath) {
    try {
        // Normalize slashes to backslashes for server consistency
        const normalizedPath = filePath.replace(/\//g, '\\');
        const res = await fetch(`/api/ignore?project=${currentProject}&file=${encodeURIComponent(normalizedPath)}`, { method: 'POST' });
        if (res.ok) {
            showToast(t('toast_ignored'), "info");
            // Refresh data to reflect filtering immediately
            await fetchData();
        }
    } catch (e) {
        showToast(t('toast_request_fail'), "error");
    }
}

async function unignoreFile(filePath) {
    try {
        const normalizedPath = filePath.replace(/\//g, '\\');
        const res = await fetch(`/api/unignore?project=${currentProject}&file=${encodeURIComponent(normalizedPath)}`, { method: 'POST' });
        if (res.ok) {
            showToast(t('toast_unignored'), "info");
            // Refresh both the ignore list modal AND the main report data
            await Promise.all([
                renderIgnoreList(),
                fetchData()
            ]);
        } else {
            showToast(t('toast_unignore_fail'), "error");
        }
    } catch (e) {
        console.error("Failed to unignore", e);
        showToast(t('toast_error'), "error");
    }
}

async function ignoreAllAddedFiles() {
    console.log('[ignoreAllAddedFiles] called. allData type:', typeof allData, 'isArray:', Array.isArray(allData), 'length:', allData?.length);
    
    if (!allData || !Array.isArray(allData) || allData.length === 0) {
        showToast(t('toast_no_added_files'), 'info');
        return;
    }
    
    const addedFiles = allData.filter(item => item.type === 'ADDED').map(item => item.path);
    console.log('[ignoreAllAddedFiles] Added files found:', addedFiles.length);
    
    if (addedFiles.length === 0) {
        showToast(t('toast_no_added_files'), 'info');
        return;
    }
    
    try {
        const res = await fetch(`/api/ignore-bulk?project=${currentProject}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: addedFiles })
        });
        if (res.ok) {
            const result = await res.json();
            console.log('[ignoreAllAddedFiles] Bulk ignore result:', result);
            showToast(t('toast_ignored_bulk', { count: addedFiles.length }), 'success');
            await fetchData();
        } else {
            showToast(t('toast_bulk_fail'), 'error');
        }
    } catch (e) {
        console.error('[ignoreAllAddedFiles] Error:', e);
        showToast(t('toast_error'), 'error');
    }
}
