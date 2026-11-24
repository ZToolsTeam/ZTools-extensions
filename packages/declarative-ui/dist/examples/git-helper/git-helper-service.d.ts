import type { CommitTypeItem, GitEmergencyItem, GitignoreStackTemplate } from './types.js';
export declare const GIT_EMERGENCY_DATABASE: GitEmergencyItem[];
export declare const COMMIT_TYPES: CommitTypeItem[];
export declare const GITIGNORE_STACK_TEMPLATES: GitignoreStackTemplate[];
/**
 * 大白话 + 拼音缩写容错检索 Git 救命锦囊
 */
export declare function searchGitEmergencies(query: string): GitEmergencyItem[];
/**
 * 安全转义 Shell 双引号参数中的特殊字符（`"`、`$`、`\n`、`` ` ``）
 */
export declare function escapeShellDoubleQuoted(raw: string): string;
/**
 * 构建符合 Conventional Commits 规范的提交文本与可执行 git commit 命令
 */
export declare function buildConventionalCommit(options: {
    type: string;
    scope?: string;
    subject: string;
    breaking?: boolean;
}): {
    isValid: boolean;
    message: string;
    gitCommand: string;
    validationHint?: string;
};
/**
 * 组合多个技术栈生成去重后的标准 `.gitignore` 文件内容
 */
export declare function generateGitignoreContent(selectedStackIds: string[], customRules?: string[]): {
    content: string;
    totalUniqueRules: number;
    selectedStacks: string[];
};
