import test from 'node:test'
import { gitTestTool } from '../../shared/test-tools.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { commands, GIT_EMERGENCY_DATABASE, buildEmergencyGuide, buildConventionalCommit, generateGitignoreContent } from '../dist/index.js'

const host = createHost(), views = []
const undo = GIT_EMERGENCY_DATABASE.find(item => item.id === 'undo-last-commit-keep-changes')
const shellFile = process.platform === 'darwin' ? '/bin/zsh' : gitTestTool('bash')
const shellArgs = process.platform === 'darwin' ? ['-f', '-c'] : ['--noprofile', '--norc', '-c']
const roots = []
const env = { ...process.env, GIT_AUTHOR_NAME: '插件隔离测试', GIT_AUTHOR_EMAIL: 'audit@example.invalid', GIT_COMMITTER_NAME: '插件隔离测试', GIT_COMMITTER_EMAIL: 'audit@example.invalid' }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-git-helper-'))
  roots.push(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const shell = command => execFileSync(shellFile, [...shellArgs, command], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '--initial-branch=main')
  const commits = []
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(path.join(root, 'sample.txt'), `测试版本 ${n}`)
    git('add', 'sample.txt'); git('-c', 'commit.gpgsign=false', 'commit', '-m', `test: 创建隔离样本 ${n}`)
    commits.push(git('rev-parse', 'HEAD'))
  }
  return { root, git, shell, commits }
}
async function open(component) { const view = await mount(component); views.push(view); await tick(); return view }
test.beforeEach(() => host.reset())
test.afterEach(() => {
  views.splice(0).forEach(view => view.unmount())
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }))
})

test('真实 Git：撤销只回退一次并保留恢复分支、暂存与未暂存内容', () => {
  const { root, git, shell, commits } = fixture()
  fs.writeFileSync(path.join(root, 'staged.txt'), '已暂存内容'); git('add', 'staged.txt')
  fs.writeFileSync(path.join(root, 'sample.txt'), '尚未暂存的修改')
  fs.writeFileSync(path.join(root, 'untracked.txt'), '尚未跟踪的文件')
  const beforeIndex = git('write-tree')
  shell(undo.primaryCommand)
  assert.equal(git('rev-parse', 'HEAD'), commits[1])
  assert.equal(git('rev-parse', 'backup/before-undo'), commits[2])
  assert.equal(git('write-tree'), beforeIndex)
  shell(undo.steps[1].cmd)
  assert.equal(git('rev-parse', 'HEAD'), commits[1])
  assert.equal(git('diff', '--cached'), '')
  assert.equal(fs.readFileSync(path.join(root, 'sample.txt'), 'utf8'), '尚未暂存的修改')
  assert.equal(fs.readFileSync(path.join(root, 'staged.txt'), 'utf8'), '已暂存内容')
  assert.equal(fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8'), '尚未跟踪的文件')
  assert.throws(() => shell(undo.primaryCommand))
  assert.equal(git('rev-parse', 'HEAD'), commits[1], '备份重名后不得继续重置')
})

test('整份操作指南粘进 shell 也不会依次执行互斥操作', () => {
  const { git, shell, commits } = fixture()
  for (const item of GIT_EMERGENCY_DATABASE) {
    const guide = buildEmergencyGuide(item)
    assert.ok(guide.split('\n').every(line => line.startsWith('# ')))
    shell(guide)
    assert.equal(git('rev-parse', 'HEAD'), commits[2])
    assert.equal(git('status', '--short'), '')
  }
})

test('真实 Git：创建工作分支保留未提交内容及原分支', () => {
  const { root, git, shell, commits } = fixture()
  fs.writeFileSync(path.join(root, 'sample.txt'), '继续开发内容')
  shell(GIT_EMERGENCY_DATABASE.find(item => item.id === 'committed-to-wrong-branch').primaryCommand)
  assert.equal(git('branch', '--show-current'), 'feat/new-work')
  assert.equal(git('rev-parse', 'main'), commits[2])
  assert.equal(fs.readFileSync(path.join(root, 'sample.txt'), 'utf8'), '继续开发内容')
})

test('真实 POSIX shell：提交说明中的命令替换、引号、感叹号均为字面内容', () => {
  const { root, git, shell } = fixture()
  fs.writeFileSync(path.join(root, 'sample.txt'), '新的变更'); git('add', 'sample.txt')
  const built = buildConventionalCommit({ type: 'fix', scope: '测试', subject: "保留 '单引号'、\"双引号\"、$HOME、$(touch injected)、`touch injected2`、! 与反斜杠\\" })
  assert.equal(built.isValid, true)
  shell(built.gitCommand.replace('git commit', 'git -c commit.gpgsign=false commit'))
  assert.equal(git('log', '-1', '--format=%B'), built.message)
  assert.equal(fs.existsSync(path.join(root, 'injected')), false)
  assert.equal(fs.existsSync(path.join(root, 'injected2')), false)
})

test('三个显式入口选择对应模式；空提交说明不生成可复制命令', async () => {
  const emergency = await open(commands['git-emergency'])
  assert.match(emergency.text(), /git reset --mixed HEAD/)
  assert.match(emergency.text(), /复制带说明的操作指南/)
  await emergency.run(emergency.item(undo.id), '复制首选救命命令')
  assert.equal(host.clipboard.text, undo.primaryCommand)
  await emergency.run(emergency.item(undo.id), '复制带说明的操作指南')
  assert.ok(host.clipboard.text.split('\n').every(line => line.startsWith('# ')))
  const commit = await open(commands['git-commit-builder'])
  assert.equal(commit.tree().props.searchBarAccessory.props.value, 'commit')
  assert.doesNotMatch(commit.text(), /复制完整 git commit 命令/)
  commit.tree().props.onSearchTextChange('auth:修复登录失败'); await tick()
  assert.match(commit.text(), /fix\(auth\): 修复登录失败/)
  assert.match(commit.text(), /复制完整 git commit 命令/)
  await commit.run(commit.item('fix'), '复制完整 git commit 命令')
  assert.equal(host.clipboard.text, "git commit -m 'fix(auth): 修复登录失败'")
  const ignore = await open(commands['gitignore-generator'])
  assert.equal(ignore.tree().props.searchBarAccessory.props.value, 'gitignore')
  await ignore.search('Python')
  assert.equal(ignore.items().length, 1)
  assert.equal(ignore.items()[0].props.id, 'Python')
  await ignore.run(ignore.items()[0], '勾选')
  assert.match(ignore.text(), /已选 3 个栈/)
  assert.match(ignore.text(), /__pycache__/)
  assert.match(ignore.text(), /\.idea/, '筛选不清除原有勾选')
  await ignore.search('')
  for (const item of ignore.items()) {
    const toggle = ignore.actions(item).find(action => action.props.title.startsWith('取消勾选'))
    if (toggle) await ignore.run(item, toggle.props.title)
  }
  assert.match(ignore.text(), /已选 0 个栈，去重后 0 条规则/)
})

test('空说明或控制字符拒绝；忽略规则合并去重且保留自定义规则', () => {
  assert.equal(buildConventionalCommit({ type: 'fix', subject: '' }).gitCommand, '')
  assert.equal(buildConventionalCommit({ type: 'fix', subject: '坏\0内容' }).isValid, false)
  const result = generateGitignoreContent(['Node', 'Node'], ['custom-file', 'custom-file'])
  assert.equal(result.content.split('\n').filter(line => line === 'custom-file').length, 1)
  assert.match(result.content, /node_modules/)
  const empty = generateGitignoreContent([])
  assert.equal(empty.totalUniqueRules, 0)
  assert.deepEqual(empty.selectedStacks, [])
  assert.doesNotMatch(empty.content, /DS_Store|Thumbs/)
})

test('scope 解析：网址、含空格的前缀、类型前缀不会被误当作 scope', async () => {
  const { parseCommitInput } = await import('../dist/index.js')
  assert.deepEqual(parseCommitInput('auth:修复登录失败'), { scope: 'auth', subject: '修复登录失败' })
  assert.deepEqual(parseCommitInput('fix: 修复登录失败'), { scope: '', subject: '修复登录失败' })
  assert.deepEqual(parseCommitInput('see https://example.com'), { scope: '', subject: 'see https://example.com' })
  assert.deepEqual(parseCommitInput('https://example.com 文档'), { scope: '', subject: 'https://example.com 文档' })
  assert.deepEqual(parseCommitInput('修复 登录:失败'), { scope: '', subject: '修复 登录:失败' })
  assert.deepEqual(parseCommitInput(':只有冒号'), { scope: '', subject: ':只有冒号' })
  assert.deepEqual(parseCommitInput('   '), { scope: '', subject: '' })
  assert.deepEqual(parseCommitInput('fix:'), { scope: '', subject: '' })
})

test('换行与制表符按空格处理；其它控制字符给出对应提示且界面如实显示', async () => {
  const tab = buildConventionalCommit({ type: 'fix', subject: '修复\t登录\r\n失败' })
  assert.equal(tab.isValid, true)
  assert.equal(tab.message, 'fix: 修复 登录 失败')
  const bad = buildConventionalCommit({ type: 'fix', subject: '坏\u0007内容' })
  assert.equal(bad.isValid, false)
  assert.match(bad.validationHint, /控制字符/)
  assert.match(buildConventionalCommit({ type: 'fix', subject: '' }).validationHint, /不能为空/)
  const commit = await open(commands['git-commit-builder'])
  commit.tree().props.onSearchTextChange('坏\u0007内容'); await tick()
  assert.match(commit.text(), /控制字符/)
  assert.doesNotMatch(commit.text(), /复制完整 git commit 命令/)
})

test('忽略模板：保留 Cargo.lock、包装器 jar 与 vendor/，macOS 条目齐全且否定规则在忽略规则之后', () => {
  const rust = generateGitignoreContent(['Rust']).content.split('\n')
  assert.ok(!rust.includes('Cargo.lock'))
  const go = generateGitignoreContent(['Go']).content.split('\n')
  assert.ok(!go.includes('vendor/'))
  const java = generateGitignoreContent(['Java']).content.split('\n')
  const jar = java.indexOf('*.jar')
  assert.ok(jar >= 0 && java.indexOf('!gradle/wrapper/gradle-wrapper.jar') > jar && java.indexOf('!.mvn/wrapper/maven-wrapper.jar') > jar)
  const mac = generateGitignoreContent(['macOS']).content.split('\n')
  for (const rule of ['.DS_Store', '._*', '.fseventsd', '.TemporaryItems', '.DocumentRevisions-V100']) assert.ok(mac.includes(rule), rule)
})

test('真实 Git：Java 模板不会忽略 Gradle 包装器 jar，Rust 模板不会忽略 Cargo.lock', () => {
  const { root, git } = fixture()
  fs.writeFileSync(path.join(root, '.gitignore'), generateGitignoreContent(['Java', 'Rust', 'macOS']).content)
  fs.mkdirSync(path.join(root, 'gradle/wrapper'), { recursive: true })
  for (const file of ['gradle/wrapper/gradle-wrapper.jar', 'lib.jar', 'Cargo.lock', '.DS_Store']) fs.writeFileSync(path.join(root, file), 'x')
  const ignored = file => { try { git('check-ignore', '-q', file); return true } catch { return false } }
  assert.equal(ignored('gradle/wrapper/gradle-wrapper.jar'), false)
  assert.equal(ignored('Cargo.lock'), false)
  assert.equal(ignored('lib.jar'), true)
  assert.equal(ignored('.DS_Store'), true)
})

const withPlatform = async (platform, fn) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { platform, userAgent: '' }, configurable: true })
  try { return await fn() } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  }
}

test('gitignore 默认只勾当前系统与常用 IDE，详情显示模板中文名，首行注释简短，勾选动作标题不截断', async () => {
  for (const [platform, system, other] of [['MacIntel', 'macOS', 'Windows'], ['Win32', 'Windows', 'macOS']]) {
    await withPlatform(platform, async () => {
      const ignore = await open(commands['gitignore-generator'])
      const checked = ignore.items().filter(i => i.props.accessories[0].tag === '已勾选合并').map(i => i.props.id)
      assert.deepEqual(checked.sort(), [system, 'IDEs'].sort(), platform)
      assert.ok(ignore.items().find(i => i.props.id === other).props.accessories[0].tag === '未选')
      const merged = ignore.item('IDEs').props.detail.props.metadata.children.find(c => c.props.title === '已合并技术栈').props.text
      assert.match(merged, /VS Code \/ Cursor \/ JetBrains IDE/)
      assert.doesNotMatch(merged, /^(macOS|Windows|IDEs)(、|$)|IDEs/)
      const titles = ignore.actions(ignore.item('IDEs')).map(a => a.props.title)
      assert.ok(titles.includes('取消勾选'))
      assert.ok(ignore.actions(ignore.item('Node')).some(a => a.props.title === '勾选'))
    })
  }
  const content = generateGitignoreContent(['Node', 'ReactVue', 'macOS']).content
  const first = content.split('\n')[0]
  assert.equal(first, '# 由 ZTools Git 助手生成')
  assert.ok(first.length < 40)
  assert.match(content, /### Node\.js \/ TypeScript ###/)
})

test('翻车详情不重复首选命令；提交类型副标题各不相同、无前缀标签，未写说明时也有主动作', async () => {
  const emergency = await open(commands['git-emergency'])
  for (const entry of GIT_EMERGENCY_DATABASE) {
    const md = emergency.item(entry.id).props.detail.props.markdown
    const occurrences = md.split('```bash\n' + entry.primaryCommand + '\n```').length - 1
    assert.equal(occurrences, 1, entry.id)
    assert.equal(emergency.actions(emergency.item(entry.id))[0].props.title, '复制首选救命命令')
  }
  const commit = await open(commands['git-commit-builder'])
  const items = commit.items()
  assert.equal(new Set(items.map(i => i.props.subtitle)).size, items.length)
  assert.ok(items.every(i => !(i.props.accessories || []).some(a => String(a.tag || '').startsWith('前缀'))))
  await commit.run(commit.item('feat'), '复制类型前缀 feat:')
  assert.equal(host.clipboard.text, 'feat: ')
  // 控制字符输入：仍只给前缀，不生成可执行命令
  commit.tree().props.onSearchTextChange('坏\u0000内容'); await tick()
  assert.doesNotMatch(commit.text(), /复制完整 git commit 命令/)
  assert.equal(commit.actions(commit.item('fix'))[0].props.title, '复制类型前缀 fix:')
})

test('提交生成器用中性文案：分组标题不写内部规范说法，示例不涉及具体内部业务', async () => {
  const { COMMIT_TYPES } = await import('../dist/index.js')
  const commit = await open(commands['git-commit-builder'])
  const text = commit.text()
  assert.doesNotMatch(text, /强制中文|团队标准|企业微信|扫码登录|41 款|咽喉|门禁|MFT|标杆插件/)
  assert.match(text, /选择 Conventional Commits 提交类型/)
  for (const t of COMMIT_TYPES) {
    assert.ok(t.examples.length > 0, t.type)
    for (const ex of t.examples) assert.match(ex, new RegExp(`^${t.type}\\([a-z]+\\): \\S`), ex)
  }
  commit.tree().props.onSearchTextChange('auth:修复登录失败'); await tick()
  await commit.run(commit.item('fix'), '仅复制提交说明')
  assert.equal(host.clipboard.text, 'fix(auth): 修复登录失败')
  assert.doesNotMatch(buildConventionalCommit({ type: 'fix', subject: '' }).message, /中文/)
})
