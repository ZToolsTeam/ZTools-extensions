import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { commands, formatAndMinifySql, mergeMyBatisLog, parseDdlToEntities } from '../dist/index.js'

const host = createHost(), views = []
test.beforeEach(() => host.reset())
test.afterEach(() => views.splice(0).forEach(v => v.unmount()))
async function open(tab = 'sql-formatter') { const view = await mount(commands[tab]); views.push(view); return view }
async function edit(view, source, dialect = 'sqlite') {
  if (view.items().some(item => item.props.id === 'input')) await view.run(view.item('input'), '编辑源码')
  else { view.tree().props.filterBar.actions.find(a => a.id === 'edit').onAction(); await tick() }
  const form = await mountPushed(host); views.push(form)
  await form.fill('dialect', dialect); await form.fill('source', source)
  return form
}
async function submit(form) { await form.run(null, '生成结果'); await tick() }

const sqliteCases = [
  "select 1 -- 保留注释结束\n + 2 as total;",
  "select ' a  b\n c' as \"order by\", 'O''Reilly' as value;",
  "select 4 /* ? */ + 3, 1 != 2, 8 >= 4, 8 << 1;",
  "select '__ZSQL_LIT_0__', '__ZSQL_LIT_1__', '```sql', '/*x*/';",
  "with sample as (select 1 as n union all select 2) select sum(n) from sample where n > 0;",
  "select json_extract('{\"x\": 2}', '$.x') as n;",
]
test('SQLite 实际执行：格式化及精简保持注释、字面量和操作符语义', () => {
  const db = new DatabaseSync(':memory:')
  try {
    for (const source of sqliteCases) {
      const expected = db.prepare(source).all(), result = formatAndMinifySql(source, 'sqlite')
      assert.deepEqual(db.prepare(result.beautified).all(), expected)
      assert.deepEqual(db.prepare(result.minified).all(), expected)
    }
    db.exec('CREATE TABLE unicode_names(foo INTEGER, "foo\u00a0bar" INTEGER); INSERT INTO unicode_names VALUES (1, 2)')
    const unicodeSql = 'SELECT foo\u00a0bar FROM unicode_names'
    for (const output of [formatAndMinifySql(unicodeSql, 'sqlite').beautified, formatAndMinifySql(unicodeSql, 'sqlite').minified]) assert.deepEqual(db.prepare(output).all(), db.prepare(unicodeSql).all())
    db.exec('CREATE TABLE t (__ZSQL_LIT_0__ INTEGER, "order by" TEXT); INSERT INTO t VALUES (4, \'原字段\')')
    const source = 'select __ZSQL_LIT_0__, `order by` from t'
    for (const result of Object.values(formatAndMinifySql(source, 'sqlite')).filter(v => typeof v === 'string')) assert.deepEqual(db.prepare(result).all(), db.prepare(source).all())
  } finally { db.close() }
})
test('SQL 方言：必要换行、MySQL注释、PG dollar字符串及嵌套注释保持原文', () => {
  const pg = "select $tag$ from ' ? \n 中文 $tag$, E'O\\'Reilly', 'one'\n 'two' /* outer /* nested */ still */ from sample"
  const formatted = formatAndMinifySql(pg, 'postgresql')
  for (const output of [formatted.beautified, formatted.minified]) {
    assert.match(output, /\$tag\$ from ' \? \n 中文 \$tag\$/)
    assert.match(output, /'one'\n 'two'|'one'\n\s*'two'/)
    assert.match(output, /\/\* outer \/\* nested \*\/ still \*\//)
  }
  assert.match(formatAndMinifySql("select 'a' /*注释*/\n'b'", 'postgresql').minified, /\/\*注释\*\/\n'b'/)
  const mysql = "select `order by`, 'a\\'b' # 注释\n from t where x=1--2"
  assert.match(formatAndMinifySql(mysql).minified, /# 注释\nfrom t/)
  assert.match(formatAndMinifySql(mysql).minified, /1--2$/)
  assert.equal(formatAndMinifySql('select 1 --' + String.fromCharCode(127) + 'note\n+2').minified, 'select 1 --' + String.fromCharCode(127) + 'note\n+2')
  for (const invalid of ['', '/* 注释 */', "select 'broken", 'select (1', 'select 1)', 'select /* bad', 'select $$bad']) {
    assert.throws(() => formatAndMinifySql(invalid, 'postgresql'))
  }
  assert.throws(() => formatAndMinifySql('x'.repeat(256 * 1024 + 1)))
  assert.throws(() => formatAndMinifySql('select (' .repeat(65)))
})
test('MyBatis 实际 SQLite：引号、反斜杠、逗号、NULL、布尔和精确数字还原', () => {
  const source = "==>  Preparing: SELECT ? as author, ? as path, ? as location, ? as absent, ? as enabled, ? as n, '?' as literal /* ? */\n==> Parameters: O'Reilly(String), C:\\temp\\file(String), Seattle, WA(String), null, true(Boolean), 1.2e3(Double)"
  const result = mergeMyBatisLog(source, 'sqlite')
  assert.equal(result.isSuccess, true, result.errorMessage)
  assert.equal(result.placeholderCount, 6)
  const db = new DatabaseSync(':memory:')
  try { assert.deepEqual({ ...db.prepare(result.mergedSql).get() }, { author: "O'Reilly", path: 'C:\\temp\\file', location: 'Seattle, WA', absent: null, enabled: 1, n: 1200, literal: '?' }) }
  finally { db.close() }
  const mysql = mergeMyBatisLog('Preparing: SELECT ?\nParameters: a\\b\'c(String)')
  assert.equal(mysql.mergedSql, "SELECT 'a\\\\b''c'")
  assert.equal(mergeMyBatisLog('Preparing: SELECT 1\nParameters: ', 'sqlite').isSuccess, true)
  assert.equal(mergeMyBatisLog('Preparing: SELECT ?\nFROM t\nParameters: 1(Integer)', 'sqlite').isSuccess, false)
  assert.equal(mergeMyBatisLog('Preparing: SELECT ?\nParameters: 9223372036854775807(Long)', 'sqlite').mergedSql, 'SELECT 9223372036854775807')
})
test('MyBatis 缺日志、数量不符、歧义和错误类型不产生可复制SQL', () => {
  for (const input of [
    'Preparing: SELECT ?, ?\nParameters: 1(Integer)',
    'Preparing: SELECT ?\nParameters: yes(Boolean)',
    'Preparing: SELECT ?\nParameters: invalid(Double)',
    'Preparing: SELECT ?\nParameters: 1.2(Long)',
    'Preparing: SELECT ?\nParameters: data(byte[])',
    'Preparing: SELECT ?\nParameters: a(String), b(String)',
    'Preparing: SELECT 1',
    'Preparing: SELECT ? Parameters: 1(Integer)',
    'Preparing: SELECT 1\nParameters: \nPreparing: SELECT 2\nParameters: ',
    'Parameters: 1(Integer)\nPreparing: SELECT ?',
  ]) {
    const result = mergeMyBatisLog(input, 'sqlite')
    assert.equal(result.isSuccess, false, input); assert.equal(result.mergedSql, ''); assert.equal(result.beautifiedMergedSql, '')
  }
  assert.equal(mergeMyBatisLog("Preparing: SELECT doc ? 'key'\nParameters: 1(Integer)", 'postgresql').isSuccess, false)
  assert.equal(mergeMyBatisLog('Preparing: SELECT ?\nParameters:  a (String)', 'sqlite').params[0].value, ' a ')
})

const ddl = `CREATE TABLE "demo_records" (
  id BIGINT NOT NULL,
  name VARCHAR(64),
  amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  enabled BOOLEAN,
  birthday DATE,
  created_at TIMESTAMP,
  payload JSON,
  photo BLOB,
  "class" TEXT DEFAULT 'ignore,),not null',
  PRIMARY KEY(id), CHECK (length(name) > 0)
);`
test('真实 SQLite 建表结构对照：单行/多行、嵌套默认值、表级主键与可空列', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(ddl)
    const actual = db.prepare('PRAGMA table_info(demo_records)').all()
    for (const input of [ddl, ddl.replace(/\n/g, ' ')]) {
      const result = parseDdlToEntities(input, 'sqlite')
      assert.equal(result.isValid, true, result.warningMessage)
      assert.deepEqual(result.columns.map(c => c.name), actual.map(c => c.name))
      assert.deepEqual(result.columns.map(c => c.nullable), actual.map(c => !c.notnull && !c.pk))
      assert.match(result.generatedCode.typescript, /"amount": string;/)
      assert.match(result.generatedCode.typescript, /"enabled": boolean \| null;/)
      assert.match(result.generatedCode.golang, /Enabled \*bool/)
      assert.match(result.generatedCode.java, /import java.time.LocalDate;/)
      assert.doesNotMatch(result.generatedCode.java, /lombok/)
    }
  } finally { db.close() }
})
test('生成代码通过真实 TypeScript、Go、Java编译；特殊字段及注释不破坏代码', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'ztools-sql-model-'))
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const compiler = ['node_modules/typescript/bin/tsc', '../node_modules/typescript/bin/tsc', '../electron-client/node_modules/typescript/bin/tsc'].map(p => path.resolve(repo, p)).find(existsSync)
  assert.ok(compiler, '需要项目 TypeScript 编译器')
  const result = parseDdlToEntities("CREATE TABLE demo_models (`first-name` text, first_name text, `class` text, amount decimal(20,4) NOT NULL, birthday date, data json, bytes blob, `中文` text COMMENT '*/ \\\\u000a 注释', id bigint unsigned)")
  assert.equal(result.isValid, true, result.warningMessage)
  try {
    writeFileSync(path.join(root, 'model.ts'), result.generatedCode.typescript)
    execFileSync(process.execPath, [compiler, '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', path.join(root, 'model.ts')], { cwd: root, encoding: 'utf8' })
    writeFileSync(path.join(root, 'model.go'), result.generatedCode.golang)
    if (spawnSync('go', ['version']).status === 0) execFileSync('go', ['test', path.join(root, 'model.go')], { encoding: 'utf8', env: { ...process.env, GOWORK: 'off' } })
    else t.diagnostic('当前环境无 Go；Go 编译需在具备工具链的机器复核')
    const name = result.generatedCode.java.match(/public class (\w+)/)[1]
    writeFileSync(path.join(root, name + '.java'), result.generatedCode.java)
    if (spawnSync('javac', ['-version']).status === 0) execFileSync('javac', ['-encoding', 'UTF-8', path.join(root, name + '.java')], { encoding: 'utf8' })
    else t.diagnostic('当前环境无 javac；Java 编译需在具备工具链的机器复核')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('DDL错误不输出半成品；未知类型提示，引用注释中的逗号括号不拆列', () => {
  for (const input of ['', 'SELECT example(\n id int\n)', 'CREATE TABLE demo (id int', 'CREATE TABLE demo (id int,)', 'CREATE TABLE demo (id int); CREATE TABLE other (x int)', 'CREATE TABLE demo (id int, id int)', 'CREATE TABLE demo (id int, PRIMARY KEY (missing))']) {
    const result = parseDdlToEntities(input)
    assert.equal(result.isValid, false, input); assert.deepEqual(result.generatedCode, { typescript: '', golang: '', java: '' })
  }
  const result = parseDdlToEntities("CREATE TABLE schema1.demo (id uuid NOT NULL, value custom_type, note text COMMENT 'a,b) and NOT NULL', label enum('a,b', 'c') DEFAULT 'a,b')")
  assert.equal(result.isValid, true, result.warningMessage)
  assert.equal(result.tableName, 'demo'); assert.equal(result.columns.length, 4)
  assert.equal(result.columns[2].nullable, true); assert.equal(result.columns[2].comment, 'a,b) and NOT NULL')
  assert.match(result.warnings.join('\n'), /custom_type|CUSTOM_TYPE/)
})
test('三个显式快捷入口没有示例冒充结果；表单保留多行、取消与错误不替换旧内容', async () => {
  for (const [code, tab] of [['sql-formatter', 'formatter'], ['mybatis-merge', 'mybatis'], ['ddl-to-entity', 'ddl']]) {
    const v = await open(code)
    assert.equal(v.tree().props.searchBarAccessory.props.value, tab)
    assert.equal(v.items().length, 1); assert.equal(v.items()[0].props.id, 'input')
    assert.doesNotMatch(v.text(), /已美化对齐|t_user_account|张三|复制美化 SQL/)
  }
  const v = await open(), form = await edit(v, sqliteCases[0]); await submit(form)
  assert.equal(host.pushed.length, 0)
  await v.run(v.item('minified'), '复制精简空白')
  assert.match(host.clipboard.text, /-- 保留注释结束\n/)
  await v.search('精简'); assert.equal(v.items().length, 1)
  const bad = await edit(v, "select 'broken"); await submit(bad)
  assert.equal(host.pushed.length, 1); assert.equal(host.lastToast().style, 'FAILURE')
  await v.search(''); assert.equal(v.items().length, 2)
  assert.match(v.text(), /保留注释结束/)
  host.pushed.pop()
})
test('MyBatis与DDL实际声明式链路：成功复制结果，异常剪贴板清旧结果且失败不报成功', async () => {
  const v = await open('mybatis-merge')
  host.clipboard.text = 'Preparing: SELECT ?\nParameters: hello(String)'
  await v.run(v.item('input'), '载入剪贴板')
  await v.run(v.item('merged'), '复制参数还原参考 SQL')
  assert.equal(host.clipboard.text, "SELECT 'hello'")
  host.clipboard.text = 'Preparing: SELECT ?\nParameters: '
  await v.tree().props.filterBar.actions.find(a => a.id === 'clipboard').onAction(); await tick()
  assert.equal(v.items()[0].props.id, 'input'); assert.equal(host.lastToast().style, 'FAILURE')
  await v.dropdown('ddl'); const form = await edit(v, ddl); await submit(form)
  for (const [id, title] of [['typescript', 'TypeScript 模型'], ['golang', 'Go 模型'], ['java', 'Java 模型']]) {
    await v.run(v.item(id), '复制' + title)
    assert.equal(host.clipboard.text, parseDdlToEntities(ddl, 'sqlite').generatedCode[id])
  }
  await v.dropdown('mybatis'); assert.equal(v.items()[0].props.id, 'input', '模式各自保留输入而不混用')
})

test('慢剪贴板读取不会覆盖编辑或串到其他模式；卸载及失败均无假成功', async () => {
  const bridge = getDeclarativeBridge(), read = bridge.readClipboardText
  let resolve
  try {
    bridge.readClipboardText = () => new Promise(done => { resolve = done })
    const v = await open()
    await v.run(v.item('input'), '载入剪贴板')
    const form = await edit(v, 'select 42'); await submit(form)
    resolve('select 99'); await tick()
    assert.match(v.text(), /select 42/); assert.doesNotMatch(v.text(), /select 99/)
    await v.tree().props.filterBar.actions[0].onAction(); await tick()
    await v.dropdown('mybatis'); resolve('select 100'); await tick()
    assert.equal(v.items()[0].props.id, 'input')
    await v.dropdown('formatter'); assert.match(v.text(), /select 42/)
    await v.tree().props.filterBar.actions[0].onAction(); await tick()
    v.unmount(); resolve('select 101'); await tick()
    assert.equal(host.toasts.length, 0)
    bridge.readClipboardText = async () => { throw new Error('测试读取失败') }
    const bad = await open(); await bad.run(bad.item('input'), '载入剪贴板')
    assert.equal(host.lastToast().style, 'FAILURE'); assert.match(host.lastToast().message, /测试读取失败/)
  } finally { bridge.readClipboardText = read }
})

test('SQLite 非整数主键仍允许 NULL；MySQL tinyint(1) 保留整数范围', () => {
  const cases = ['CREATE TABLE demo (id TEXT PRIMARY KEY)', 'CREATE TABLE demo (id INTEGER PRIMARY KEY DESC)', 'CREATE TABLE demo (id TEXT, PRIMARY KEY(id))', 'CREATE TABLE demo (id INTEGER PRIMARY KEY)', 'CREATE TABLE demo (id TEXT PRIMARY KEY) WITHOUT ROWID', 'CREATE TABLE demo (id TEXT PRIMARY KEY) STRICT']
  for (const source of cases) {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(source)
      let permitsNull = false
      try { db.exec('INSERT INTO demo(id) VALUES (NULL)'); permitsNull = db.prepare('SELECT id FROM demo').get().id === null }
      catch (error) { assert.match(error.message, /NOT NULL/) }
      assert.equal(parseDdlToEntities(source, 'sqlite').columns[0].nullable, permitsNull, source)
    } finally { db.close() }
  }
  const tiny = parseDdlToEntities('CREATE TABLE demo (flag tinyint(1) NOT NULL)')
  assert.match(tiny.generatedCode.typescript, /"flag": number;/)
})

test('特殊名称不能被JSON/GORM标签误解释；实际Go序列化保留字段键名', t => {
  for (const name of ['', 'a,b', 'a;primaryKey', '-', 'quote"name', 'back\\slash']) {
    const result = parseDdlToEntities(`CREATE TABLE demo (\`${name}\` text)`)
    assert.equal(result.isValid, false, name)
    assert.match(result.warningMessage, /JSON\/GORM/)
  }
  if (spawnSync('go', ['version']).status !== 0) { t.diagnostic('需要 Go 工具链执行序列化验证'); return }
  const dir = mkdtempSync(path.join(tmpdir(), 'ztools-sql-json-'))
  try {
    const result = parseDdlToEntities('CREATE TABLE demo (`first-name` text NOT NULL, `中文` text NOT NULL, `a:b` text NOT NULL)')
    assert.equal(result.isValid, true, result.warningMessage)
    writeFileSync(path.join(dir, 'main.go'), result.generatedCode.golang.replace('package models', 'package main\nimport "encoding/json"\nimport "fmt"') + '\nfunc main() { data, err := json.Marshal(DemoModel{FirstName: "first", Field: "second", AB: "third"}); if err != nil { panic(err) }; fmt.Println(string(data)) }')
    const json = execFileSync('go', ['run', path.join(dir, 'main.go')], { encoding: 'utf8', env: { ...process.env, GOWORK: 'off' } })
    assert.deepEqual(JSON.parse(json), { 'first-name': 'first', '中文': 'second', 'a:b': 'third' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('PostgreSQL仅裸标识符转小写；MySQL SERIAL/ZEROFILL遵循真实整数范围', () => {
  const pg = parseDdlToEntities('CREATE TABLE Users (UserID BIGINT, "DisplayName" TEXT, PRIMARY KEY(UserID))', 'postgresql')
  assert.equal(pg.isValid, true, pg.warningMessage)
  assert.equal(pg.tableName, 'users'); assert.deepEqual(pg.columns.map(c => c.name), ['userid', 'DisplayName'])
  assert.equal(pg.columns[0].nullable, false)
  assert.match(pg.generatedCode.golang, /column:userid/)
  const mysql = parseDdlToEntities('CREATE TABLE items (id SERIAL, count BIGINT ZEROFILL)')
  assert.equal(mysql.isValid, true, mysql.warningMessage)
  assert.equal(mysql.columns[0].nullable, false)
  assert.ok(mysql.columns.every(c => c.unsigned))
  assert.match(mysql.generatedCode.typescript, /"id": string;/)
  assert.match(mysql.generatedCode.java, /public BigInteger id;/)
  assert.match(mysql.generatedCode.golang, /Id uint64/)
  assert.match(mysql.generatedCode.golang, /Count \*uint64/)
})

test('美化：连接修饰词与 JOIN 同行，同名函数 LEFT()/RIGHT() 与 CHARACTER SET 不换行，执行结果不变', () => {
  const source = "select a.id, left(a.name, 2) as l, right(a.name, 1) as r from a left join b on a.id = b.id inner join c on c.id = a.id left outer join d on d.id = a.id cross join e natural join f where a.id > 0 order by a.id"
  const { beautified } = formatAndMinifySql(source, 'sqlite')
  assert.deepEqual(beautified.split('\n'), [
    'select a.id, left(a.name, 2) as l, right(a.name, 1) as r',
    'from a',
    'left join b on a.id = b.id',
    'inner join c on c.id = a.id',
    'left outer join d on d.id = a.id',
    'cross join e',
    'natural join f',
    'where a.id > 0',
    'order by a.id'
  ])
  const db = new DatabaseSync(':memory:')
  try {
    db.exec("CREATE TABLE a(id INTEGER, name TEXT); CREATE TABLE b(id INTEGER); CREATE TABLE c(id INTEGER); CREATE TABLE d(id INTEGER); CREATE TABLE e(x INTEGER); CREATE TABLE f(id INTEGER, name TEXT);")
    db.exec("INSERT INTO a VALUES (1, '甲乙丙'); INSERT INTO b VALUES (1); INSERT INTO c VALUES (1); INSERT INTO d VALUES (1); INSERT INTO e VALUES (9); INSERT INTO f VALUES (1, '甲乙丙');")
    // SQLite 没有 LEFT()/RIGHT() 函数，执行校验用 substr 等价改写后的同结构语句
    const runnable = source.replace('left(a.name, 2)', 'substr(a.name, 1, 2)').replace('right(a.name, 1)', 'substr(a.name, -1)')
    assert.deepEqual(db.prepare(formatAndMinifySql(runnable, 'sqlite').beautified).all(), db.prepare(runnable).all())
  } finally { db.close() }
  assert.doesNotMatch(formatAndMinifySql('create table t (a varchar(3) character set utf8mb4)').beautified, /\nset/i)
  assert.match(formatAndMinifySql('update t set a = 1').beautified, /^update t\nset a = 1$/)
  // 没有原始空白的位置不插入换行（如 x)left join 这类紧贴写法不改变 token 间距）
  assert.equal(formatAndMinifySql('select left(x,1)from t').beautified, 'select left(x,1)from t')
})

test('空状态按模式给出不同的引导，标题不缺空格，提示里不写 ⌘/Ctrl 混写快捷键', async () => {
  const seen = new Set()
  for (const tab of ['sql-formatter', 'mybatis-merge', 'ddl-to-entity']) {
    const view = await open(tab)
    const item = view.item('input')
    assert.doesNotMatch(item.props.title, /开始SQL/)
    assert.doesNotMatch(`${item.props.subtitle} ${item.props.detail.props.markdown}`, /⌘\/Ctrl|Ctrl\+Enter|⌘/)
    seen.add(item.props.detail.props.markdown)
  }
  assert.equal(seen.size, 3)
  const view = await open('mybatis-merge')
  assert.match(view.item('input').props.detail.props.markdown, /Preparing/)
  await view.run(view.item('input'), '编辑源码')
  const form = await mountPushed(host)
  try { assert.doesNotMatch(form.text(), /⌘\/Ctrl/) } finally { form.unmount() }
})
