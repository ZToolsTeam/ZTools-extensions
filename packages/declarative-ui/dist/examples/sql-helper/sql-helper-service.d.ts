import type { DdlParsedResult, FormattedSqlOutput, MyBatisParsedResult } from './types.js';
/**
 * 保护字符串字面量与注释，将 SQL 关键字转为大写并按子句换行对齐，同时输出单行压缩版
 */
export declare function formatAndMinifySql(rawSql: string): FormattedSqlOutput;
/**
 * 解析 MyBatis 日志中的 `Preparing:` 与 `Parameters:` 并拼合为完整可执行 SQL
 */
export declare function mergeMyBatisLog(rawLogText: string): MyBatisParsedResult;
/**
 * 解析 `CREATE TABLE` DDL 建表语句并一键生成 TypeScript / Go / Java 实体模型代码
 */
export declare function parseDdlToEntities(rawDdl: string): DdlParsedResult;
