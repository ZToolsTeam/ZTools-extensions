import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { commands, GIT_EMERGENCY_DATABASE, buildEmergencyGuide, buildConventionalCommit, generateGitignoreContent } from '../dist/index.js'

const host = createHost(), views = []
const undo = GIT_EMERGENCY_DATABASE.find(item => item.id === 'undo-last-commit-keep-changes')
const macOnly = { skip: process.platform !== 'darwin' ? '实际 zsh 与 Git 场景在 macOS 验收' : false }
const env = { ...process.env, GIT_AUTHOR_NAME: '插件隔离测试', GIT_AUTHOR_EMAIL: 'audit@example.invalid', GIT_COMMITTER_NAME: '插件隔离测试', GIT_COMMITTER_EMAIL: 'audit@example.invalid' }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-git-helper-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const shell = command => execFileSync('/bin/zsh', ['-f', '-c', command], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
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
test.afterEach(() => views.splice(0).forEach(view => view.unmount()))

test('真实 Git：撤销只回退一次并保留恢复分支、暂存与未暂存内容', macOnly, () => {
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

test('整份操作指南粘进 shell 也不会依次执行互斥操作', macOnly, () => {
  const { git, shell, commits } = fixture()
  for (const item of GIT_EMERGENCY_DATABASE) {
    const guide = buildEmergencyGuide(item)
    assert.ok(guide.split('\n').every(line => line.startsWith('# ')))
    shell(guide)
    assert.equal(git('rev-parse', 'HEAD'), commits[2])
    assert.equal(git('status', '--short'), '')
  }
})

test('真实 Git：创建工作分支保留未提交内容及原分支', macOnly, () => {
  const { root, git, shell, commits } = fixture()
  fs.writeFileSync(path.join(root, 'sample.txt'), '继续开发内容')
  shell(GIT_EMERGENCY_DATABASE.find(item => item.id === 'committed-to-wrong-branch').primaryCommand)
  assert.equal(git('branch', '--show-current'), 'feat/new-work')
  assert.equal(git('rev-parse', 'main'), commits[2])
  assert.equal(fs.readFileSync(path.join(root, 'sample.txt'), 'utf8'), '继续开发内容')
})

test('真实 zsh：提交说明中的命令替换、引号、感叹号均为字面内容', macOnly, () => {
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
  assert.match(ignore.text(), /node_modules/)
  await ignore.search('Python')
  assert.equal(ignore.items().length, 1)
  assert.equal(ignore.items()[0].props.id, 'Python')
  await ignore.run(ignore.items()[0], '勾选加入 Python / PyTorch / Poetry')
  assert.match(ignore.text(), /已选 6 个栈/)
  assert.match(ignore.text(), /node_modules/, '筛选不清除原有勾选')
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
