import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
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
        });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // ===== API Routes =====

    if (pathname === '/api/projects' && req.method === 'GET') {
        const projects = getProjects();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(projects));
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

        const child = exec(`node analyzer.mjs ${projectId}`, { cwd: __dirname }, (error, stdout, stderr) => {
            analysisProcesses.delete(projectId);
            if (error) {
                console.error(`Analysis failed for ${projectId}: ${error.message}`);
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
