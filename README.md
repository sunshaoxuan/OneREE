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
   按需修改 `app_port`、`default_locale`。**`default_project`** 请设为**你本地实际使用的项目 ID**（模板里写的是 `tsukuba`，请改成你的 `projects/<id>/` 目录名）。将 jd-core jar 放入 **`lib/`**（默认 **`jd-core.jar`**）。
2. **`projects/example/`** 仅在 **GitHub 仓库里**作为**目录结构示例**（空骨架），**不是默认开发项目**；本地日常开发在 **`projects/<你的项目ID>/`**（如 `tsukuba`）下进行即可，**不必**使用或保留 `example`。**除 `example` 外的本地项目目录默认不提交**（见 `.gitignore`）。
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
| `default_project` | 启动时默认选中的项目 ID，须对应 **`projects/<id>/`** 中已有目录；模板为 `tsukuba`，请改为你的真实项目 ID（**勿**填 `example`，`example` 仅供仓库内参考） |
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
| `projects/example/` | **仅仓库内参考骨架**（GitHub 展示用）；**不会出现在 Web 端项目下拉里**（`/api/projects` 已排除 `id` 为 `example` 的项）；其余 `projects/*` 为本地数据，默认不提交 |

本地在 `projects/<项目ID>/` 下放置 `project.json` 及 `standard` / `customized` 等；需要时也可参考 `projects/example/` 的布局说明。

## 最近改动 (Recent Changes)

- **后端解析增强**：
  - 引入 `report-enums.mjs` 标准化枚举，解耦逻辑判定与多语言显示。
  - `analyzer.mjs` 升级：支持通过 `requirementKey` 记录变更原因，增强对二进制文件与源码文件的自动识别逻辑。
- **前端体验优化**：
  - 加固「忽略列表」管理功能，修复操作确认对话框体验，并实现全量多语言支持。
  - `index.html` 文案精简：统一专业术语，如将 "Added" 明确为 "追加" 以符合项目语境。
- **国际化 (i18n)**：
  - 更新 `en.json` / `ja.json` / `zh.json`，补充变更类型与错误信息的详细翻译。
  - 改进字级 Diff 高亮逻辑的稳定性。

---
*Last Updated: 2026-04-15*
