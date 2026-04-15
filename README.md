# OneREE

客户化开发差异分析工具：对比「标准版」与「定制版」目录下的文件，生成变更报告（含哈希比对、可选 Java 反编译后的源码对比），通过 Web 界面浏览与筛选。

## 环境要求

- **Node.js**（建议 LTS，需支持 ES Module）
- 分析 **`.class`** 文件时：本机已安装 **JDK**，并在 `config.json` 中配置 **jd-core** 相关路径（见下文）

## 快速开始

1. 克隆仓库后，在项目根目录放置自己的 **`projects/`** 数据（本仓库默认不提交该目录，见下方说明）。
2. 按需编辑 **`config.json`**（端口、默认语言、Java 反编译路径等）。
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

## 配置说明（`config.json`）

| 字段 | 说明 |
|------|------|
| `app_port` | HTTP 服务端口 |
| `default_locale` | 默认界面语言：`ja` / `en` / `zh` |
| `default_project` | 默认项目 ID，对应 `projects/<id>/` |
| `java.jd_core_jar` | jd-core 的 jar 路径（用于反编译） |
| `java.decompiler_cp` | `java -cp` 的 classpath，需包含上述 jar 与当前目录下的 `DecompilerCLI` 编译产物 |

## 目录结构（概要）

| 路径 | 说明 |
|------|------|
| `server.mjs` | HTTP 静态资源与 API |
| `analyzer.mjs` | 分析任务（由 `/api/analyze` 触发） |
| `app.js` / `index.html` / `style.css` | 前端 |
| `i18n/*.json` | 多语言文案 |
| `DecompilerCLI.java` | 反编译命令行入口（需 `javac` 编译后与 jd-core 一起使用） |
| `scripts/free-port.ps1` | 释放 `app_port` 占用（由 `start.bat` 调用） |
| `scripts/stop-server.ps1` | 结束运行 `server.mjs` 的 Node 进程（由 `stop.bat` 调用） |
| `projects/` | **各项目数据（标准/定制目录、`project.json`、报告与状态等），体积较大，默认不纳入 Git** |

本地使用时，请在 `projects/<项目名>/` 下按既有约定放置 `project.json` 及 `standard` / `customized` 等目录。

## 许可证与归属

产品名：**OneREE**。公司名：**OneHR**（见页面页脚）。

若需二次开发或部署说明，可结合本仓库中的 `config.json` 与 `checker.mjs` 启动检查逻辑自行扩展。
