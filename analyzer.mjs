import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import crypto from 'crypto';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

// Resolve project from CLI args: node analyzer.mjs <projectId>
const projectId = process.argv[2] || config.default_project;
const projectDir = path.join('projects', projectId);
const projectConfig = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));

const STANDARD_DIR = path.join(projectDir, projectConfig.standard_dir);
const CUSTOMIZED_DIR = path.join(projectDir, projectConfig.customized_dir);
const REPORT_FILE = path.join(projectDir, 'report-data.json');
const STATUS_FILE = path.join(projectDir, 'status.json');

// Classpath: 项目根（DecompilerCLI.class）+ jd-core.jar；execFileSync 避免 Windows shell 转义问题
const ROOT = process.cwd();
const jarRaw = config.java?.jd_core_jar || 'lib/jd-core.jar';
const jdCoreJarAbs = path.isAbsolute(jarRaw) ? path.normalize(jarRaw) : path.resolve(ROOT, jarRaw);
const DECOMPILER_CP = `${ROOT}${path.delimiter}${jdCoreJarAbs}`;

function formatExecError(e) {
    const out = [];
    if (e.stderr) out.push(Buffer.from(e.stderr).toString('utf8'));
    if (e.stdout) out.push(Buffer.from(e.stdout).toString('utf8'));
    return (out.join('\n').trim() || e.message || String(e)).trim();
}

function runDecompilerCli(inputClassPath, outputJavaPath) {
    execFileSync('java', ['-cp', DECOMPILER_CP, 'DecompilerCLI', inputClassPath, outputJavaPath], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
}

const ARCHIVE_PATH = projectConfig.archive_path;
const IGNORE_FILE = path.join(projectDir, 'ignore.json');

// Cumulative log buffer - no messages lost between polls
let statusLogs = [];

// Load ignore list
let ignoreList = [];
if (fs.existsSync(IGNORE_FILE)) {
    try {
        ignoreList = JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf-8'));
    } catch (e) {
        console.warn(`Failed to load ignore list: ${e.message}`);
    }
}

function saveStatus(data) {
    if (data.log) {
        statusLogs.push(data.log);
    }
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
        status: data.status,
        progress: data.progress,
        currentFile: data.currentFile,
        logs: statusLogs,
        logCount: statusLogs.length,
        timestamp: new Date().toISOString()
    }, null, 2));
}

function getRelativePath(absolutePath, baseDir) {
    return path.relative(baseDir, absolutePath);
}

function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });
    return arrayOfFiles;
}

function getFileHash(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
}

// ==== Encoding Utility ====
function readFileWithEncoding(filePath) {
    const buffer = fs.readFileSync(filePath);
    const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
    const shiftJisDecoder = new TextDecoder('shift_jis', { fatal: false });
    
    // Decode as UTF-8
    const textUtf8 = utf8Decoder.decode(buffer);
    
    // If TextDecoder encounters an invalid UTF-8 sequence, it inserts a replacement character U+FFFD ()
    if (textUtf8.includes('\uFFFD')) {
        // Fallback to Shift_JIS if UTF-8 fails (common in legacy JP environments)
        return shiftJisDecoder.decode(buffer);
    }
    
    return textUtf8;
}

// Analysis functions removed - moving to Hash-only analysis.

// ===== Main Analysis Loop =====
async function analyze() {
    console.log(`Starting analysis for project: ${projectId}...`);
    const standardFiles = getAllFiles(STANDARD_DIR);
    const customizedFiles = getAllFiles(CUSTOMIZED_DIR);

    const results = [];
    const processedFiles = new Set();

    saveStatus({ status: 'analyzing', progress: 1, currentFile: '準備完了', log: 'OneREE エンジンが起動しました。ファイル差分をスキャン中...' });

    let count = 0;
    const total = customizedFiles.length;

    for (const customPath of customizedFiles) {
        count++;
        const relativePath = getRelativePath(customPath, CUSTOMIZED_DIR);
        const fileName = path.basename(customPath);
        const progress = Math.round((count / total) * 100);

        saveStatus({
            status: 'analyzing', progress, currentFile: relativePath,
            log: `処理中 ${count}/${total}: ${fileName}`
        });

        processedFiles.add(relativePath);
        if (ignoreList.includes(relativePath)) {
            continue;
        }

        const standardPath = path.join(STANDARD_DIR, relativePath);

        let type = 'MODIFIED';
        let diff = '';

        const ext = path.extname(fileName).toLowerCase();
        // High-frequency binary/noise files that definitely don't need code analysis
        const skipAnalysis = [
            '.db', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', 
            '.idx', '.bin', '.dat', '.obj', '.exe', '.dll', '.so', '.jar', '.war',
            '.thumbs.db', '.thumb', '.tmp', '.bak'
        ].includes(ext) || fileName.toLowerCase() === 'thumbs.db';

        if (!fs.existsSync(standardPath)) {
            type = 'ADDED';
            diff = 'New File';
        } else {
            const customHash = getFileHash(customPath);
            const standardHash = getFileHash(standardPath);

            if (customHash === standardHash) {
                continue;
            }

            let standardCode = '';
            let customCode = '';
            let detailList = skipAnalysis ? [] : ['Hash mismatch detected. Detailed comparison available in code view.'];

            // Attempt to read as text unless it's a known binary extension
            if (!skipAnalysis) {
                if (fileName.endsWith('.class')) {
                    console.log(`Decompiling ${relativePath}...`);
                    saveStatus({ status: 'analyzing', progress, currentFile: relativePath, log: `${fileName} を逆コンパイル中...` });
                    try {
                        const cliClass = path.join(ROOT, 'DecompilerCLI.class');
                        if (!fs.existsSync(jdCoreJarAbs)) {
                            throw new Error(
                                `jd-core jar not found: ${jdCoreJarAbs}. Place jd-core jar in lib/ (e.g. lib/jd-core.jar) or set java.jd_core_jar to an absolute path in config.json.`
                            );
                        }
                        if (!fs.existsSync(cliClass)) {
                            throw new Error(
                                `DecompilerCLI.class not found in project root. Compile: javac -cp "${jdCoreJarAbs}" DecompilerCLI.java`
                            );
                        }
                        const customDecompiled = path.join(ROOT, 'temp_custom.java');
                        const standardDecompiled = path.join(ROOT, 'temp_std.java');
                        runDecompilerCli(customPath, customDecompiled);
                        runDecompilerCli(standardPath, standardDecompiled);
                        customCode = readFileWithEncoding(customDecompiled);
                        standardCode = readFileWithEncoding(standardDecompiled);
                        diff = '[Decompiled Code Differences]';
                    } catch (e) {
                        const errText = formatExecError(e);
                        console.error(`Decompile failed for ${relativePath}:`, errText);
                        diff = '[Decompilation Failed]';
                        detailList = [
                            'Hash mismatch detected.',
                            `Decompilation failed: ${errText}`
                        ];
                    }
                } else {
                    try {
                        customCode = readFileWithEncoding(customPath);
                        standardCode = readFileWithEncoding(standardPath);
                        diff = '[Text Code Differences]';
                    } catch (e) {
                        diff = '[Binary/Special File]';
                    }
                }
            }

            results.push({
                id: results.length + 1, path: relativePath, name: fileName,
                type: (type === 'ADDED') ? 'ADDED' : 'MODIFIED', 
                diff: skipAnalysis ? '[Binary File]' : diff,
                requirement: skipAnalysis ? 'Binary file change detected.' : 'Source file modified (Hash mismatch).',
                detailedAnalysis: detailList,
                standardCode: skipAnalysis ? '' : standardCode,
                customCode: skipAnalysis ? '' : customCode,
                fullDiff: ''
            });

            // Incremental save every 10 files to keep the UI updated
            if (results.length % 10 === 0) {
                fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2));
            }
            continue;
        }

        // Only reached if file was added (and not caught in the continue above) or if it's a deleted file loop later
        if (type === 'ADDED') {
            results.push({
                id: results.length + 1, path: relativePath, name: fileName,
                type: 'ADDED', diff: 'New File', 
                requirement: skipAnalysis ? "New binary file added." : "New source file added.", 
                fullDiff: ""
            });
            if (results.length % 10 === 0) {
                fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2));
            }
        }
    }

    // Identify deleted files
    for (const stdPath of standardFiles) {
        const relativePath = getRelativePath(stdPath, STANDARD_DIR);
        if (ignoreList.includes(relativePath)) continue;
        if (!processedFiles.has(relativePath)) {
            results.push({
                id: results.length + 1, path: relativePath, name: path.basename(stdPath),
                type: 'DELETED', diff: 'File Removed',
                requirement: "Standard feature removed in customization.", fullDiff: ""
            });
        }
    }

    fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2));
    console.log(`Analysis complete. Found ${results.length} changes.`);
    saveStatus({ status: 'done', progress: 100, currentFile: '完了', log: '分析完了！' });
}

analyze().catch(err => {
    console.error(err);
    saveStatus({ status: 'done', progress: 100, currentFile: 'エラー', log: `Error: ${err.message}` });
});
