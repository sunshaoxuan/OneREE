# 第三方库（jd-core）

反编译 **`.class`** 文件**必须**有本目录下的 **jd-core** jar（仓库不附带该二进制）。若未放置，分析时反编译会失败，详情里会提示 `jd-core jar not found`。

**操作**：将 jd-core 的 jar 复制到本目录，命名为 **`jd-core.jar`**（或与 `config.json` 里 `java.jd_core_jar` 一致）。若 jar 放在其他盘，可在 `config.json` 中把 `java.jd_core_jar` 设为**绝对路径**。

## 获取方式

- 使用 [java-decompiler/jd-core](https://github.com/java-decompiler/jd-core) 发行版构建产物，或从可信来源取得与项目兼容版本的 **`jd-core`** jar。
- 建议将文件命名为 **`jd-core.jar`** 放在本目录，这样无需改配置即可使用。

## 发行包

独立发行时请将 **`lib/`**（含 jd-core jar）与项目根目录 **`DecompilerCLI.class`**（由 `DecompilerCLI.java` 编译）一并打包；运行目录为项目根目录。
