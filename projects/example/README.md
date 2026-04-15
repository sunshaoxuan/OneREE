# 示例项目（example）

本目录仅在 **GitHub 仓库**中作为 **`projects/<项目ID>/` 布局说明**；**不是**应用默认项目，本地开发无需使用本目录。

本目录为**空骨架**，用于对照说明目录结构。

- **`standard/`**：放置标准版（或升级前基线）源码树。
- **`customized/`**：放置客户化/定制版源码树。
- **`project.json`**：项目元数据；`archive_path` 可为空字符串（不做档案路径检查）。
- **`ignore.json`**：分析时忽略的路径列表（JSON 数组），可按需增删。

新建真实项目时，可复制本目录为 `projects/<你的项目ID>/`，修改 `project.json` 中的 `id` 与名称等字段，并在根目录 `config.json` 里将 `default_project` 指向该项目 ID。
