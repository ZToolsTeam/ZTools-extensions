import type { CommitTypeItem, GitEmergencyItem, GitignoreStackTemplate } from './types.js'
import { GIT_HELPER_MESSAGES, t } from './i18n.js'

type GitHelperKey = keyof (typeof GIT_HELPER_MESSAGES)['zh-CN']

interface EmergencyStepSpec {
  titleKey: GitHelperKey
  cmd?: string
  cmdKey?: GitHelperKey
  explainKey: GitHelperKey
}

interface EmergencySpec {
  id: string
  category: GitEmergencyItem['category']
  titleKey: GitHelperKey
  categoryKey: GitHelperKey
  tagsKey: GitHelperKey
  pinyinKeywords: readonly string[]
  safetyKind: 'safe' | 'caution' | 'danger'
  safetyKey: 'safetySafe' | 'safetyCaution' | 'safetyDanger'
  diffKey: 'diffBeginner' | 'diffMedium' | 'diffExpert'
  primaryCommand: string
  steps: readonly EmergencyStepSpec[]
  principleKey: GitHelperKey
  minGitVersion?: string
}

interface CommitTypeSpec {
  type: string
  meaningKey: GitHelperKey
  descKey: GitHelperKey
  exampleKeys: readonly GitHelperKey[]
}

interface GitignoreSpec {
  id: string
  name?: string
  nameKey?: GitHelperKey
  catKey: GitHelperKey
  rules: readonly string[]
}

const EMERGENCY_SPECS: readonly EmergencySpec[] = [
  {
    id: 'undo-last-commit-keep-changes',
    category: 'commit',
    titleKey: 'emUndoTitle',
    categoryKey: 'emUndoCat',
    tagsKey: 'emUndoTags',
    pinyinKeywords: ['chexiao', 'chexiaotijiao', 'huitui', 'huigun'],
    safetyKind: 'caution',
    safetyKey: 'safetyCaution',
    diffKey: 'diffBeginner',
    primaryCommand: 'git branch backup/before-undo && git reset --soft HEAD~1',
    steps: [
      {
        titleKey: 'emUndoStep1Title',
        cmd: 'git branch backup/before-undo && git reset --soft HEAD~1',
        explainKey: 'emUndoStep1Explain'
      },
      {
        titleKey: 'emUndoStep2Title',
        cmd: 'git reset --mixed HEAD',
        explainKey: 'emUndoStep2Explain'
      }
    ],
    principleKey: 'emUndoPrinciple',
    minGitVersion: 'Git 2.0+'
  },
  {
    id: 'amend-missing-file-or-message',
    category: 'commit',
    titleKey: 'emAmendTitle',
    categoryKey: 'emAmendCat',
    tagsKey: 'emAmendTags',
    pinyinKeywords: ['loutiwangjian', 'xiugaibeizhu', 'amend', 'zhuijia'],
    safetyKind: 'caution',
    safetyKey: 'safetyCaution',
    diffKey: 'diffBeginner',
    primaryCommand: 'git status --short',
    steps: [
      {
        titleKey: 'emAmendStep1Title',
        cmdKey: 'emAmendStep1Cmd',
        explainKey: 'emAmendStep1Explain'
      },
      {
        titleKey: 'emAmendStep2Title',
        cmd: 'git branch backup/before-amend && git commit --amend --no-edit',
        explainKey: 'emAmendStep2Explain'
      }
    ],
    principleKey: 'emAmendPrinciple'
  },
  {
    id: 'recover-deleted-branch-or-hard-reset',
    category: 'reset',
    titleKey: 'emRecoverTitle',
    categoryKey: 'emRecoverCat',
    tagsKey: 'emRecoverTags',
    pinyinKeywords: ['huifufenzhi', 'wushanfenzhi', 'zhaohuidaima', 'reflog'],
    safetyKind: 'safe',
    safetyKey: 'safetySafe',
    diffKey: 'diffMedium',
    primaryCommand: 'git reflog',
    steps: [
      {
        titleKey: 'emRecoverStep1Title',
        cmd: 'git reflog -n 20',
        explainKey: 'emRecoverStep1Explain'
      },
      {
        titleKey: 'emRecoverStep2Title',
        cmdKey: 'emRecoverStep2Cmd',
        explainKey: 'emRecoverStep2Explain'
      }
    ],
    principleKey: 'emRecoverPrinciple'
  },
  {
    id: 'committed-to-wrong-branch',
    category: 'branch',
    titleKey: 'emWrongBranchTitle',
    categoryKey: 'emWrongBranchCat',
    tagsKey: 'emWrongBranchTags',
    pinyinKeywords: ['tijiaocuofenzhi', 'fenzhicuowu', 'nuoyitijiao'],
    safetyKind: 'caution',
    safetyKey: 'safetyCaution',
    diffKey: 'diffMedium',
    primaryCommand: 'git switch -c feat/new-work',
    steps: [
      {
        titleKey: 'emWrongBranchStep1Title',
        cmd: 'git switch -c feat/new-work',
        explainKey: 'emWrongBranchStep1Explain'
      },
      {
        titleKey: 'emWrongBranchStep2Title',
        cmd: 'git log --oneline --decorate --all -n 10',
        explainKey: 'emWrongBranchStep2Explain'
      }
    ],
    principleKey: 'emWrongBranchPrinciple'
  },
  {
    id: 'undo-messy-git-pull-merge',
    category: 'merge',
    titleKey: 'emPullAbortTitle',
    categoryKey: 'emPullAbortCat',
    tagsKey: 'emPullAbortTags',
    pinyinKeywords: ['chexiaopull', 'fangqihebing', 'chongtu'],
    safetyKind: 'caution',
    safetyKey: 'safetyCaution',
    diffKey: 'diffBeginner',
    primaryCommand: 'git status',
    steps: [
      {
        titleKey: 'emPullAbortStep1Title',
        cmd: 'git merge --abort',
        explainKey: 'emPullAbortStep1Explain'
      },
      {
        titleKey: 'emPullAbortStep2Title',
        cmd: 'git show --stat ORIG_HEAD',
        explainKey: 'emPullAbortStep2Explain'
      }
    ],
    principleKey: 'emPullAbortPrinciple'
  },
  {
    id: 'revert-pushed-public-commit',
    category: 'commit',
    titleKey: 'emRevertTitle',
    categoryKey: 'emRevertCat',
    tagsKey: 'emRevertTags',
    pinyinKeywords: ['yuanchenghuigun', 'xianshanghuigun', 'revert'],
    safetyKind: 'caution',
    safetyKey: 'safetyCaution',
    diffKey: 'diffBeginner',
    primaryCommand: 'git show --stat HEAD',
    steps: [
      {
        titleKey: 'emRevertStep1Title',
        cmd: 'git revert HEAD --no-edit',
        explainKey: 'emRevertStep1Explain'
      },
      {
        titleKey: 'emRevertStep2Title',
        cmd: 'git status -sb',
        explainKey: 'emRevertStep2Explain'
      }
    ],
    principleKey: 'emRevertPrinciple'
  },
  {
    id: 'recover-dropped-stash',
    category: 'stash',
    titleKey: 'emStashRecoverTitle',
    categoryKey: 'emStashRecoverCat',
    tagsKey: 'emStashRecoverTags',
    pinyinKeywords: ['stash', 'wushanstash', 'zhaohuistash', 'fsck'],
    safetyKind: 'safe',
    safetyKey: 'safetySafe',
    diffKey: 'diffMedium',
    primaryCommand: "git fsck --no-reflog | awk '/dangling commit/ {print $3}'",
    steps: [
      {
        titleKey: 'emStashRecoverStep1Title',
        cmd: "git fsck --no-reflog | awk '/dangling commit/ {print $3}'",
        explainKey: 'emStashRecoverStep1Explain'
      },
      {
        titleKey: 'emStashRecoverStep2Title',
        cmdKey: 'emStashRecoverStep2Cmd',
        explainKey: 'emStashRecoverStep2Explain'
      }
    ],
    principleKey: 'emStashRecoverPrinciple'
  },
  {
    id: 'rescue-detached-head',
    category: 'branch',
    titleKey: 'emDetachedHeadTitle',
    categoryKey: 'emDetachedHeadCat',
    tagsKey: 'emDetachedHeadTags',
    pinyinKeywords: ['detached', 'youli', 'youlitouzhizhen', 'jiuhuifenzhi'],
    safetyKind: 'safe',
    safetyKey: 'safetySafe',
    diffKey: 'diffBeginner',
    primaryCommand: 'git switch -c rescue/detached-work',
    steps: [
      {
        titleKey: 'emDetachedHeadStep1Title',
        cmd: 'git switch -c rescue/detached-work',
        explainKey: 'emDetachedHeadStep1Explain'
      },
      {
        titleKey: 'emDetachedHeadStep2Title',
        cmdKey: 'emDetachedHeadStep2Cmd',
        explainKey: 'emDetachedHeadStep2Explain'
      }
    ],
    principleKey: 'emDetachedHeadPrinciple',
    minGitVersion: 'Git 2.23+'
  },
  {
    id: 'clean-untracked-files',
    category: 'reset',
    titleKey: 'emCleanUntrackedTitle',
    categoryKey: 'emCleanUntrackedCat',
    tagsKey: 'emCleanUntrackedTags',
    pinyinKeywords: ['clean', 'qingli', 'weigenzong', 'shanchulinshi'],
    safetyKind: 'danger',
    safetyKey: 'safetyDanger',
    diffKey: 'diffMedium',
    primaryCommand: 'git clean -nd',
    steps: [
      {
        titleKey: 'emCleanUntrackedStep1Title',
        cmd: 'git clean -nd',
        explainKey: 'emCleanUntrackedStep1Explain'
      },
      {
        titleKey: 'emCleanUntrackedStep2Title',
        cmd: 'git clean -fd',
        explainKey: 'emCleanUntrackedStep2Explain'
      }
    ],
    principleKey: 'emCleanUntrackedPrinciple'
  },
  {
    id: 'edit-last-commit-message',
    category: 'commit',
    titleKey: 'emEditMsgTitle',
    categoryKey: 'emEditMsgCat',
    tagsKey: 'emEditMsgTags',
    pinyinKeywords: ['xiugaicommit', 'gaibeizhu', 'amend', 'chongmingming'],
    safetyKind: 'caution',
    safetyKey: 'safetyCaution',
    diffKey: 'diffBeginner',
    primaryCommand: 'git status --short',
    steps: [
      {
        titleKey: 'emEditMsgStep1Title',
        cmd: 'git status --short',
        explainKey: 'emEditMsgStep1Explain'
      },
      {
        titleKey: 'emEditMsgStep2Title',
        cmdKey: 'emEditMsgStep2Cmd',
        explainKey: 'emEditMsgStep2Explain'
      }
    ],
    principleKey: 'emEditMsgPrinciple'
  },
  {
    id: 'abort-or-continue-rebase',
    category: 'merge',
    titleKey: 'emRebaseAbortTitle',
    categoryKey: 'emRebaseAbortCat',
    tagsKey: 'emRebaseAbortTags',
    pinyinKeywords: ['rebase', 'bianji', 'zhongzhibianji', 'chongtu'],
    safetyKind: 'caution',
    safetyKey: 'safetyCaution',
    diffKey: 'diffMedium',
    primaryCommand: 'git rebase --abort',
    steps: [
      {
        titleKey: 'emRebaseAbortStep1Title',
        cmd: 'git rebase --abort',
        explainKey: 'emRebaseAbortStep1Explain'
      },
      {
        titleKey: 'emRebaseAbortStep2Title',
        cmd: 'git rebase --continue',
        explainKey: 'emRebaseAbortStep2Explain'
      }
    ],
    principleKey: 'emRebaseAbortPrinciple'
  },
  {
    id: 'discard-single-file',
    category: 'reset',
    titleKey: 'emDiscardFileTitle',
    categoryKey: 'emDiscardFileCat',
    tagsKey: 'emDiscardFileTags',
    pinyinKeywords: ['chexiaodanwenjian', 'huanyuanwenjian', 'restore', 'fangqixiugai'],
    safetyKind: 'danger',
    safetyKey: 'safetyDanger',
    diffKey: 'diffBeginner',
    primaryCommand: 'git status --short',
    steps: [
      {
        titleKey: 'emDiscardFileStep1Title',
        cmdKey: 'emDiscardFileStep1Cmd',
        explainKey: 'emDiscardFileStep1Explain'
      },
      {
        titleKey: 'emDiscardFileStep2Title',
        cmdKey: 'emDiscardFileStep2Cmd',
        explainKey: 'emDiscardFileStep2Explain'
      }
    ],
    principleKey: 'emDiscardFilePrinciple',
    minGitVersion: 'Git 2.23+'
  },
  {
    id: 'cleanup-merged-branches',
    category: 'branch',
    titleKey: 'emCleanBranchesTitle',
    categoryKey: 'emCleanBranchesCat',
    tagsKey: 'emCleanBranchesTags',
    pinyinKeywords: ['qinglifenzhi', 'yihebingfenzhi', 'shanchufenzhi'],
    safetyKind: 'safe',
    safetyKey: 'safetySafe',
    diffKey: 'diffBeginner',
    primaryCommand: 'git branch --merged',
    steps: [
      {
        titleKey: 'emCleanBranchesStep1Title',
        cmd: 'git branch --merged',
        explainKey: 'emCleanBranchesStep1Explain'
      },
      {
        titleKey: 'emCleanBranchesStep2Title',
        cmdKey: 'emCleanBranchesStep2Cmd',
        explainKey: 'emCleanBranchesStep2Explain'
      }
    ],
    principleKey: 'emCleanBranchesPrinciple'
  },
  {
    id: 'unstage-git-add',
    category: 'commit',
    titleKey: 'emUnstageAddTitle',
    categoryKey: 'emUnstageAddCat',
    tagsKey: 'emUnstageAddTags',
    pinyinKeywords: ['quxiaozancun', 'quxiaoadd', 'unstage', 'restore'],
    safetyKind: 'safe',
    safetyKey: 'safetySafe',
    diffKey: 'diffBeginner',
    primaryCommand: 'git restore --staged .',
    steps: [
      {
        titleKey: 'emUnstageAddStep1Title',
        cmdKey: 'emUnstageAddStep1Cmd',
        explainKey: 'emUnstageAddStep1Explain'
      },
      {
        titleKey: 'emUnstageAddStep2Title',
        cmd: 'git restore --staged .',
        explainKey: 'emUnstageAddStep2Explain'
      }
    ],
    principleKey: 'emUnstageAddPrinciple',
    minGitVersion: 'Git 2.23+'
  },
  {
    id: 'cherry-pick-single-commit',
    category: 'branch',
    titleKey: 'emCherryPickTitle',
    categoryKey: 'emCherryPickCat',
    tagsKey: 'emCherryPickTags',
    pinyinKeywords: ['cherrypick', 'zhaiqutijiao', 'rexiufu'],
    safetyKind: 'caution',
    safetyKey: 'safetyCaution',
    diffKey: 'diffMedium',
    primaryCommand: 'git log --oneline -n 15',
    steps: [
      {
        titleKey: 'emCherryPickStep1Title',
        cmd: 'git log --oneline -n 15',
        explainKey: 'emCherryPickStep1Explain'
      },
      {
        titleKey: 'emCherryPickStep2Title',
        cmdKey: 'emCherryPickStep2Cmd',
        explainKey: 'emCherryPickStep2Explain'
      }
    ],
    principleKey: 'emCherryPickPrinciple'
  }
]

const COMMIT_TYPE_SPECS: readonly CommitTypeSpec[] = [
  { type: 'feat', meaningKey: 'ctFeatMeaning', descKey: 'ctFeatDesc', exampleKeys: ['ctFeatEx1', 'ctFeatEx2'] },
  { type: 'fix', meaningKey: 'ctFixMeaning', descKey: 'ctFixDesc', exampleKeys: ['ctFixEx1', 'ctFixEx2'] },
  { type: 'refactor', meaningKey: 'ctRefactorMeaning', descKey: 'ctRefactorDesc', exampleKeys: ['ctRefactorEx1'] },
  { type: 'perf', meaningKey: 'ctPerfMeaning', descKey: 'ctPerfDesc', exampleKeys: ['ctPerfEx1'] },
  { type: 'test', meaningKey: 'ctTestMeaning', descKey: 'ctTestDesc', exampleKeys: ['ctTestEx1'] },
  { type: 'docs', meaningKey: 'ctDocsMeaning', descKey: 'ctDocsDesc', exampleKeys: ['ctDocsEx1'] },
  { type: 'chore', meaningKey: 'ctChoreMeaning', descKey: 'ctChoreDesc', exampleKeys: ['ctChoreEx1'] },
  { type: 'build', meaningKey: 'ctBuildMeaning', descKey: 'ctBuildDesc', exampleKeys: ['ctBuildEx1'] },
  { type: 'ci', meaningKey: 'ctCiMeaning', descKey: 'ctCiDesc', exampleKeys: ['ctCiEx1'] },
  { type: 'style', meaningKey: 'ctStyleMeaning', descKey: 'ctStyleDesc', exampleKeys: ['ctStyleEx1'] },
  { type: 'revert', meaningKey: 'ctRevertMeaning', descKey: 'ctRevertDesc', exampleKeys: ['ctRevertEx1'] }
]

const GITIGNORE_SPECS: readonly GitignoreSpec[] = [
  {
    id: 'Node',
    name: 'Node.js / TypeScript',
    catKey: 'giCatLang',
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
    catKey: 'giCatFrontend',
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
    catKey: 'giCatLang',
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
    catKey: 'giCatLang',
    rules: [
      'target/',
      'build/',
      '.gradle/',
      '*.class',
      '*.jar',
      '*.war',
      '*.ear',
      // 构建脚本包装器的 jar 必须提交，否则克隆后 ./gradlew、./mvnw 无法运行
      '!gradle/wrapper/gradle-wrapper.jar',
      '!.mvn/wrapper/maven-wrapper.jar',
      'hs_err_pid*',
      'replay_pid*'
    ]
  },
  {
    id: 'Go',
    name: 'Go (Golang)',
    catKey: 'giCatLang',
    // vendor/ 是否提交由项目决定（go mod vendor），默认不忽略
    rules: ['bin/', '*.exe', '*.exe~', '*.dll', '*.so', '*.dylib', '*.test', '*.out', 'go.work']
  },
  {
    id: 'Rust',
    name: 'Rust / Cargo',
    catKey: 'giCatLang',
    // Cargo 官方建议提交 Cargo.lock（应用与库都适用），这里不忽略它
    rules: ['target/', '**/*.rs.bk', '*.pdb']
  },
  {
    id: 'macOS',
    nameKey: 'giNameMacOS',
    catKey: 'giCatOS',
    rules: [
      '.DS_Store',
      '.AppleDouble',
      '.LSOverride',
      '._*',
      '.DocumentRevisions-V100',
      '.fseventsd',
      '.Spotlight-V100',
      '.TemporaryItems',
      '.Trashes',
      '.VolumeIcon.icns',
      '.com.apple.timemachine.donotpresent',
      '.apdisk'
    ]
  },
  {
    id: 'Windows',
    nameKey: 'giNameWindows',
    catKey: 'giCatOS',
    rules: ['Thumbs.db', 'Thumbs.db:encryptable', 'ehthumbs.db', '[Dd]esktop.ini', '$RECYCLE.BIN/', '*.lnk']
  },
  {
    id: 'IDEs',
    name: 'VS Code / Cursor / JetBrains IDE',
    catKey: 'giCatIDE',
    rules: ['.vscode/*', '!.vscode/extensions.json', '!.vscode/settings.json', '.idea/', '*.iml', '*.iws', '.history/']
  }
]

function tr(key: GitHelperKey, locale?: 'zh-CN' | 'en-US'): string {
  if (locale) return GIT_HELPER_MESSAGES[locale][key]
  return t(key)
}

function splitTags(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function buildEmergencyItem(spec: EmergencySpec, locale?: 'zh-CN' | 'en-US'): GitEmergencyItem {
  return {
    id: spec.id,
    title: tr(spec.titleKey, locale),
    category: spec.category,
    categoryLabel: tr(spec.categoryKey, locale),
    tags: splitTags(tr(spec.tagsKey, locale)),
    pinyinKeywords: [...spec.pinyinKeywords],
    safetyKind: spec.safetyKind,
    safetyLevel: tr(spec.safetyKey, locale),
    difficulty: tr(spec.diffKey, locale),
    primaryCommand: spec.primaryCommand,
    steps: spec.steps.map((s) => ({
      title: tr(s.titleKey, locale),
      cmd: s.cmdKey ? tr(s.cmdKey, locale) : (s.cmd ?? ''),
      explain: tr(s.explainKey, locale)
    })),
    principle: tr(spec.principleKey, locale),
    ...(spec.minGitVersion ? { minGitVersion: spec.minGitVersion } : {})
  }
}

/** 动态视图数组：所有展示文本通过 getter 实时按当前 locale 读取，支持语言热切换且无硬编码中文 */
export const GIT_EMERGENCY_DATABASE: GitEmergencyItem[] = EMERGENCY_SPECS.map((spec) => ({
  id: spec.id,
  category: spec.category,
  pinyinKeywords: [...spec.pinyinKeywords],
  safetyKind: spec.safetyKind,
  primaryCommand: spec.primaryCommand,
  ...(spec.minGitVersion ? { minGitVersion: spec.minGitVersion } : {}),
  get title() {
    return tr(spec.titleKey)
  },
  get categoryLabel() {
    return tr(spec.categoryKey)
  },
  get tags() {
    return splitTags(tr(spec.tagsKey))
  },
  get safetyLevel() {
    return tr(spec.safetyKey)
  },
  get difficulty() {
    return tr(spec.diffKey)
  },
  get steps() {
    return spec.steps.map((s) => ({
      title: tr(s.titleKey),
      cmd: s.cmdKey ? tr(s.cmdKey) : (s.cmd ?? ''),
      explain: tr(s.explainKey)
    }))
  },
  get principle() {
    return tr(spec.principleKey)
  }
}))

export const COMMIT_TYPES: CommitTypeItem[] = COMMIT_TYPE_SPECS.map((spec) => ({
  type: spec.type,
  get chineseMeaning() {
    return tr(spec.meaningKey)
  },
  get description() {
    return tr(spec.descKey)
  },
  get examples() {
    return spec.exampleKeys.map((k) => tr(k))
  }
}))

export const GITIGNORE_STACK_TEMPLATES: GitignoreStackTemplate[] = GITIGNORE_SPECS.map((spec) => ({
  id: spec.id,
  rules: [...spec.rules],
  get name() {
    return spec.nameKey ? tr(spec.nameKey) : (spec.name ?? spec.id)
  },
  get category() {
    return tr(spec.catKey)
  }
}))

/** 整份指南仅供阅读；每行都是 shell 注释，避免把可选方案串成连续命令。 */
export function buildEmergencyGuide(item: GitEmergencyItem): string {
  return [t('guideScenarioPrefix', { title: item.title }), t('guideIntro'),
    ...item.steps.flatMap((step, index) => [`${index + 1}. ${step.title}`, step.cmd, step.explain]), item.principle]
    .flatMap(line => line.split(/\r?\n/)).map(line => `# ${line}`).join('\n')
}

export function getEmergencyDatabase(): GitEmergencyItem[] {
  return EMERGENCY_SPECS.map((spec) => buildEmergencyItem(spec))
}

export function getCommitTypes(): CommitTypeItem[] {
  return COMMIT_TYPE_SPECS.map((spec) => ({
    type: spec.type,
    chineseMeaning: tr(spec.meaningKey),
    description: tr(spec.descKey),
    examples: spec.exampleKeys.map((k) => tr(k))
  }))
}

export function getGitignoreStackTemplates(): GitignoreStackTemplate[] {
  return GITIGNORE_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.nameKey ? tr(spec.nameKey) : (spec.name ?? spec.id),
    category: tr(spec.catKey),
    rules: [...spec.rules]
  }))
}

/**
 * 大白话 + 拼音缩写容错检索 Git 救命锦囊（同时兼容中英文关键词）
 */
export function searchGitEmergencies(query: string): GitEmergencyItem[] {
  const db = getEmergencyDatabase()
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  if (!q) return db

  return db.filter((item, idx) => {
    const zh = buildEmergencyItem(EMERGENCY_SPECS[idx], 'zh-CN')
    const en = buildEmergencyItem(EMERGENCY_SPECS[idx], 'en-US')
    const haystack = [
      item.title,
      item.categoryLabel,
      item.primaryCommand,
      ...item.tags,
      ...item.steps.flatMap((s) => [s.title, s.cmd]),
      zh.title,
      zh.categoryLabel,
      ...zh.tags,
      en.title,
      en.categoryLabel,
      ...en.tags
    ]
    return (
      haystack.some((text) => text.toLowerCase().includes(q)) ||
      item.pinyinKeywords.some((p) => p.includes(q) || q.includes(p))
    )
  })
}

/**
 * 用 POSIX 单引号保留 Bash/zsh 参数的字面值，包括交互终端的感叹号。
 */
export function quotePosixShellArg(raw: string): string {
  return "'" + raw.replace(/'/g, "'\"'\"'") + "'"
}

const SCOPE_PATTERN = /^[A-Za-z0-9_\-./\u4e00-\u9fff]{1,23}$/

/**
 * 解析搜索框里的 `scope:说明`（英文冒号）。冒号前不是合法 scope（含空格、是网址协议等）时整段都当作说明；
 * 冒号前恰好是提交类型（如 `fix: 修复…`）时视为用户顺手写了类型，去掉它，不当作 scope。
 */
export function parseCommitInput(raw: string): { scope: string; subject: string } {
  const text = String(raw ?? '').trim()
  if (!text) return { scope: '', subject: '' }
  const colonIdx = text.indexOf(':')
  if (colonIdx <= 0) return { scope: '', subject: text }
  const head = text.slice(0, colonIdx).trim()
  const rest = text.slice(colonIdx + 1)
  if (!SCOPE_PATTERN.test(head) || rest.startsWith('//')) return { scope: '', subject: text }
  if (COMMIT_TYPE_SPECS.some((spec) => spec.type === head.toLowerCase())) return { scope: '', subject: rest.trim() }
  return { scope: head, subject: rest.trim() }
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
  // 换行与制表符按空格处理（粘贴多行说明时常见），其余控制字符拒绝
  const rawSubject = String(options.subject || '').replace(/[\r\n\t]+/g, ' ').trim()
  const bang = options.breaking ? '!' : ''
  const scopePart = cleanScope ? `(${cleanScope})` : ''

  const hasControl = /[\u0000-\u001f\u007f]/.test(cleanType + cleanScope + rawSubject)
  if (!rawSubject || hasControl) {
    const placeholder = t('commitPlaceholder')
    const msg = `${cleanType}${scopePart}${bang}: ${placeholder}`
    return {
      isValid: false,
      message: msg,
      gitCommand: '',
      validationHint: hasControl
        ? t('commitErrControlChars')
        : t('commitErrEmpty')
    }
  }

  const normalizedSubject = rawSubject
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
  // 首行只写来源；具体模板名已在下面每段的 ### 标题里，不再在首行罗列
  const sections: string[] = [t('gitignoreGeneratedHeader')]
  const localizedTemplates = getGitignoreStackTemplates()

  for (const stackId of effectiveIds) {
    const tpl = localizedTemplates.find(
      (tplItem) => tplItem.id.toLowerCase() === stackId.toLowerCase() || tplItem.name.toLowerCase().includes(stackId.toLowerCase())
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
    sections.push(`\n${t('gitignoreCustomRulesHeader')}`)
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
