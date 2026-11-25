import React, { Action, ActionPanel, Color, Icon, List, useMemo, useState } from '../../index.js';
import { formatAndMinifySql, mergeMyBatisLog, parseDdlToEntities } from './sql-helper-service.js';
export * from './types.js';
export * from './sql-helper-service.js';
const DEFAULT_SQL_SAMPLE = "select u.id, u.user_name, o.order_no, o.pay_amount from t_user u left join t_order o on u.id = o.user_id where u.status = 1 and o.pay_amount > 100 order by o.created_at desc limit 20";
const DEFAULT_MYBATIS_SAMPLE = [
    '==>  Preparing: SELECT id, order_no, buyer_name, pay_amount, status FROM t_trade_order WHERE buyer_id = ? AND buyer_name = ? AND status IN (?, ?)',
    '==> Parameters: 1008699(Long), 张三(String), PAID(String), SHIPPED(String)'
].join('\n');
const DEFAULT_DDL_SAMPLE = `CREATE TABLE \`t_user_account\` (
  \`id\` bigint(20) NOT NULL COMMENT '主键雪花ID',
  \`username\` varchar(64) NOT NULL COMMENT '登录账号',
  \`balance\` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '账户可用余额',
  \`is_verified\` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否完成实名认证',
  \`created_at\` datetime DEFAULT NULL COMMENT '注册时间',
  PRIMARY KEY (\`id\`)
);`;
export function SqlHelperCommand(props = {}) {
    const defaultTab = props.initialTab ??
        (props.featureCode === 'mybatis-merge'
            ? 'mybatis'
            : props.featureCode === 'ddl-to-entity'
                ? 'ddl'
                : 'formatter');
    const [tab, setTab] = useState(defaultTab);
    const [searchText, setSearchText] = useState(props.initialSearchText ?? '');
    const formattedSqlResult = useMemo(() => formatAndMinifySql(tab === 'formatter' && searchText.trim() ? searchText : DEFAULT_SQL_SAMPLE), [tab, searchText]);
    const mybatisResult = useMemo(() => mergeMyBatisLog(tab === 'mybatis' && searchText.trim() ? searchText : DEFAULT_MYBATIS_SAMPLE), [tab, searchText]);
    const ddlResult = useMemo(() => parseDdlToEntities(tab === 'ddl' && searchText.trim() ? searchText : DEFAULT_DDL_SAMPLE), [tab, searchText]);
    return (React.createElement(List, { searchText: searchText, onSearchTextChange: setSearchText, searchBarPlaceholder: tab === 'formatter'
            ? '粘贴待美化或压缩的 SQL 语句（自动大写关键字并对齐缩进）...'
            : tab === 'mybatis'
                ? '粘贴包含 Preparing: 与 Parameters: 的 MyBatis 日志...'
                : '粘贴 CREATE TABLE 建表 DDL 语句一键生成 TS / Go / Java 实体...', searchBarAccessory: React.createElement(List.Dropdown, { value: tab, onChange: (v) => setTab(v), tooltip: "\u5207\u6362 SQL \u5DE5\u5177\u6A21\u5F0F" },
            React.createElement(List.Dropdown.Item, { title: "SQL \u667A\u80FD\u7F8E\u5316\u4E0E\u538B\u7F29", value: "formatter", icon: Icon.Document }),
            React.createElement(List.Dropdown.Item, { title: "MyBatis \u65E5\u5FD7\u53C2\u6570\u62FC\u5408", value: "mybatis", icon: Icon.Terminal }),
            React.createElement(List.Dropdown.Item, { title: "DDL \u8F6C TS/Go/Java \u5B9E\u4F53", value: "ddl", icon: Icon.Code })), isShowingDetail: true },
        tab === 'formatter' && (React.createElement(List.Section, { title: "SQL \u683C\u5F0F\u5316\u5BF9\u9F50\u4E0E\u5355\u884C\u538B\u7F29" },
            React.createElement(List.Item, { id: "sql-beautify-item", icon: Icon.Code, title: "\u6807\u51C6\u7F8E\u5316 SQL (\u5173\u952E\u5B57\u5927\u5199 \u00B7 \u5B50\u53E5\u7F29\u8FDB\u5BF9\u9F50)", subtitle: `${formattedSqlResult.lineCount} 行 · ${formattedSqlResult.charCount} 字符`, accessories: [{ tag: '已美化对齐' }], detail: React.createElement(List.Item.Detail, { markdown: `### 格式化 SQL 预览
\`\`\`sql
${formattedSqlResult.beautified}
\`\`\`

#### 单行压缩版 (Minified)
\`\`\`sql
${formattedSqlResult.minified}
\`\`\`
`, metadata: React.createElement(List.Item.Detail.Metadata, null,
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u5B57\u7B26\u957F\u5EA6", text: `${formattedSqlResult.charCount} 字符` }),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u683C\u5F0F\u5316\u884C\u6570", text: `${formattedSqlResult.lineCount} 行` }),
                        React.createElement(List.Item.Detail.Metadata.Separator, null),
                        React.createElement(List.Item.Detail.Metadata.Label, { title: "\u65B9\u8A00\u517C\u5BB9", text: "MySQL / PG / Standard SQL" })) }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7F8E\u5316\u540E SQL", content: formattedSqlResult.beautified }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5355\u884C\u538B\u7F29\u7248 SQL", content: formattedSqlResult.minified, shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })) }))),
        tab === 'mybatis' && (React.createElement(List.Section, { title: "MyBatis \u65E5\u5FD7\u95EE\u53F7\u53C2\u6570\u81EA\u52A8\u62FC\u5408\u8FD8\u539F" },
            React.createElement(List.Item, { id: "mybatis-merged-item", icon: mybatisResult.isSuccess ? Icon.CheckCircle : Icon.ExclamationMark, title: mybatisResult.isSuccess
                    ? '完整可执行 SQL（已完成类型转义与注入）'
                    : '请粘贴包含 Preparing 与 Parameters 的日志', subtitle: mybatisResult.paramCountDisplay, accessories: [
                    mybatisResult.hasCountMismatch
                        ? { tag: { value: '参数个数不匹配', color: Color.Red } }
                        : { tag: mybatisResult.isSuccess ? '拼合成功' : '待输入' }
                ], detail: React.createElement(List.Item.Detail, { markdown: mybatisResult.isSuccess
                        ? `### 还原后的可执行 SQL（已美化）
\`\`\`sql
${mybatisResult.beautifiedMergedSql}
\`\`\`

${mybatisResult.errorMessage ? `> **${mybatisResult.errorMessage}**\n` : ''}
#### 参数注入明细 (${mybatisResult.params.length} 项)
${mybatisResult.params
                            .map((p, i) => `${i + 1}. \`${p.injectedSqlPart}\` *(原值: ${p.value}, 类型: ${p.type})*`)
                            .join('\n')}
`
                        : `### 日志解析提示
> ${mybatisResult.errorMessage}
` }), actions: React.createElement(ActionPanel, null,
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u7F8E\u5316\u540E\u7684\u5B8C\u6574\u53EF\u6267\u884C SQL", content: mybatisResult.beautifiedMergedSql }),
                    React.createElement(Action.CopyToClipboard, { title: "\u590D\u5236\u5355\u884C\u5B8C\u6574\u53EF\u6267\u884C SQL", content: mybatisResult.mergedSql, shortcut: { modifiers: ['cmd'], key: 'c' } })) }))),
        tab === 'ddl' && (React.createElement(List.Section, { title: `DDL 建表语句转多语言模型（表名：${ddlResult.tableName}）` }, [
            {
                key: 'typescript',
                title: 'TypeScript Interface (bigint 安全映射 string)',
                fence: 'ts'
            },
            {
                key: 'golang',
                title: 'Go Struct (含 json 与 gorm column/comment 标签)',
                fence: 'go'
            },
            {
                key: 'java',
                title: 'Java POJO Entity (含 Lombok @Data 与 Javadoc 注释)',
                fence: 'java'
            }
        ].map((target) => (React.createElement(List.Item, { key: target.key, id: target.key, icon: Icon.Code, title: target.title, subtitle: `表 ${ddlResult.tableName} · 共 ${ddlResult.columns.length} 个字段`, accessories: [{ tag: target.key.toUpperCase() }], detail: React.createElement(List.Item.Detail, { markdown: `### ${target.title}
\`\`\`${target.fence}
${ddlResult.generatedCode[target.key]}
\`\`\`

#### 提取字段结构表
| 字段名 | 数据库类型 | 允许 NULL | 注释说明 |
| :--- | :--- | :--- | :--- |
${ddlResult.columns
                    .map((c) => `| \`${c.name}\` | \`${c.dbType}\` | ${c.nullable ? '是' : '否'} | ${c.comment || '-'} |`)
                    .join('\n')}
` }), actions: React.createElement(ActionPanel, null,
                React.createElement(Action.CopyToClipboard, { title: `复制 ${target.key.toUpperCase()} 实体代码`, content: ddlResult.generatedCode[target.key] })) })))))));
}
export default SqlHelperCommand;
