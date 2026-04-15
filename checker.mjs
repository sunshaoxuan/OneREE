import fs from 'fs';
import path from 'path';

export async function runChecks(config) {
    console.log("-----------------------------------------");
    console.log("   OneREE STARTUP: DEPENDENCY CHECKS     ");
    console.log("-----------------------------------------");

    const results = {};

    const root = process.cwd();
    if (config.java && config.java.jd_core_jar) {
        const jar = path.resolve(root, config.java.jd_core_jar);
        results.jd_core = checkPath(jar, 'jd-core (lib)');
    }

    // Optional remote endpoints (e.g. future integrations)
    if (config.nodes && typeof config.nodes === 'object') {
        for (const [key, node] of Object.entries(config.nodes)) {
            if (node.endpoint) {
                results[key] = await checkEndpoint(node.endpoint, node.label);
            }
        }
    }

    // Check project archive paths
    const projectsDir = './projects';
    if (fs.existsSync(projectsDir)) {
        const projects = fs.readdirSync(projectsDir).filter(d =>
            fs.statSync(`${projectsDir}/${d}`).isDirectory()
        );
        for (const pid of projects) {
            const pConfigPath = `${projectsDir}/${pid}/project.json`;
            if (fs.existsSync(pConfigPath)) {
                const pConfig = JSON.parse(fs.readFileSync(pConfigPath, 'utf-8'));
                if (pConfig.archive_path) {
                    results[`archive_${pid}`] = checkPath(pConfig.archive_path, `Archive [${pConfig.name}]`);
                }
            }
        }
    }

    console.log("-----------------------------------------");
    const allOk = Object.values(results).every(v => v);
    if (allOk) {
        console.log("✅ ALL DEPENDENCIES READY.");
    } else {
        console.warn("⚠️ SOME DEPENDENCIES UNAVAILABLE. LIMITED MODE.");
    }
    console.log("-----------------------------------------");
    return allOk;
}

async function checkEndpoint(url, label) {
    try {
        await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        console.log(`✅ ${label}: Connected`);
        return true;
    } catch (e) {
        try {
            await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
            console.log(`✅ ${label}: Connected`);
            return true;
        } catch (e2) {
            console.error(`❌ ${label}: Unreachable`);
            return false;
        }
    }
}

function checkPath(p, label) {
    try {
        if (fs.existsSync(p)) {
            console.log(`✅ ${label}: Accessible`);
            return true;
        } else {
            console.error(`❌ ${label}: Not Found`);
            return false;
        }
    } catch (e) {
        console.error(`❌ ${label}: Error - ${e.message}`);
        return false;
    }
}
