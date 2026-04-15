# OneREE

客户化开发差异分析工具：对比「标准版」与「定制版」目录下的文件，生成变更报告（含哈希比对、可选 Java 反编译后的源码对比），通过 Web 界面浏览与筛选。

## 环境要求

- **Node.js**（建议 LTS，需支持 ES Module）
- 分析 **`.class`** 文件时：本机已安装 **JDK**；将 **jd-core** 的 jar 放入项目 **`lib/`**（见 `lib/README.md`），根目录 **`config.json`** 中 **`java.jd_core_jar`** 使用相对路径（默认 `lib/jd-core.jar`）；根目录需有 **`DecompilerCLI.class`**（由 `DecompilerCLI.java` 编译生成）。

## 快速开始

1. 克隆后复制配置模板并编辑（仓库不提交个人 **`config.json`**，避免本机路径进入版本库）：
   ```bat
   copy config.example.json config.json
   ```
   （Linux / macOS：`cp config.example.json config.json`）
   按需修改 `app_port`、`default_locale`、`default_project`。将 jd-core jar 放入 **`lib/`**（默认文件名 **`jd-core.jar`**，与 `java.jd_core_jar` 一致即可）。
2. 仓库已包含示例项目骨架 **`projects/example/`**（空 `standard/` / `customized/`）。可将真实源码放入对应目录，或复制该目录为新项目 ID 后修改 **`project.json`**。**除 `example` 外的本地项目目录默认不提交**（见 `.gitignore`）。
3. **Windows**：双击 **`start.bat`**，或在 **cmd** / **PowerShell** 中于项目根目录执行：
   ```bat
   .\start.bat
   ```
   启动前会由 **`scripts/free-port.ps1`** 读取 `config.json` 中的 `app_port`，若该端口已有进程在监听则先结束对应进程，再在新窗口中启动服务。**`start.bat` / `stop.bat` 与 `scripts/*.ps1` 仅使用英文提示**，避免在部分系统区域设置下因 UTF-8 批处理编码导致命令被截断（例如 `powershell` 被误解析为 `owershell`）。
4. 浏览器访问：**`http://127.0.0.1:<app_port>/`**（默认端口 `3000`）。

停止服务：关闭启动时打开的「OneREE Server」窗口，或运行 **`stop.bat`**。

命令行直接启动（不经过 bat）：

```bash
node server.mjs
```

## 配置说明（模板：`config.example.json` → 本地 `config.json`）

| 字段 | 说明 |
|------|------|
| `app_port` | HTTP 服务端口 |
| `default_locale` | 默认界面语言：`ja` / `en` / `zh` |
| `default_project` | 默认项目 ID，对应 `projects/<id>/` |
| `java.jd_core_jar` | jd-core jar 的**相对项目根目录的路径**（默认 `lib/jd-core.jar`）；运行时与项目根目录一起组成 `java -cp` classpath，无需再手写 `decompiler_cp` |

## 目录结构（概要）

| 路径 | 说明 |
|------|------|
| `server.mjs` | HTTP 静态资源与 API |
| `analyzer.mjs` | 分析任务（由 `/api/analyze` 触发） |
| `app.js` / `index.html` / `style.css` | 前端 |
| `i18n/*.json` | 多语言文案 |
| `lib/` | **必备第三方**：放置 `jd-core.jar`（名称可自定，与配置一致），详见 `lib/README.md` |
| `DecompilerCLI.java` | 反编译 CLI；在项目根执行 `javac -cp lib/jd-core.jar DecompilerCLI.java` 生成 `DecompilerCLI.class` |
| `scripts/free-port.ps1` | 释放 `app_port` 占用（由 `start.bat` 调用） |
| `scripts/stop-server.ps1` | 结束运行 `server.mjs` 的 Node 进程（由 `stop.bat` 调用） |
| `config.example.json` | 根配置模板；复制为 `config.json` 后本地修改 |
| `projects/example/` | **示例项目骨架**（`project.json`、`standard/`、`customized/`、`ignore.json`）；其余 `projects/*` 为本地数据，默认不提交 |

本地新增大体积项目时，在 `projects/<项目ID>/` 下放置 `project.json` 及 `standard` / `customized` 等；可参考 `projects/example/README.md`。

## 许可证与归属

产品名：**OneREE**。公司名：**OneHR**（见页面页脚）。

若需二次开发或部署说明，可结合 **`config.example.json`** 与 `checker.mjs` 启动检查逻辑自行扩展。
