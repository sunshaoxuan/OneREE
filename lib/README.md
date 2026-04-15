# 第三方库（jd-core）

反编译 **`.class`** 文件依赖 **jd-core**（Java 反编译库）。请在本目录放置 jar 文件，并与根目录 **`config.json`** 中的 `java.jd_core_jar` 一致（默认文件名见 `config.example.json`）。

## 获取方式

- 使用 [java-decompiler/jd-core](https://github.com/java-decompiler/jd-core) 发行版构建产物，或从可信来源取得与项目兼容版本的 **`jd-core`** jar。
- 建议将文件命名为 **`jd-core.jar`** 放在本目录，这样无需改配置即可使用。

## 发行包

独立发行时请将 **`lib/`**（含 jd-core jar）与项目根目录 **`DecompilerCLI.class`**（由 `DecompilerCLI.java` 编译）一并打包；运行目录为项目根目录。
