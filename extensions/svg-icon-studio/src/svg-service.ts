import type { SvgProcessResult } from './types.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const elements = new Set(('svg g a defs symbol use path rect circle ellipse line polyline polygon text tspan textPath title desc linearGradient radialGradient stop clipPath mask pattern marker filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence').split(' '))
const presentation = new Set(('alignment-baseline baseline-shift clip-path clip-rule color color-interpolation color-interpolation-filters direction display dominant-baseline fill fill-opacity fill-rule filter flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight image-rendering isolation letter-spacing lighting-color marker-end marker-mid marker-start mask opacity overflow paint-order pointer-events shape-rendering stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering unicode-bidi vector-effect visibility white-space word-spacing writing-mode').split(' '))
const attributes = new Set(('id class role tabindex focusable width height x y x1 y1 x2 y2 cx cy r rx ry d points pathLength dx dy rotate textLength lengthAdjust startOffset method spacing side viewBox preserveAspectRatio transform gradientUnits gradientTransform spreadMethod offset fx fy fr clipPathUnits maskUnits maskContentUnits patternUnits patternContentUnits patternTransform markerWidth markerHeight markerUnits refX refY orient filterUnits primitiveUnits in in2 result mode type values operator k1 k2 k3 k4 order kernelMatrix divisor bias targetX targetY edgeMode kernelUnitLength preserveAlpha surfaceScale diffuseConstant scale xChannelSelector yChannelSelector azimuth elevation stdDeviation tableValues slope intercept amplitude exponent radius specularConstant specularExponent limitingConeAngle pointsAtX pointsAtY pointsAtZ z baseFrequency numOctaves seed stitchTiles').split(' '))
const geometry = new Set('path rect circle ellipse line polyline polygon'.split(' '))
const localId = /^[A-Za-z_][\w:.-]{0,255}$/
const camelName = (name: string) => name.replace(/[:-]([a-z])/g, (_, letter: string) => letter.toUpperCase())
function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`) }

interface SvgElement {
  name: string
  attrs: [string, string][]
  styleValues: Record<string, string>
  children: SvgNode[]
  references: string[]
}
type SvgNode = SvgElement | string

function escapeXml(text: string, attribute = false): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return attribute ? escaped.replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;') : escaped.replace(/\r/g, '&#13;')
}

// 组件模板中的内容始终作为字符串；包括实体、插值分隔符和换行分隔符。
function literal(value: string | Record<string, unknown>): string {
  const unsafe = typeof value === 'string' ? /[<>&{}\u2028\u2029]/g : /[<>&\u2028\u2029]/g
  return JSON.stringify(value).replace(unsafe, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function readStaticSvg(input: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) fail('UNSUPPORTED_DTD', '不支持 DTD 或实体定义，请使用独立的静态 SVG')
  if (typeof DOMParser === 'undefined') fail('XML_PARSER_UNAVAILABLE', '当前环境没有 XML 解析器')
  // 只读取独立 XML 文档，绝不将输入节点插入客户端界面。
  const parsed = new DOMParser().parseFromString(input, 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || root.localName !== 'svg' || (root.namespaceURI && root.namespaceURI !== SVG_NS) || parsed.getElementsByTagNameNS('*', 'parsererror').length) {
    fail('INVALID_SVG_DOCUMENT', 'SVG XML 不合法，或根节点不是 SVG')
  }
  const acceptedNamespace = root.namespaceURI
  const warnings = new Set<string>(), ids = new Map<string, SvgElement>()
  let nodeCount = 0, removedItems = 0, pathCount = 0
  const removed = (reason: string) => { removedItems++; if (warnings.size < 30) warnings.add(reason) }
  function safeValue(name: string, value: string, references: string[]): boolean {
    if (name === 'href') {
      if (!value.startsWith('#') || !localId.test(value.slice(1))) return false
      references.push(value.slice(1))
      return true
    }
    // CSS 转义及注释会改变 URL 词法，静态子集不接收这些写法。
    if (/[\\<>@{}]|\/\*|\*\//.test(value)) return false
    const rest = value.replace(/url\(\s*(?:"#([\w:.-]+)"|'#([\w:.-]+)'|#([\w:.-]+))\s*\)/gi, (_match, a: string, b: string, c: string) => {
      const id = a || b || c
      if (!localId.test(id)) return 'url('
      references.push(id)
      return ''
    })
    return !/url\s*\(/i.test(rest)
  }
  function readStyle(source: string, references: string[]) {
    const style: Record<string, string> = {}
    const names = new Set<string>()
    for (const declaration of source.split(';')) {
      if (!declaration.trim()) continue
      const match = declaration.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i)
      if (!match || !presentation.has(match[1].toLowerCase()) || /!|[\\{}@]|\/\*|\*\//.test(match[2]) || !/^(?:[^'"]|'[^']*'|"[^"]*")*$/.test(match[2])) {
        fail('UNSUPPORTED_STYLE', '内联样式含不支持的属性或语法，请先转为 SVG 静态展示属性')
      }
      const name = match[1].toLowerCase(), value = match[2]
      const refs: string[] = []
      if (!safeValue(name, value, refs)) fail('UNSAFE_STYLE', '内联样式只能引用本 SVG 内的 #id，不能包含外部资源或转义语法')
      names.add(name)
      references.push(...refs)
    }
    // 由浏览器 CSS 解析器决定重复/无效声明的最终值；只读独立文档中的样式数据。
    const cssRoot = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}" style="${escapeXml(source, true)}"/>`, 'image/svg+xml').documentElement as unknown as SVGElement
    if (!cssRoot.style) fail('CSS_PARSER_UNAVAILABLE', '当前环境没有 SVG 样式解析器')
    for (const name of names) {
      const value = cssRoot.style.getPropertyValue(name)
      if (!value) fail('UNSUPPORTED_STYLE', `内联样式 ${name} 无效或当前环境不支持`)
      style[camelName(name)] = value
    }
    return { values: style, cssText: cssRoot.style.cssText }
  }
  function read(node: Node, depth: number): SvgNode | null {
    if (++nodeCount > 5000 || depth > 64) fail('SVG_COMPLEXITY_LIMIT', 'SVG 超过 5000 个节点或 64 层嵌套上限')
    if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || ''
    if (node.nodeType !== 1) {
      if (node.nodeType === 7) removed('已移除处理指令')
      return null
    }
    const element = node as Element, name = element.localName
    if (element.namespaceURI !== acceptedNamespace || !elements.has(name)) {
      removed(`已移除非静态图形元素：${element.tagName}`)
      return null
    }
    const item: SvgElement = { name, attrs: [], styleValues: {}, children: [], references: [] }
    if (geometry.has(name)) pathCount++
    for (const attr of Array.from(element.attributes)) {
      if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue
      let key = attr.name
      const value = attr.value
      if (attr.namespaceURI === XLINK_NS && attr.localName === 'href') key = 'href'
      else if (attr.namespaceURI === XML_NS && ['space', 'lang'].includes(attr.localName)) key = `xml:${attr.localName}`
      else if (attr.namespaceURI) { removed(`已移除不支持的命名空间属性：${key}`); continue }
      if (key === 'style') {
        const style = readStyle(value, item.references)
        item.styleValues = style.values
        item.attrs.push(['style', style.cssText])
        continue
      }
      if (!(attributes.has(key) || presentation.has(key) || ['href', 'xml:space', 'xml:lang'].includes(key) || /^(?:aria|data)-[a-z][a-z0-9-]*$/.test(key))) {
        removed(`已移除不支持的属性：${key}`)
        continue
      }
      if (key === 'id') {
        if (!localId.test(value) || ids.has(value)) fail('INVALID_SVG_ID', 'SVG 包含重复 ID 或不支持的 ID 格式（字母/下划线开头，最长 256 字符）')
        ids.set(value, item)
      }
      if (key === 'tabindex' && !/^[+-]?\d{1,6}$/.test(value)) fail('INVALID_SVG_ATTRIBUTE', 'tabindex 必须是整数')
      if (key === 'preserveAlpha' && !['true', 'false'].includes(value)) fail('INVALID_SVG_ATTRIBUTE', 'preserveAlpha 必须是 true 或 false')
      if (presentation.has(key) || key === 'href') {
        const refs: string[] = []
        if (!safeValue(key, value, refs)) { removed(`已移除外部引用或不支持的展示属性：${key}`); continue }
        item.references.push(...refs)
      }
      if (item.attrs.some(([previous]) => previous === key)) fail('DUPLICATE_SVG_ATTRIBUTE', `SVG 包含重复的 ${key} 属性`)
      item.attrs.push([key, value])
    }
    for (const child of Array.from(element.childNodes)) {
      const result = read(child, depth + 1)
      if (result !== null) item.children.push(result)
    }
    return item
  }
  // XML 声明以外的顶层处理指令也不能带进导出结果。
  for (const node of Array.from(parsed.childNodes)) if (node.nodeType === 7 && node.nodeName !== 'xml') removed('已移除处理指令')
  const tree = read(root, 0) as SvgElement
  tree.attrs.unshift(['xmlns', SVG_NS])
  const visiting = new Set<SvgElement>(), sizes = new Map<SvgElement, { size: number; height: number }>()
  function expandedSize(item: SvgElement, depth = 0): { size: number; height: number } {
    if (depth > 128) fail('SVG_COMPLEXITY_LIMIT', 'SVG 引用链超过 128 层上限')
    if (visiting.has(item)) fail('CYCLIC_SVG_REFERENCE', 'SVG 存在循环引用')
    const cached = sizes.get(item)
    if (cached !== undefined) {
      if (depth + cached.height > 128) fail('SVG_COMPLEXITY_LIMIT', 'SVG 引用链超过 128 层上限')
      return cached
    }
    visiting.add(item)
    let size = 1, height = 0
    const targets = item.references.map(id => ids.get(id) || fail('MISSING_SVG_REFERENCE', `SVG 引用的 #${id} 不存在或已被移除`))
    for (const child of [...item.children.filter((child): child is SvgElement => typeof child !== 'string'), ...targets]) {
      const expanded = expandedSize(child, depth + 1)
      size += expanded.size
      height = Math.max(height, expanded.height + 1)
      if (size > 20000) fail('SVG_COMPLEXITY_LIMIT', 'SVG 引用展开超过 20000 个节点上限')
    }
    if (depth + height > 128) fail('SVG_COMPLEXITY_LIMIT', 'SVG 引用链超过 128 层上限')
    const measured = { size, height }
    visiting.delete(item); sizes.set(item, measured)
    return measured
  }
  expandedSize(tree)
  return { tree, warnings: [...warnings], removedItems, pathCount }
}

function serialize(node: SvgNode, format: 'svg' | 'react' | 'vue', root = false): string {
  if (typeof node === 'string') {
    if (format === 'svg') return escapeXml(node)
    return format === 'react' ? literal(node) : `{{ ${literal(node)} }}`
  }
  const children = node.children.map(child => serialize(child, format))
  if (format === 'react') {
    const props: Record<string, unknown> = {}
    for (const [key, value] of node.attrs) {
      const prop = key === 'class' ? 'className' : key === 'tabindex' ? 'tabIndex' : /^(aria|data)-/.test(key) ? key : camelName(key)
      props[prop] = key === 'style' ? node.styleValues : key === 'tabindex' ? Number(value) : key === 'preserveAlpha' ? value === 'true' : value
    }
    // createElement 按 SVG 上下文渲染，也避免 JSX 把 a/title 错判为 HTML 属性类型。
    const properties = root ? `{ ...${literal(props)}, ...props }` : literal(props)
    return `React.createElement(${literal(node.name)}, ${properties}${children.length ? ', ' + children.join(', ') : ''})`
  }
  const attrs = node.attrs.map(([key, value]) => ` ${key}="${escapeXml(value, true)}"`).join('')
  const opening = `<${node.name}${attrs}`
  return children.length ? `${opening}>${children.join('')}</${node.name}>` : `${opening}/>`
}

export function optimizeSvgSource(rawInput: string): SvgProcessResult {
  if (typeof rawInput !== 'string' || !rawInput.trim()) fail('EMPTY_SVG_INPUT', 'SVG 源码不能为空')
  const originalBytes = new TextEncoder().encode(rawInput).length
  if (originalBytes > 256 * 1024) fail('SVG_SIZE_LIMIT', 'SVG 源码不能超过 256 KiB')
  const { tree, warnings, removedItems, pathCount } = readStaticSvg(rawInput)
  const optimizedSvg = serialize(tree, 'svg')
  const encoded = new TextEncoder().encode(optimizedSvg)
  const savedBytes = originalBytes - encoded.length
  const reactTsxCode = ["import React from 'react'", '', 'export function SvgIcon(props: React.SVGProps<SVGSVGElement>): React.ReactElement {', `  return (${serialize(tree, 'react', true)})`, '}', '', 'export default SvgIcon'].join('\n')
  const vueSfcCode = ['<script setup lang="ts">', '// 静态 SVG 图标；文本按字面内容保留。', '</script>', '', '<template>', `  ${serialize(tree, 'vue', true)}`, '</template>'].join('\n')
  let binary = ''
  for (const byte of encoded) binary += String.fromCharCode(byte)
  return {
    originalSvg: rawInput, optimizedSvg, reactTsxCode, vueSfcCode,
    dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(optimizedSvg)}`,
    base64DataUri: `data:image/svg+xml;base64,${btoa(binary)}`,
    warnings,
    metrics: { originalBytes, optimizedBytes: encoded.length, savedBytes, savedPercentage: Math.round(savedBytes / originalBytes * 1000) / 10, viewBox: tree.attrs.find(([key]) => key === 'viewBox')?.[1] || '未设置', pathCount, removedItems },
  }
}
