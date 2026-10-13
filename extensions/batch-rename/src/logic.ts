export interface RenameRule {
  type: 'replace' | 'prefix' | 'suffix' | 'case' | 'number'
  find?: string
  replace?: string
  prefix?: string
  suffix?: string
  caseMode?: 'upper' | 'lower' | 'title'
  startNumber?: number
  padDigits?: number
}

export interface RenameResultItem {
  id: string
  oldName: string
  newName: string
  changed: boolean
}

/**
 * 分离主文件名与扩展名
 */
export function splitFileName(fullName: string): { baseName: string; extension: string } {
  const lastDot = fullName.lastIndexOf('.')
  if (lastDot > 0) {
    return {
      baseName: fullName.slice(0, lastDot),
      extension: fullName.slice(lastDot)
    }
  }
  return {
    baseName: fullName,
    extension: ''
  }
}

/**
 * 首字母大写
 */
function toTitleCase(str: string): string {
  return str.replace(/[A-Za-z]+/g, word => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  })
}

/**
 * 单个文件名应用规则
 */
export function applyRenameRule(fileName: string, rule: RenameRule, index: number): string {
  const { baseName, extension } = splitFileName(fileName)
  let newBaseName = baseName
  let newExtension = extension

  switch (rule.type) {
    case 'replace': {
      if (rule.find) {
        newBaseName = newBaseName.split(rule.find).join(rule.replace || '')
      }
      break
    }
    case 'prefix': {
      if (rule.prefix) {
        newBaseName = `${rule.prefix}${newBaseName}`
      }
      break
    }
    case 'suffix': {
      if (rule.suffix) {
        newBaseName = `${newBaseName}${rule.suffix}`
      }
      break
    }
    case 'case': {
      if (rule.caseMode === 'upper') {
        newBaseName = newBaseName.toUpperCase()
        newExtension = newExtension.toUpperCase()
      } else if (rule.caseMode === 'lower') {
        newBaseName = newBaseName.toLowerCase()
        newExtension = newExtension.toLowerCase()
      } else if (rule.caseMode === 'title') {
        newBaseName = toTitleCase(newBaseName)
      }
      break
    }
    case 'number': {
      const start = rule.startNumber ?? 1
      const pad = rule.padDigits ?? 2
      const numStr = String(start + index).padStart(pad, '0')
      newBaseName = `${newBaseName}_${numStr}`
      break
    }
  }

  return `${newBaseName}${newExtension}`
}

/**
 * 批量应用重命名规则
 */
export function batchApplyRename(files: string[], rule: RenameRule): RenameResultItem[] {
  return files.map((file, index) => {
    const newName = applyRenameRule(file, rule, index)
    return {
      id: `file-${index}`,
      oldName: file,
      newName,
      changed: file !== newName
    }
  })
}

/**
 * 样例演示文件列表
 */
export function getSampleFiles(): string[] {
  return [
    'IMG_2026_01.JPG',
    'IMG_2026_02.JPG',
    'IMG_2026_03.JPG',
    'document_draft_v1.docx',
    'my-awesome-video-clip.mp4'
  ]
}
