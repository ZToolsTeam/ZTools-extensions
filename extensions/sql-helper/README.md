# SQL格式化转换

在客户端本地进行 SQL 排版、MyBatis 日志参数核对、CREATE TABLE 字段模型生成。不会连接数据库或执行输入的 SQL。

搜索 `sql格式化`、`mybatis还原`、`ddl转实体` 可直接进入对应工具。按 Enter 载入剪贴板，按 ⌘/Ctrl+Enter 打开多行编辑器；编辑器里选择 SQL 方言后，用 ⌘/Ctrl+Enter 生成结果。搜索框只筛选输出格式，Enter 复制当前结果，Esc 取消编辑。三个工具各自保留本次打开期间的输入。

- **美化与精简**：只调整词法单元之间的空白，保留大小写、标识符、字符串和注释。行注释以及 PostgreSQL 的原有换行会保留，所以精简结果不保证只有一行。不是数据库语法检查器。
- **MyBatis**：粘贴同一次调用的完整 Preparing 和 Parameters 两行。数量不匹配、多组日志、续行、无法识别的类型或歧义均停止处理。只替换代码中的问号，跳过字符串和注释。输出是核对参考；日志没有无损转义协议，不能等价替代 JDBC 绑定参数。日期、时区、自定义类型尤其需要核对。
- **DDL 模型**：一次处理一张表，按括号层级和引号划分字段，支持单行与多行声明、常见类型和表级主键。生成 TypeScript interface、带 JSON/GORM 列标签的 Go struct、无需 Lombok 的 Java 类。SQL 方言和驱动影响实际字段类型，生成结果是可编辑的模型骨架，不是数据库迁移验证器。未知类型明确提示，无法识别的结构不生成半成品。
- bigint 和精确小数避免通过 JavaScript number 丢失精度；nullable 在 TS 使用 `| null`，Go 使用指针。MySQL `tinyint(1)`/BOOL 仍按整数映射，TIME 作为时长字符串。SQLite 整数按 64 位处理；普通表非整数主键仍可空，INTEGER rowid、STRICT、WITHOUT ROWID 另行判断。
- Go JSON/GORM 标签不能可靠表示的列名（如逗号、分号、引号、反斜杠或单独的 `-`）会阻止生成，请先采用明确的字段别名。不会悄悄修改 JSON 键名或添加 ORM 配置。

支持 MySQL 默认反斜杠转义、PostgreSQL 标准字符串、SQLite 三种词法模式。MySQL 使用 NO_BACKSLASH_ESCAPES / ANSI_QUOTES、PostgreSQL 关闭 standard_conforming_strings 等不同配置时，不要直接使用默认模式解释字面量。特殊数据库扩展、存储过程和完整约束校验不在字段模型提取范围内。

输入最大 256 KiB，SQL 最多 50,000 个词法单元、64 层括号，MyBatis 最多 500 个参数，模型最多 1,000 列。失败会提示原因；错误编辑不会覆盖已有有效内容，错误剪贴板输入会清除旧输出，避免把旧结果当成新结果复制。

## 平台与要求

- 支持：Windows、macOS

## 网络与数据

- 不联网，数据只保存在本机。

## 构建与验证

在插件仓库根目录执行：

```sh
node scripts/build-declarative.mjs sql-helper
node --test extensions/sql-helper/tests/*.test.mjs
```

测试使用 Node 22 的内置 SQLite，在内存数据库中执行合成 SQL 并对照表结构；项目 TypeScript 编译器检查模型。具备 Go/JDK 工具链时，还会实际编译 Go/Java 并验证 Go JSON 序列化；缺少工具链会输出未覆盖诊断，发布前需要在具备工具链的环境补验。测试不会访问用户数据库。

词法与类型参考：[PostgreSQL 词法结构](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)、[MySQL 字符串](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html)、[MySQL 数字类型](https://dev.mysql.com/doc/refman/8.4/en/numeric-type-syntax.html)、[SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html)、[MyBatis 日志实现](https://github.com/mybatis/mybatis-3/blob/master/src/main/java/org/apache/ibatis/logging/jdbc/BaseJdbcLogger.java)。
