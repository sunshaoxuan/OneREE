import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec, execFile, execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { runChecks } from './checker.mjs';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = config.app_port;

// Track active analysis processes per project
const analysisProcesses = new Map();

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.wasm': 'application/wasm'
};

const HRDB_SEARCH_ROOTS = config.external_paths?.hr_customized_roots || [];

const VERSION_KEYS = [
    'UhrSalary_Version',
    'UhrCore_Version',
    'UhrNencho_Version',
    'UhrShoteate_Version',
    'FrameVersion'
];

const UPDS_HR_ROOT = config.external_paths?.upds_hr_root || '';
const FRAMEWORK_ROOT = config.external_paths?.framework_root || '';

const HR_MODULES = [
    {
        versionKey: 'UhrSalary_Version',
        label: 'U-PDS HR Web給与明細',
        packageDir: 'U-PDS_HR_SALARY',
        installDir: path.join('モジュール', '新規インストールユーザ向け', 'U-HR')
    },
    {
        versionKey: 'UhrCore_Version',
        label: 'U-PDS HR 共通機能',
        packageDir: 'U-PDS_HR_COMMON',
        installDir: path.join('モジュール', '新規インストールユーザ向け', 'U-HR')
    },
    {
        versionKey: 'UhrNencho_Version',
        label: 'U-PDS HR 年末調整',
        packageDir: 'U-PDS_HR_NENCHO',
        installDir: path.join('モジュール', '新規インストールユーザ向け', 'U-HR')
    },
    {
        versionKey: 'UhrShoteate_Version',
        label: 'U-PDS HR 諸手当申請',
        packageDir: 'U-PDS_HR_SHOTEATE',
        installDir: path.join('モジュール', '新規インストールユーザ向け', '差分')
    }
];

function normalizeProjectName(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .toLowerCase();
}

function findProjectById(projectId) {
    return getProjects().find(p => p.id === projectId);
}

function getProjectDir(projectId) {
    return path.join(__dirname, 'projects', projectId);
}

function writeVersionResult(projectId, result) {
    const outputPath = path.join(getProjectDir(projectId), 'version-check-result.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
}

function resetErrorLog(projectId) {
    const errorPath = path.join(getProjectDir(projectId), 'error.json');
    if (fs.existsSync(errorPath)) {
        fs.unlinkSync(errorPath);
    }
}

function writeErrorLog(projectId, errors) {
    if (!errors.length) return;
    const errorPath = path.join(getProjectDir(projectId), 'error.json');
    fs.writeFileSync(errorPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        errors
    }, null, 2), 'utf-8');
}

function formatStepError(step, error, extra = {}) {
    return {
        step,
        message: error?.message || String(error),
        ...extra
    };
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve(text ? JSON.parse(text) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function toProjectId(englishName) {
    let base = String(englishName || '').trim();
    const universityOf = base.match(/^University of\s+(.+)$/i);
    if (universityOf) {
        base = universityOf[1];
    } else {
        base = base.replace(/\s+University$/i, '');
    }
    base = base
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '');
    return base || `project${Date.now()}`;
}

async function lookupEnglishName(japaneseName) {
    const endpoint = 'https://www.wikidata.org/w/api.php';
    const params = new URLSearchParams({
        action: 'wbsearchentities',
        search: japaneseName,
        language: 'ja',
        uselang: 'en',
        format: 'json',
        origin: '*',
        limit: '5'
    });

    const response = await fetch(`${endpoint}?${params.toString()}`, {
        headers: {
            'User-Agent': 'OneREE/1.0'
        }
    });
    if (!response.ok) {
        throw new Error(`English name lookup failed: HTTP ${response.status}`);
    }
    const data = await response.json();
    const hit = (data.search || []).find(item => item.label && /[A-Za-z]/.test(item.label));
    if (!hit) {
        throw new Error(`English name not found for ${japaneseName}`);
    }
    return {
        name_en: hit.label,
        source: {
            provider: 'Wikidata',
            id: hit.id,
            description: hit.description || ''
        }
    };
}

function createProjectFromExample(projectId, japaneseName, englishName) {
    const projectsDir = path.join(__dirname, 'projects');
    const templateDir = path.join(projectsDir, 'example');
    const targetDir = path.join(projectsDir, projectId);

    if (!fs.existsSync(templateDir)) {
        throw new Error(`Template project not found: ${templateDir}`);
    }
    if (fs.existsSync(targetDir)) {
        const err = new Error(`Project already exists: ${projectId}`);
        err.code = 'PROJECT_EXISTS';
        throw err;
    }

    fs.cpSync(templateDir, targetDir, {
        recursive: true,
        errorOnExist: true,
        force: false
    });

    const projectConfig = {
        id: projectId,
        name: japaneseName,
        name_en: englishName,
        name_ja: japaneseName,
        standard_dir: 'standard',
        customized_dir: 'customized',
        archive_path: ''
    };
    fs.writeFileSync(path.join(targetDir, 'project.json'), JSON.stringify(projectConfig, null, 2), 'utf-8');
    return { targetDir, project: projectConfig };
}

function findHrdbFolder(projectName) {
    return findCustomizedFolder(projectName, '_hrdb');
}

function findHrapFolder(projectName) {
    return findCustomizedFolder(projectName, '_hrap');
}

function findCustomizedFolder(projectName, suffix) {
    const normalizedName = normalizeProjectName(projectName);
    const roots = [];
    const matches = [];

    for (const root of HRDB_SEARCH_ROOTS) {
        if (!fs.existsSync(root)) continue;
        roots.push(root);
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const normalizedFolder = normalizeProjectName(entry.name);
            if (!normalizedFolder.endsWith(suffix)) continue;
            if (!normalizedFolder.includes(normalizedName)) continue;
            const fullPath = path.join(root, entry.name);
            matches.push({
                name: entry.name,
                path: fullPath,
                modifiedTime: fs.statSync(fullPath).mtime.toISOString()
            });
        }
        if (matches.length > 0) break;
    }

    matches.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
    return { roots, matches, folder: matches[0] || null };
}

function readTextFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    if (utf8.includes('\uFFFD')) {
        return new TextDecoder('shift_jis', { fatal: false }).decode(buffer);
    }
    return utf8;
}

function parseSqlStringValues(valuesText) {
    const values = [];
    const re = /'((?:''|[^'])*)'/g;
    let match;
    while ((match = re.exec(valuesText)) !== null) {
        values.push(match[1].replace(/''/g, "'"));
    }
    return values;
}

function extractVersionValues(sqlText) {
    const versions = Object.fromEntries(VERSION_KEYS.map(key => [key, null]));
    const statementRe = /values\s*\(([\s\S]*?)\)\s*;/gi;
    let match;
    while ((match = statementRe.exec(sqlText)) !== null) {
        const values = parseSqlStringValues(match[1]);
        for (let i = 0; i < values.length - 1; i++) {
            if (VERSION_KEYS.includes(values[i])) {
                versions[values[i]] = values[i + 1];
            }
        }
    }
    return versions;
}

function versionToFrameworkCode(version) {
    return String(version || '').replace(/[^\d]/g, '');
}

function getMainVersion(version) {
    return String(version || '').split('+')[0].trim();
}

function getProjectPath(projectId, configuredPath, fallback) {
    const raw = configuredPath || fallback;
    return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(getProjectDir(projectId), raw);
}

function inferDeployDirName(projectId, project) {
    const customizedDir = getProjectPath(projectId, project.customized_dir, 'customized');
    const standardDir = getProjectPath(projectId, project.standard_dir, 'standard');
    for (const candidateDir of [customizedDir, standardDir]) {
        if (!fs.existsSync(candidateDir)) continue;
        const dirs = fs.readdirSync(candidateDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
        if (dirs.length === 1) return dirs[0].name;
    }
    return 'uhr';
}

function findHrModuleSource(module, rawVersion) {
    const version = getMainVersion(rawVersion);
    const expectedDirName = `V${version}(${module.label})`;
    const exactPath = path.join(UPDS_HR_ROOT, expectedDirName);
    const attemptedPaths = [exactPath];
    let releaseDir = null;

    if (fs.existsSync(exactPath)) {
        releaseDir = exactPath;
    } else if (fs.existsSync(UPDS_HR_ROOT)) {
        const normalizedExpected = normalizeProjectName(expectedDirName);
        const matches = fs.readdirSync(UPDS_HR_ROOT, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .filter(entry => normalizeProjectName(entry.name) === normalizedExpected)
            .map(entry => path.join(UPDS_HR_ROOT, entry.name));
        releaseDir = matches[0] || null;
    }

    if (!releaseDir) {
        throw new Error(`HR module release folder not found: ${expectedDirName}`);
    }

    const sourceDir = path.join(releaseDir, 'cd', module.packageDir, module.installDir);
    attemptedPaths.push(sourceDir);
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`HR module install folder not found: ${sourceDir}`);
    }

    return {
        versionKey: module.versionKey,
        version,
        label: module.label,
        releaseDir,
        sourceDir,
        attemptedPaths
    };
}

function copyDirectoryContents(sourceDir, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    const result = spawnSync('robocopy.exe', [
        sourceDir,
        targetDir,
        '/E',
        '/COPY:DAT',
        '/R:1',
        '/W:1',
        '/NFL',
        '/NDL',
        '/NJH',
        '/NJS',
        '/NP'
    ], {
        windowsHide: true,
        encoding: 'utf8'
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status > 7) {
        throw new Error(`robocopy failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    return fs.readdirSync(sourceDir, { withFileTypes: true }).length;
}

function applyHrModulePackages(projectId, project, versions) {
    const standardDir = getProjectPath(projectId, project.standard_dir, 'standard');
    const deployDirName = inferDeployDirName(projectId, project);
    const targetDir = path.join(standardDir, deployDirName);

    const applied = [];
    const errors = [];

    for (const module of HR_MODULES) {
        const rawVersion = versions[module.versionKey];
        try {
            if (!rawVersion) {
                throw new Error(`Version value not found: ${module.versionKey}`);
            }

            const source = findHrModuleSource(module, rawVersion);
            const copiedEntryCount = copyDirectoryContents(source.sourceDir, targetDir);
            applied.push({
                ...source,
                targetDir,
                copiedEntryCount
            });
        } catch (e) {
            errors.push(formatStepError('hr-module-copy', e, {
                versionKey: module.versionKey,
                label: module.label,
                version: rawVersion || null
            }));
        }
    }

    return { applied, errors };
}

function copyHrapUhrToCustomized(projectId, project, projectName) {
    const hrap = findHrapFolder(projectName);
    if (!hrap.folder) {
        throw new Error('HRAP folder not found');
    }

    const sourceDir = path.join(hrap.folder.path, 'uhr');
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`HRAP uhr folder not found: ${sourceDir}`);
    }

    const customizedDir = getProjectPath(projectId, project.customized_dir, 'customized');
    const targetDir = path.join(customizedDir, 'uhr');
    const copiedEntryCount = copyDirectoryContents(sourceDir, targetDir);

    return {
        hrapFolder: hrap.folder,
        sourceDir,
        targetDir,
        copiedEntryCount
    };
}

function findFrameworkWar(frameVersion) {
    const frameworkCode = versionToFrameworkCode(frameVersion);
    const attemptedPaths = [];

    for (const root of [FRAMEWORK_ROOT].filter(Boolean)) {
        const tomcatDir = path.join(
            root,
            `v${frameVersion}`,
            'フルセットリリース',
            `SmartCompany${frameworkCode}`,
            'モジュール',
            'フレームワーク',
            'Tomcat用'
        );
        attemptedPaths.push(tomcatDir);
        if (!fs.existsSync(tomcatDir)) continue;

        const wars = fs.readdirSync(tomcatDir, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.war'))
            .map(entry => {
                const fullPath = path.join(tomcatDir, entry.name);
                const stat = fs.statSync(fullPath);
                return {
                    name: entry.name,
                    path: fullPath,
                    size: stat.size,
                    modifiedTime: stat.mtime.toISOString()
                };
            })
            .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

        if (wars.length > 0) {
            return {
                frameworkVersion: frameVersion,
                frameworkCode,
                tomcatDir,
                war: wars[0],
                attemptedPaths
            };
        }
    }

    return {
        frameworkVersion: frameVersion,
        frameworkCode,
        tomcatDir: null,
        war: null,
        attemptedPaths
    };
}

function copyAndExtractFrameworkWar(projectId, project, frameVersion) {
    const framework = findFrameworkWar(frameVersion);
    if (!framework.war) {
        return {
            ...framework,
            copiedWarPath: null,
            extractPath: null,
            error: 'Framework Tomcat war not found'
        };
    }

    const standardDir = getProjectPath(projectId, project.standard_dir, 'standard');
    const deployDirName = inferDeployDirName(projectId, project);
    const extractPath = path.join(standardDir, deployDirName);
    fs.mkdirSync(standardDir, { recursive: true });
    fs.mkdirSync(extractPath, { recursive: true });

    const copiedWarPath = path.join(standardDir, framework.war.name);
    fs.copyFileSync(framework.war.path, copiedWarPath);

    execFileSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '& { param($war,$dest) Microsoft.PowerShell.Archive\\Expand-Archive -LiteralPath $war -DestinationPath $dest -Force }',
        copiedWarPath,
        extractPath
    ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    return {
        ...framework,
        copiedWarPath,
        extractPath,
        deployDirName
    };
}

// Discover projects from filesystem
function getProjects() {
    const projectsDir = path.join(__dirname, 'projects');
    if (!fs.existsSync(projectsDir)) return [];
    return fs.readdirSync(projectsDir)
        .filter(d => fs.statSync(path.join(projectsDir, d)).isDirectory())
        .map(d => {
            const configPath = path.join(projectsDir, d, 'project.json');
            if (fs.existsSync(configPath)) {
                return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
            return { id: d, name: d };
        })
        // projects/example 仅作仓库目录结构参考，不参与本地下拉与选择
        .filter(p => p.id !== 'example');
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // ===== API Routes =====

    if (pathname === '/api/projects' && req.method === 'GET') {
        const projects = getProjects();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(projects));
        return;
    }

    if (pathname === '/api/projects/create-from-name' && req.method === 'POST') {
        try {
            const body = await readJsonBody(req);
            const japaneseName = String(body.name || '').trim();
            if (!japaneseName) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Project name is required' }));
                return;
            }

            let lookup = null;
            const errors = [];
            try {
                lookup = await lookupEnglishName(japaneseName);
            } catch (e) {
                errors.push(formatStepError('english-name-lookup', e, { projectName: japaneseName }));
                lookup = { name_en: japaneseName, source: null };
            }

            const projectId = toProjectId(lookup.name_en);
            const created = createProjectFromExample(projectId, japaneseName, lookup.name_en);
            if (errors.length) {
                writeErrorLog(projectId, errors);
            }

            res.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({
                ...created,
                lookupSource: lookup.source,
                errors
            }, null, 2));
        } catch (e) {
            const status = e.code === 'PROJECT_EXISTS' ? 409 : 500;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (pathname === '/api/version-check' && req.method === 'GET') {
        const projectId = url.searchParams.get('project') || config.default_project;
        const project = findProjectById(projectId);

        if (!project) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Project not found', projectId }));
            return;
        }

        resetErrorLog(projectId);

        try {
            const projectName = project.name || project.name_ja || project.name_en || project.id;
            const hrdb = findHrdbFolder(projectName);
            if (!hrdb.folder) {
                writeErrorLog(projectId, [
                    formatStepError('hrdb-folder-search', new Error('HRDB folder not found'), {
                        projectName,
                        searchedRoots: hrdb.roots,
                        matchedFolders: hrdb.matches
                    })
                ]);
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    projectId,
                    projectName,
                    error: 'HRDB folder not found',
                    searchedRoots: hrdb.roots,
                    matchedFolders: hrdb.matches
                }));
                return;
            }

            const sqlPath = path.join(hrdb.folder.path, 'ddl_and_master_data', 'MASTER_DATA', 'CONF_SYSCONTROL.SQL');
            if (!fs.existsSync(sqlPath)) {
                writeErrorLog(projectId, [
                    formatStepError('syscontrol-sql-search', new Error('CONF_SYSCONTROL.SQL not found'), {
                        projectName,
                        hrdbFolder: hrdb.folder,
                        sqlPath
                    })
                ]);
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    projectId,
                    projectName,
                    hrdbFolder: hrdb.folder,
                    error: 'CONF_SYSCONTROL.SQL not found',
                    sqlPath
                }));
                return;
            }

            const versions = extractVersionValues(readTextFile(sqlPath));
            const result = {
                projectId,
                projectName,
                hrdbFolder: hrdb.folder,
                sqlPath,
                versions
            };
            writeVersionResult(projectId, result);

            const errors = [];
            try {
                copyHrapUhrToCustomized(projectId, project, projectName);
            } catch (e) {
                errors.push(formatStepError('hrap-uhr-copy', e, {
                    projectName
                }));
                writeErrorLog(projectId, errors);
            }

            try {
                if (!versions.FrameVersion) {
                    throw new Error('FrameVersion not found');
                }
                const frameworkPackage = copyAndExtractFrameworkWar(projectId, project, versions.FrameVersion);
                if (frameworkPackage.error) {
                    throw new Error(frameworkPackage.error);
                }
            } catch (e) {
                errors.push(formatStepError('framework-copy-extract', e, {
                    versionKey: 'FrameVersion',
                    version: versions.FrameVersion || null
                }));
                writeErrorLog(projectId, errors);
            }

            const hrModuleResult = applyHrModulePackages(projectId, project, versions);
            errors.push(...hrModuleResult.errors);
            writeErrorLog(projectId, errors);

            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(result, null, 2));
        } catch (e) {
            console.error(`[API ERROR] /api/version-check failed for ${projectId}:`, e.message);
            writeErrorLog(projectId, [
                formatStepError('version-check', e)
            ]);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error', message: e.message }));
        }
        return;
    }

    if (pathname === '/api/analyze' && req.method === 'POST') {
        const projectId = url.searchParams.get('project') || config.default_project;
        const statusPath = path.join(__dirname, 'projects', projectId, 'status.json');

        // Check if already running
        if (fs.existsSync(statusPath)) {
            const currentStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
            if (currentStatus.status === 'analyzing') {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Already running', status: currentStatus }));
                return;
            }
        }

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Analysis started', project: projectId }));

        const child = execFile(process.execPath, ['analyzer.mjs', projectId], { cwd: __dirname }, (error, stdout, stderr) => {
            analysisProcesses.delete(projectId);
            if (error) {
                console.error(`Analysis failed for ${projectId}: ${error.message}`);
                if (stderr) console.error(stderr);
                return;
            }
            console.log(`Analysis output [${projectId}]: ${stdout}`);
        });

        analysisProcesses.set(projectId, child);
        return;
    }

    if (pathname === '/api/stop-analyze' && req.method === 'POST') {
        const projectId = url.searchParams.get('project') || config.default_project;
        const child = analysisProcesses.get(projectId);

        if (child) {
            // Kill process tree on Windows/Unix
            const killCmd = process.platform === 'win32' ? `taskkill /pid ${child.pid} /f /t` : `kill -9 ${child.pid}`;
            exec(killCmd, (err) => {
                if (err) console.error(`Failed to kill process ${child.pid}: ${err.message}`);
                else console.log(`Killed analysis process ${child.pid} for ${projectId}`);
            });
            analysisProcesses.delete(projectId);
        } else if (process.platform === 'win32') {
            // Orphaned process fallback for Windows: kill by command line matching
            console.log(`No active child handle for ${projectId}. Searching for orphaned analyzer processes...`);
            const orphanKillCmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = 'node.exe'\\" | Where-Object { $_.CommandLine -like '*analyzer.mjs ${projectId}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;
            exec(orphanKillCmd, (err) => {
                if (err) console.error(`Orphan kill failed: ${err.message}`);
                else console.log(`Orphaned analyzer processes for ${projectId} (if any) have been terminated.`);
            });
        }

        // Force status back to idle
        const statusPath = path.join(__dirname, 'projects', projectId, 'status.json');
        if (fs.existsSync(statusPath)) {
            const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
            status.status = 'idle';
            status.progress = 0;
            status.currentFile = '中止';
            status.logs.push('分析がユーザーによって中止されました。');
            fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Analysis stopped' }));
        return;
    }

    if (pathname === '/api/status' && req.method === 'GET') {
        const projectId = url.searchParams.get('project') || config.default_project;
        const statusPath = path.join(__dirname, 'projects', projectId, 'status.json');
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        if (fs.existsSync(statusPath)) {
            res.end(fs.readFileSync(statusPath));
        } else {
            res.end(JSON.stringify({ status: 'idle' }));
        }
        return;
    }

    if (pathname === '/api/report' && req.method === 'GET') {
        const projectId = url.searchParams.get('project') || config.default_project;
        const reportPath = path.join(__dirname, 'projects', projectId, 'report-data.json');
        const ignorePath = path.join(__dirname, 'projects', projectId, 'ignore.json');
        
        try {
            if (fs.existsSync(reportPath)) {
                let data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
                const totalBeforeFilter = data.length;
                // Filter out ignored files dynamically
                if (fs.existsSync(ignorePath)) {
                    const ignoreList = JSON.parse(fs.readFileSync(ignorePath, 'utf-8'));
                    // Normalize: backslashes + lowercase for robust Windows comparison
                    const normalize = p => (p || '').replace(/\//g, '\\').toLowerCase();
                    const ignoreSet = new Set(ignoreList.map(normalize));
                    data = data.filter(item => !ignoreSet.has(normalize(item.path)));
                }
                console.log(`[API] Report for ${projectId}: ${totalBeforeFilter} total, ${data.length} after ignore filter`);
                res.writeHead(200, { 
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store, no-cache, must-revalidate',
                    'Pragma': 'no-cache'
                });
                res.end(JSON.stringify(data));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Report not found' }));
            }
        } catch (e) {
            console.error(`[API ERROR] /api/report failed for ${projectId}:`, e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
        return;
    }

    if (pathname === '/api/ignore-list' && req.method === 'GET') {
        const projectId = url.searchParams.get('project') || config.default_project;
        const ignorePath = path.join(__dirname, 'projects', projectId, 'ignore.json');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        if (fs.existsSync(ignorePath)) {
            res.end(fs.readFileSync(ignorePath));
        } else {
            res.end(JSON.stringify([]));
        }
        return;
    }

    if (pathname === '/api/ignore' && req.method === 'POST') {
        const projectId = url.searchParams.get('project') || config.default_project;
        let file = url.searchParams.get('file');
        if (!file) {
            res.writeHead(400); res.end('Missing file'); return;
        }
        // Normalize slashes and case for Windows consistency
        file = file.replace(/\//g, '\\').toLowerCase();
        
        const ignorePath = path.join(__dirname, 'projects', projectId, 'ignore.json');
        let list = [];
        if (fs.existsSync(ignorePath)) {
            try {
                list = JSON.parse(fs.readFileSync(ignorePath, 'utf-8'));
            } catch(e) { list = []; }
        }
        
        // Check for existing entries using the same normalization logic
        const normalize = p => p.replace(/\//g, '\\').toLowerCase();
        const isDuplicate = list.some(f => normalize(f) === file);
        
        if (!isDuplicate) {
            list.push(file);
            fs.writeFileSync(ignorePath, JSON.stringify(list, null, 2));
            console.log(`[API] Ignored file (unique): ${file} for project ${projectId}`);
        }
        res.writeHead(200); res.end(JSON.stringify({ message: 'Ignored', list }));
        return;
    }

    if (pathname === '/api/ignore-bulk' && req.method === 'POST') {
        const projectId = url.searchParams.get('project') || config.default_project;
        console.log(`[API] Bulk ignore request received for project: ${projectId}`);
        let chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try {
                const body = Buffer.concat(chunks).toString('utf-8');
                const data = JSON.parse(body);
                const files = data.files || [];
                console.log(`[API] Processing bulk ignore for ${files.length} files.`);
                
                const ignorePath = path.join(__dirname, 'projects', projectId, 'ignore.json');
                let list = [];
                if (fs.existsSync(ignorePath)) list = JSON.parse(fs.readFileSync(ignorePath, 'utf-8'));
                
                let addedCount = 0;
                for (let file of files) {
                    file = file.replace(/\//g, '\\').toLowerCase(); // Normalize
                    if (!list.map(f => f.toLowerCase().replace(/\//g, '\\')).includes(file)) {
                        list.push(file);
                        addedCount++;
                    }
                }
                
                if (addedCount > 0) {
                    fs.writeFileSync(ignorePath, JSON.stringify(list, null, 2));
                    console.log(`[API] Successfully added ${addedCount} files to ignore list.`);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' }); 
                res.end(JSON.stringify({ message: 'Ignored batch', added: addedCount }));
            } catch (e) {
                console.error('[API ERROR] Bulk ignore failed:', e);
                res.writeHead(400); res.end('Invalid request');
            }
        });
        return;
    }

    if (pathname === '/api/unignore' && req.method === 'POST') {
        const projectId = url.searchParams.get('project') || config.default_project;
        let file = url.searchParams.get('file');
        if (file) file = file.replace(/\//g, '\\').toLowerCase(); // Normalize
        
        const ignorePath = path.join(__dirname, 'projects', projectId, 'ignore.json');
        if (fs.existsSync(ignorePath)) {
            let list = JSON.parse(fs.readFileSync(ignorePath, 'utf-8'));
            const originalLength = list.length;
            
            // Remove ALL entries that normalize to the same path
            const normalize = p => p.replace(/\//g, '\\').toLowerCase();
            list = list.filter(f => normalize(f) !== file);
            
            if (list.length !== originalLength) {
                fs.writeFileSync(ignorePath, JSON.stringify(list, null, 2));
                console.log(`[API] Unignored file (removed ${originalLength - list.length} entries): ${file} for project ${projectId}`);
            }
            res.writeHead(200); res.end(JSON.stringify({ message: 'Unignored', list }));
        } else {
            res.writeHead(200); res.end(JSON.stringify({ message: 'No ignore list' }));
        }
        return;
    }

    // ===== Static File Serving =====
    let filePath = '.' + pathname;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server internal error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Reset any stale "analyzing" status from crashed/killed processes
function resetStaleStatus() {
    const projectsDir = path.join(__dirname, 'projects');
    if (!fs.existsSync(projectsDir)) return;
    for (const dir of fs.readdirSync(projectsDir)) {
        const statusPath = path.join(projectsDir, dir, 'status.json');
        if (fs.existsSync(statusPath)) {
            try {
                const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
                if (status.status === 'analyzing') {
                    status.status = 'idle';
                    status.progress = 0;
                    status.currentFile = '';
                    if (status.logs) status.logs.push('サーバー再起動により分析状態がリセットされました。');
                    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
                    console.log(`⚠️  Reset stale analyzing status for project: ${dir}`);
                }
            } catch (e) { /* ignore parse errors */ }
        }
    }
}

// Run startup checks then start server
runChecks(config).then(() => {
    resetStaleStatus();
    server.listen(PORT, () => {
        console.log('=========================================');
        console.log(`🚀 OneREE Server v2 (Bulk Ignore Ready)`);
        console.log(`Running at http://localhost:${PORT}/`);
        console.log(`Default project: ${config.default_project}`);
        console.log('=========================================');
    });
});
