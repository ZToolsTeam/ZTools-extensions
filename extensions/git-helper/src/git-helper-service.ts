import type { CommitTypeItem, GitEmergencyItem, GitignoreStackTemplate } from './types.js'

export const GIT_EMERGENCY_DATABASE: GitEmergencyItem[] = [
  {
    id: 'undo-last-commit-keep-changes',
    title: '刚 commit 了，但想撤销这次提交并保留修改在工作区继续改',
    category: 'commit',
    categoryLabel: '提交后悔药',
    tags: ['撤销提交', '撤销commit', '保留代码', 'reset soft'],
    pinyinKeywords: ['chexiao', 'chexiaotijiao', 'huitui', 'huigun'],
    safetyLevel: '注意检查',
    difficulty: '小白推荐',
    primaryCommand: 'git branch backup/before-undo && git reset --soft HEAD~1',
    steps: [
      {
        title: '为当前提交建立恢复分支，再撤销最近一次尚未推送的提交',
        cmd: 'git branch backup/before-undo && git reset --soft HEAD~1',
        explain: '只适用于至少有两次提交的本地分支。恢复分支已存在时会停止，请另取新名字；不会覆盖旧恢复点。工作文件与暂存内容保持不变。'
      },
      {
        title: '若想同时取消 git add 退回未暂存状态（可选）',
        cmd: 'git reset --mixed HEAD',
        explain: '在上一步之后执行；只取消暂存，不再回退 HEAD。工作文件保留，原来的暂存划分会取消。'
      }
    ],
    principle:
      '先核对 git status 和 git log。只撤销一次未推送提交；已推送到共享分支的提交使用 revert。恢复分支保留原提交，不包含未提交文件的独立副本。',
    minGitVersion: 'Git 2.0+'
  },
  {
    id: 'amend-missing-file-or-message',
    title: '刚 commit 完发现漏提了一个文件，或者提交备注写错了',
    category: 'commit',
    categoryLabel: '提交后悔药',
    tags: ['漏提文件', '修改提交备注', 'amend', '追加文件'],
    pinyinKeywords: ['loutiwangjian', 'xiugaibeizhu', 'amend', 'zhuijia'],
    safetyLevel: '注意检查',
    difficulty: '小白推荐',
    primaryCommand: 'git status --short',
    steps: [
      {
        title: '把遗漏的文件加入暂存区并合并进上一次提交（不改备注）',
        cmd: 'git add -- "需要补交的文件路径"',
        explain: '把引号内替换为明确要补交的文件；再用 git diff --cached 检查全部暂存内容，避免把其他工作一起提交。'
      },
      {
        title: '确认暂存内容后，保存旧提交再补交（不改备注）',
        cmd: 'git branch backup/before-amend && git commit --amend --no-edit',
        explain: '只用于未推送提交。备份分支重名时停止，换新名字后重试；若只改备注，先核对暂存区，再单独使用 git commit --amend。'
      }
    ],
    principle: 'amend 会用一个新的 Commit 对象替换当前分支顶端的旧 Commit（仅限尚未 push 到公共分支时使用）。'
  },
  {
    id: 'recover-deleted-branch-or-hard-reset',
    title: '手滑执行了 git reset --hard 或误删了本地未合并分支，想找回代码',
    category: 'reset',
    categoryLabel: '绝境抢救',
    tags: ['恢复误删分支', '找回代码', 'reflog', 'reset hard恢复'],
    pinyinKeywords: ['huifufenzhi', 'wushanfenzhi', 'zhaohuidaima', 'reflog'],
    safetyLevel: '安全无损',
    difficulty: '中等',
    primaryCommand: 'git reflog',
    steps: [
      {
        title: '第一步：查看本地所有 HEAD 历史移动轨迹，找到翻车前的短哈希（如 a1b2c3d）',
        cmd: 'git reflog -n 20',
        explain: '从日志中确认要恢复的提交。记录可能已过期或被清理，未提交的文件修改通常不能依靠 reflog 找回。'
      },
      {
        title: '第二步：基于翻车前的 commit 哈希新建或恢复分支',
        cmd: 'git branch recovered-branch "确认后的提交哈希"',
        explain: '将引号内替换为已核对的提交哈希，仅创建恢复分支，不切换或改写当前工作文件；不要假定 HEAD@{1} 就是正确版本。'
      }
    ],
    principle:
      'Git 的提交对象一旦生成就是不可变的，只要未触发过期 GC，reflog 就是时光机黑匣子。'
  },
  {
    id: 'committed-to-wrong-branch',
    title: '本来应该在新分支开发，结果不小心直接 commit 到了 main/master 分支',
    category: 'branch',
    categoryLabel: '分支纠错',
    tags: ['提交错分支', '移花接木', '挪移提交', 'master误提交'],
    pinyinKeywords: ['tijiaocuofenzhi', 'fenzhicuowu', 'nuoyitijiao'],
    safetyLevel: '注意检查',
    difficulty: '中等',
    primaryCommand: 'git switch -c feat/new-work',
    steps: [
      {
        title: '第一步：新建并切换到工作分支，保留提交和当前修改',
        cmd: 'git switch -c feat/new-work',
        explain: '新名字不能与已有分支重复。原分支暂时保留，不触碰工作区。'
      },
      {
        title: '第二步：核对分支与提交关系，再决定如何处理原分支',
        cmd: 'git log --oneline --decorate --all -n 10',
        explain: '当前工作已转到新分支。原分支若已共享，使用 revert；若尚未推送，核对要保留的提交后再调整原分支，不直接运行硬重置。'
      }
    ],
    principle: '先建立新分支保护工作，再核对原分支是否已经共享。这里不会自动清理原分支的提交；git switch 需要 Git 2.23 或更新版本。'
  },
  {
    id: 'undo-messy-git-pull-merge',
    title: '刚执行了 git pull 或 merge 结果冲突一团糟，想立即回到合并前状态',
    category: 'merge',
    categoryLabel: '冲突拆弹',
    tags: ['撤销pull', '放弃合并', 'merge abort', '冲突回退'],
    pinyinKeywords: ['chexiaopull', 'fangqihebing', 'chongtu'],
    safetyLevel: '注意检查',
    difficulty: '小白推荐',
    primaryCommand: 'git status',
    steps: [
      {
        title: '若正处于合并冲突中断状态，一键中止合并',
        cmd: 'git merge --abort',
        explain: '只适用于正在进行的 merge；rebase 冲突单独用 git rebase --abort。先另存未提交文件及手动解决冲突的内容，abort 不能保证还原合并前所有未提交改动。'
      },
      {
        title: '若合并已经完成，先核对合并前位置；不要接着执行上一步',
        cmd: 'git show --stat ORIG_HEAD',
        explain: '这是另一种情形，不是 abort 后的下一步。先保存文件副本并新建备份分支；确认该引用未被后续操作改写后，再决定 revert 或本地回退。'
      }
    ],
    principle: '区分正在合并与已经完成，不能把两个方案连续运行。ORIG_HEAD 会被后续操作更新，使用前必须核对实际提交。'
  },
  {
    id: 'revert-pushed-public-commit',
    title: '错误代码已经 push 到了远程公共分支，需要安全回滚且不破坏团队历史',
    category: 'commit',
    categoryLabel: '线上回滚',
    tags: ['远程回滚', 'revert', '线上回退', '反向提交'],
    pinyinKeywords: ['yuanchenghuigun', 'xianshanghuigun', 'revert'],
    safetyLevel: '注意检查',
    difficulty: '小白推荐',
    primaryCommand: 'git show --stat HEAD',
    steps: [
      {
        title: '生成一笔反向抵消提交（不动历史时间线）',
        cmd: 'git revert HEAD --no-edit',
        explain: '确认 HEAD 是要撤销的普通提交，先保存当前修改。合并提交需要核对主线父节点，不能一律选择 -m 1；出现冲突后应处理或 git revert --abort。'
      },
      {
        title: '正常推送到远端仓库（无需危险的 --force）',
        cmd: 'git status -sb',
        explain: '测试反向提交并核对当前分支、远端和上游后再正常推送。不要把固定的 main 当成所有项目的目标分支。'
      }
    ],
    principle: '公共分支严禁 git reset --hard 后强推（force push），使用 git revert 新增反向补丁才是工程规范。'
  }
]

/** 整份指南仅供阅读；每行都是 shell 注释，避免把可选方案串成连续命令。 */
export function buildEmergencyGuide(item: GitEmergencyItem): string {
  return [`场景：${item.title}`, '以下是说明，请逐项核对后单独执行命令；不需要把全部步骤连续运行。',
    ...item.steps.flatMap((step, index) => [`${index + 1}. ${step.title}`, step.cmd, step.explain]), item.principle]
    .flatMap(line => line.split(/\r?\n/)).map(line => `# ${line}`).join('\n')
}

export const COMMIT_TYPES: CommitTypeItem[] = [
  {
    type: 'feat',
    chineseMeaning: '新增业务功能或特性',
    description: '面向用户或下游模块新增的业务能力',
    examples: ['feat(auth): 新增企业微信扫码登录与多端会话同步', 'feat(plugin): 新增 SQL 格式化与 DDL 实体生成插件']
  },
  {
    type: 'fix',
    chineseMeaning: '修复 Bug 或生产异常',
    description: '修复边界崩溃、逻辑缺陷、空指针或协议解析异常',
    examples: ['fix(network): 修复 DNS 并发测速超时未释放 Socket 句柄问题', 'fix(ui): 修复深色模式下详情栏表格边框对比度不足']
  },
  {
    type: 'refactor',
    chineseMeaning: '代码重构（不改变外部行为）',
    description: '内聚公共底座、消除重复代码、优化模块边界',
    examples: ['refactor(host): 收敛内置插件特权 IPC 路由至单一咽喉底座']
  },
  {
    type: 'perf',
    chineseMeaning: '性能与内存优化',
    description: '降低唤醒延迟、优化算法复杂度、减少渲染重绘与常驻内存',
    examples: ['perf(indexer): 将 MFT 增量索引过滤耗时从 45ms 降至 4ms']
  },
  {
    type: 'test',
    chineseMeaning: '新增或完善集成与异常测试',
    description: '补充端到端集成测试、边界极值与失败回滚用例',
    examples: ['test(plugins): 补齐 41 款标杆插件全链路集成与异常拦截测试套件']
  },
  {
    type: 'docs',
    chineseMeaning: '技术文档与注释更新',
    description: '修改架构设计文档、API 手册或 README',
    examples: ['docs(specs): 更新 41 款插件独立开发文档与实机渲染截图']
  },
  {
    type: 'chore',
    chineseMeaning: '构建脚本、依赖升级或工程杂务',
    description: 'CI/CD 流水线、脚手架、打包配置与版本例行维护',
    examples: ['chore(release): 升级 Electron 构建门禁与 AST 安全扫描规则']
  }
]

export const GITIGNORE_STACK_TEMPLATES: GitignoreStackTemplate[] = [
  {
    id: 'Node',
    name: 'Node.js / TypeScript',
    category: '语言与运行时',
    rules: [
      'node_modules/',
      'dist/',
      'out/',
      'build/',
      '*.tsbuildinfo',
      'npm-debug.log*',
      'yarn-debug.log*',
      'pnpm-debug.log*',
      '.pnpm-store/',
      '.env',
      '.env.local',
      '.env.*.local',
      'coverage/'
    ]
  },
  {
    id: 'ReactVue',
    name: 'React / Vue / Next / Vite',
    category: '前端框架',
    rules: [
      '.next/',
      '.nuxt/',
      '.output/',
      '.vite/',
      '.cache/',
      'dist/',
      'dist-ssr/',
      '*.local'
    ]
  },
  {
    id: 'Python',
    name: 'Python / PyTorch / Poetry',
    category: '语言与运行时',
    rules: [
      '__pycache__/',
      '*.py[cod]',
      '*$py.class',
      '.venv/',
      'venv/',
      'ENV/',
      '.pytest_cache/',
      '.mypy_cache/',
      '*.egg-info/',
      'dist/',
      '.env'
    ]
  },
  {
    id: 'Java',
    name: 'Java / Maven / Gradle / Spring',
    category: '语言与运行时',
    rules: [
      'target/',
      'build/',
      '.gradle/',
      '*.class',
      '*.jar',
      '*.war',
      '*.ear',
      'hs_err_pid*',
      'replay_pid*'
    ]
  },
  {
    id: 'Go',
    name: 'Go (Golang)',
    category: '语言与运行时',
    rules: ['bin/', 'vendor/', '*.exe', '*.exe~', '*.dll', '*.so', '*.dylib', '*.test', '*.out', 'go.work']
  },
  {
    id: 'Rust',
    name: 'Rust / Cargo',
    category: '语言与运行时',
    rules: ['target/', 'Cargo.lock', '**/*.rs.bk', '*.pdb']
  },
  {
    id: 'macOS',
    name: 'macOS 系统隐藏文件',
    category: '操作系统',
    rules: ['.DS_Store', '.AppleDouble', '.LSOverride', '._*', '.Spotlight-V100', '.Trashes']
  },
  {
    id: 'Windows',
    name: 'Windows 系统缩略图与临时项',
    category: '操作系统',
    rules: ['Thumbs.db', 'Thumbs.db:encryptable', 'ehthumbs.db', 'Desktop.ini', '$RECYCLE.BIN/', '*.lnk']
  },
  {
    id: 'IDEs',
    name: 'VS Code / Cursor / JetBrains IDE',
    category: '编辑器与 IDE',
    rules: ['.vscode/*', '!.vscode/extensions.json', '!.vscode/settings.json', '.idea/', '*.iml', '*.iws', '.history/']
  }
]

/**
 * 大白话 + 拼音缩写容错检索 Git 救命锦囊
 */
export function searchGitEmergencies(query: string): GitEmergencyItem[] {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  if (!q) return GIT_EMERGENCY_DATABASE

  return GIT_EMERGENCY_DATABASE.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.categoryLabel.toLowerCase().includes(q) ||
      item.primaryCommand.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q)) ||
      item.pinyinKeywords.some((p) => p.includes(q) || q.includes(p)) ||
      item.steps.some((s) => s.title.toLowerCase().includes(q) || s.cmd.toLowerCase().includes(q))
  )
}

/**
 * 用 POSIX 单引号保留 Bash/zsh 参数的字面值，包括交互终端的感叹号。
 */
export function quotePosixShellArg(raw: string): string {
  return "'" + raw.replace(/'/g, "'\"'\"'") + "'"
}

/**
 * 构建符合 Conventional Commits 规范的提交文本与可执行 git commit 命令
 */
export function buildConventionalCommit(options: {
  type: string
  scope?: string
  subject: string
  breaking?: boolean
}): {
  isValid: boolean
  message: string
  gitCommand: string
  validationHint?: string
} {
  const cleanType = String(options.type || 'feat').trim()
  const cleanScope = String(options.scope || '')
    .trim()
    .replace(/[()\r\n]/g, '')
  const rawSubject = String(options.subject || '').trim()
  const bang = options.breaking ? '!' : ''
  const scopePart = cleanScope ? `(${cleanScope})` : ''

  if (!rawSubject || /[\u0000-\u001f\u007f]/.test(cleanType + cleanScope + rawSubject.replace(/\r?\n/g, ' '))) {
    const placeholder = '请填写清晰明确的中文改动摘要'
    const msg = `${cleanType}${scopePart}${bang}: ${placeholder}`
    return {
      isValid: false,
      message: msg,
      gitCommand: '',
      validationHint: '提交说明不能为空，建议使用中文简述本次修改的具体目的'
    }
  }

  const normalizedSubject = rawSubject.replace(/\r?\n/g, ' ').trim()
  const message = `${cleanType}${scopePart}${bang}: ${normalizedSubject}`
  const escaped = quotePosixShellArg(message)

  return {
    isValid: true,
    message,
    gitCommand: `git commit -m ${escaped}`
  }
}

/**
 * 组合多个技术栈生成去重后的标准 `.gitignore` 文件内容
 */
export function generateGitignoreContent(selectedStackIds: string[], customRules: string[] = []): {
  content: string
  totalUniqueRules: number
  selectedStacks: string[]
} {
  const effectiveIds = [...new Set(selectedStackIds)]

  const seenRules = new Set<string>()
  const sections: string[] = [
    '# ========================================================',
    `# Generated by ZTools Git Helper (${effectiveIds.join(' + ')})`,
    '# ========================================================'
  ]

  for (const stackId of effectiveIds) {
    const tpl = GITIGNORE_STACK_TEMPLATES.find(
      (t) => t.id.toLowerCase() === stackId.toLowerCase() || t.name.toLowerCase().includes(stackId.toLowerCase())
    )
    if (!tpl) continue

    const uniqueForStack: string[] = []
    for (const rule of tpl.rules) {
      const trimmed = rule.trim()
      if (!trimmed || seenRules.has(trimmed)) continue
      seenRules.add(trimmed)
      uniqueForStack.push(trimmed)
    }

    if (uniqueForStack.length > 0) {
      sections.push(`\n### ${tpl.name} ###`)
      sections.push(...uniqueForStack)
    }
  }

  const cleanCustom = [...new Set(customRules.map((r) => r.trim()))].filter((r) => r && !seenRules.has(r))
  if (cleanCustom.length > 0) {
    sections.push('\n### Custom Rules ###')
    for (const r of cleanCustom) {
      seenRules.add(r)
      sections.push(r)
    }
  }

  return {
    content: sections.join('\n') + '\n',
    totalUniqueRules: seenRules.size,
    selectedStacks: effectiveIds
  }
}
