import test from 'node:test'
import assert from 'node:assert/strict'
import { detectAndParse, parseDelimitedRows, gridToJson, gridToCsv, gridToHtml, gridToMarkdown, gridToSql } from '../dist/table-service.js'
const grid = (text, header = true) => detectAndParse(text, header).grid
const json = (text, header = true) => JSON.parse(gridToJson(grid(text, header)))

test('长数字、前导零、负零和有意义的空格不被类型推断改写', () => {
  for (const value of ['9007199254740993', '001', '-0', '0.10000000000000001', ' 12 ']) {
    assert.equal(json(`id\n${value}`)[0].id, value)
  }
  assert.equal(json('n,ok\n12,true')[0].n, 12)
  assert.equal(json('n,ok\n12,true')[0].ok, true)
})

test('重复表头与原型属性保留全部单元格，生成名称避开已有列名', () => {
  const rows = json('name,name,name_2,__proto__,constructor\n甲,乙,丙,丁,戊')
  assert.deepEqual(Object.values(rows[0]), ['甲', '乙', '丙', '丁', '戊'])
  assert.equal(Object.keys(rows[0]).length, 5)
  assert.equal(rows[0].__proto__, '丁')
})

test('JSON 对象、数组、字符串数字、空字符串、null 与缺失键保持语义', () => {
  const input = [{ a: { x: 1 }, b: '001', c: [true, null], d: '', e: null }, { b: '2' }]
  assert.deepEqual(json(JSON.stringify(input)), input)
  assert.match(gridToCsv(grid(JSON.stringify(input))), /x/)
  assert.doesNotMatch(gridToCsv(grid(JSON.stringify(input))), /\[object Object\]/)
  assert.deepEqual(json('[{"__proto__":{"x":1},"constructor":"value"}]'), JSON.parse('[{"__proto__":{"x":1},"constructor":"value"}]'))
})

test('JSON 无效、混合行、重复键与精度溢出明确失败，空数组保持空', () => {
  for (const input of ['[{"a":1}', '[{"a":1},2]', '[{"a":1,"a":2}]', '[{"id":9007199254740993}]', '[{"n":0.10000000000000001}]']) assert.throws(() => grid(input), input)
  assert.deepEqual(json('[]'), [])
  assert.equal(detectAndParse('[]').format, 'json')
  assert.deepEqual(json('[{"n":1.2e2,"zero":0,"ok":false}]'), [{ n: 120, zero: 0, ok: false }])
})

test('CSV 引号内 CRLF、分隔符、双引号、空行及末尾空列均保留', () => {
  const input = 'a,b,c\r\n"甲\r\n乙","x,y","a""b"\r\n"",,\r\n'
  assert.deepEqual(parseDelimitedRows(input, ','), [['a','b','c'],['甲\r\n乙','x,y','a"b'],['','','']])
  assert.deepEqual(parseDelimitedRows('a\n""\n\n', ','), [['a'],[''],['']])
  assert.deepEqual(grid('\ta\t\nx\ty\t').rows, [['x','y','']])
  assert.equal(json('a\n""')[0].a, '')
})

test('CSV 畸形引号和列数不一致停止转换，不输出部分表格', () => {
  for (const input of ['a\n"unterminated', 'a\n"ok"tail', 'a\nbad"quote', 'a,b\n1', 'a\n1,2']) assert.throws(() => grid(input), input)
})

test('CSV 输出及重新导入保留 CR、LF、空白、引号和空字符串', () => {
  const source = [{ a: '甲\r乙', b: ' x ', c: '"', d: '' }, { a: '', b: 'a\nb', c: 'x,y', d: 'z' }]
  const converted = gridToCsv(grid(JSON.stringify(source)))
  assert.match(converted, /\r\n/)
  assert.deepEqual(json(converted), source)
})

test('HTML 表格字符实体与换行正确读取；合并或多个表格拒绝猜测', () => {
  const parsed = json('<table><tr><th>name</th></tr><tr><td>A &lt; B &amp; &#x4e2d;<br>文</td></tr></table>')
  assert.equal(parsed[0].name, 'A < B & 中\n文')
  const source = [{ name: '<b>&"\r\n尾巴' }]
  assert.deepEqual(json(gridToHtml(grid(JSON.stringify(source)))), source)
  for (const input of ['<table><tr><td colspan="2">x</td></tr></table>', '<table><tr><td>x</td></tr></table><table><tr><td>y</td></tr></table>']) assert.throws(() => grid(input))
})

test('Markdown 代码与 HTML 原样作为表格文字，换行与反斜杠可往返', () => {
  const source = [{ name: 'x|y\\z\n<script>x</script>' }]
  const text = gridToMarkdown(grid(JSON.stringify(source)))
  assert.doesNotMatch(text, /<script>/)
  assert.deepEqual(json(text), source)
})

test('SQL INSERT 输入支持多行常量、引号、空字符串与 NULL，不执行语句', () => {
  const input = 'INSERT INTO "表" ("name", "count", "empty", "none") VALUES (\'O\'\'Brien\', 2, \'\', NULL), (\'路径\\文件\', 0, \'x\', NULL);'
  assert.equal(detectAndParse(input).format, 'sql')
  assert.deepEqual(json(input), [{ name: "O'Brien", count: 2, empty: '', none: null }, { name: '路径\\文件', count: 0, empty: 'x', none: null }])
  for (const input of ['INSERT INTO t(a) VALUES (now());', 'INSERT INTO t(a) VALUES (1); DELETE FROM t;', 'INSERT INTO t(a,b) VALUES (1);']) assert.throws(() => grid(input))
})

test('SQL 输出完整引用标识符，并保留单引号、反斜杠、空值和长数字', () => {
  const source = [{ 'a"b': "x\\'; DROP TABLE t; --", empty: '', nil: null, id: '001' }]
  const output = gridToSql(grid(JSON.stringify(source)), '表"名')
  assert.match(output, /INSERT INTO "表""名"/)
  assert.deepEqual(json(output), source)
})

test('长单元格不会把 Markdown 补齐到巨大输出，数字列仍可重新读取', () => {
  const input = 'value\n' + 'x'.repeat(100_000) + '\n' + Array(1000).fill('a').join('\n')
  const output = gridToMarkdown(grid(input))
  assert.ok(output.length < 300_000)
  assert.deepEqual(json(gridToMarkdown(grid('n,ok\n12,true'))), [{ n: 12, ok: true }])
  assert.throws(() => grid('a\n' + Array(50_001).fill('x').join('\n')), /拆分/)
})

test('HTML 属性中的大于号不会混入正文，格式错误不能被跳过', () => {
  assert.deepEqual(json('<table><tr><th title="a>b">name</th></tr><tr><td><span title="x>y">甲</span></td></tr></table>'), [{ name: '甲' }])
  for (const input of ['<table><tr><td>x</tr></td></table>', '<table><tr><td><img src="x"></td></tr></table>', '<table><tr><td>ok</td></tr></table><']) assert.throws(() => grid(input))
})

test('SQLite 大小写重名列拒绝，其他格式仍有完整结果', async () => {
  const { buildAllConversionTargets } = await import('../dist/table-service.js')
  const source = grid('a,A\n甲,乙'), targets = buildAllConversionTargets(source)
  assert.match(targets.find(t => t.id === 'sql').error, /大小写/)
  assert.deepEqual(JSON.parse(targets.find(t => t.id === 'json').fullText), [{ a: '甲', A: '乙' }])
  assert.throws(() => grid('INSERT INTO t(a,A) VALUES (1,2)'), /重复/)
  const nulTargets = buildAllConversionTargets(grid('[{"a":"\\u0000"}]'))
  assert.match(nulTargets.find(t => t.id === 'sql').error, /NUL/)
  assert.equal(JSON.parse(nulTargets.find(t => t.id === 'json').fullText)[0].a, '\0')
})

test('CSV 自动识别忽略引号内制表符，手动格式可处理有歧义的文本', () => {
  assert.equal(detectAndParse('"a\tb",c\nx,y').format, 'csv')
  assert.equal(detectAndParse('[text]\nvalue', true, 'csv').grid.headers[0], '[text]')
  assert.deepEqual(json('a,b\n,0'), [{ a: '', b: 0 }])
})

test('稀疏 JSON 在展开矩阵前检查规模，长表头的 JSON 输出有累积预算', async () => {
  const { buildAllConversionTargets } = await import('../dist/table-service.js')
  const sparse = Array.from({ length: 1000 }, (_, i) => ({ ['k' + i]: 'v' }))
  assert.throws(() => grid(JSON.stringify(sparse)), /单元格/)
  const input = 'h'.repeat(100_000) + '\n' + Array(200).fill('v').join('\n')
  const source = grid(input)
  assert.throws(() => gridToJson(source), /8 MiB/)
  const targets = buildAllConversionTargets(source)
  assert.match(targets.find(t => t.id === 'json').error, /8 MiB/)
  assert.ok(targets.find(t => t.id === 'csv').fullText)
})

test('文本空白单元格不被当成无输入，JSON 空键及数组原类型保留', () => {
  assert.equal(json('  ', false)[0].col_1, '  ')
  assert.deepEqual(json('[{"":"value"}]'), [{ '': 'value' }])
  assert.deepEqual(json('[["a","b"],["001",{"nested":true}]]'), [{ a: '001', b: { nested: true } }])
})

test('SQLite 显式空列名保持原名，不自动改写成 col_1', () => {
  const source = [{ '': '保留' }]
  assert.deepEqual(json(gridToSql(grid(JSON.stringify(source)))), source)
})

test('Markdown 保留边界 Unicode 空白和制表符，并转义文字中的格式语法', () => {
  for (const value of ['\u00a0x\u00a0', '\tx\t', '\u2003空白\u2003', '**literal**', '[literal](https://example.invalid)', '`code`', 'line_1']) {
    const source = [{ a: value }], markdown = gridToMarkdown(grid(JSON.stringify(source)))
    assert.deepEqual(json(markdown), source)
    assert.doesNotMatch(markdown, /\*\*literal\*\*|\[literal\]\(|`code`/)
  }
})

test('SQL 只接受 SQLite 空白，不将 NBSP 或竖向制表符当分隔符', () => {
  for (const input of ['INSERT\u00a0INTO t(a) VALUES (1)', 'INSERT INTO t(a) VALUES\u00a0(1)', '\u00a0INSERT INTO t(a) VALUES (1)', 'INSERT INTO t(a) VALUES (1)\u00a0', 'INSERT\vINTO t(a) VALUES (1)']) assert.throws(() => grid(input))
  assert.deepEqual(json('INSERT\tINTO t(a) VALUES\f(1);\r\n'), [{ a: 1 }])
})

test('GFM 短分隔行（|-|、|:-:|）识别为 Markdown，不被误当作单列 CSV', () => {
  for (const input of ['| a | b |\n|-|-|\n| 1 | 2 |', '| a | b |\n|:-:|--:|\n| 1 | 2 |', 'a | b\n- | -\n1 | 2']) {
    const parsed = detectAndParse(input)
    assert.equal(parsed.format, 'markdown', input)
    assert.deepEqual(parsed.grid.headers, ['a', 'b'])
    assert.deepEqual(parsed.grid.rows, [['1', '2']])
  }
  // 普通 CSV 里含 - 的单元格不受影响
  assert.equal(detectAndParse('a,b\n-,-\n1,2').format, 'csv')
  // 分隔行缺少 - 时仍明确报错
  assert.throws(() => detectAndParse('| a |\n| :: |\n| 1 |', true, 'markdown'), /分隔行/)
})

test('Markdown 输出中普通小数和时间保持可读，网址与邮箱仍转义防止自动链接，均可无损读回', () => {
  const source = [{ price: '3.14', time: '12:30', note: '(备注)', url: 'https://x.example/a.b', mail: 'a@b.example' }]
  const markdown = gridToMarkdown(grid(JSON.stringify(source)))
  assert.match(markdown, /\| 3\.14 +\|/)
  assert.match(markdown, /\| 12:30 +\|/)
  assert.match(markdown, /\| \(备注\) +\|/)
  assert.doesNotMatch(markdown, /https:\/\/|a@b/)
  // 文字表格不携带类型：读回时 3.14 按可安全往返的数字推断为数值，其余文本原样
  assert.deepEqual(json(markdown), [{ ...source[0], price: 3.14 }])
})
