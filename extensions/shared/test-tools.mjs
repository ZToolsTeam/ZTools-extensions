import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// Git for Windows 的 POSIX 工具不会默认加入 PATH；测试显式使用随 Git 安装的程序。
export function gitTestTool(name) {
  if (!['bash', 'diff', 'patch'].includes(name)) throw new Error(`未知测试工具：${name}`)
  if (process.platform !== 'win32') return name
  const gitPaths = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
  for (const git of gitPaths) {
    for (const root of [path.resolve(path.dirname(git), '..'), path.resolve(path.dirname(git), '../..')]) {
      const executable = path.join(root, 'usr', 'bin', `${name}.exe`)
      if (fs.existsSync(executable)) return executable
    }
  }
  throw new Error(`真实集成测试需要 Git for Windows 自带的 ${name}.exe，请检查 Git 安装`)
}
