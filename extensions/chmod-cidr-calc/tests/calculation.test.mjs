import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateIpv4Cidr, convertChmod } from '../dist/chmod-cidr-service.js'

test('CIDR 拒绝多余斜线、前导零八位组及非整数前缀', () => {
  for (const input of ['1.2.3.4/24/junk', '1.2.3.4/24/', '01.2.3.4/24', '1.2.3.4/-1', '1.2.3.4/33', '1.2.3.4/2.5', '1.2.3.4/', '1.2.3/24']) assert.throws(() => calculateIpv4Cidr(input), input)
})

test('文档、组播、保留、广播与协议用途不能被标记为公网可路由', () => {
  for (const [ip, label] of [['192.0.2.1','文档'],['198.51.100.1','文档'],['203.0.113.42','文档'],['224.0.0.1','组播'],['240.0.0.1','保留'],['255.255.255.255','广播'],['198.18.0.1','基准'],['192.0.0.9','PCP'],['192.0.0.170','NAT64']]) {
    assert.match(calculateIpv4Cidr(ip + '/32').addressScope, new RegExp(label))
  }
  assert.match(calculateIpv4Cidr('8.8.8.8/32').addressScope, /未验证/)
})

test('/0、/31、/32 数学边界正确，点对点与单主机不冒充广播', () => {
  const zero=calculateIpv4Cidr('192.0.2.1/0')
  assert.deepEqual([zero.networkAddress,zero.broadcastAddress,zero.totalHosts,zero.usableHosts],['0.0.0.0','255.255.255.255',4294967296,4294967294])
  for (const [cidr,first,last,count] of [['10.0.0.1/31','10.0.0.0','10.0.0.1',2],['255.255.255.255/32','255.255.255.255','255.255.255.255',1]]) {
    const r=calculateIpv4Cidr(cidr)
    assert.deepEqual([r.firstUsableIp,r.lastUsableIp,r.usableHosts],[first,last,count])
    assert.equal(r.hasBroadcast,false)
  }
})

test('chmod 四位八进制与特殊权限 s/S/t/T 双向一致', () => {
  for (const [mode,symbol] of [['4755','rwsr-xr-x'],['2644','rw-r-Sr--'],['1777','rwxrwxrwt'],['7000','--S--S--T']]) {
    const result=convertChmod(mode)
    assert.equal(result.symbolic,symbol)
    assert.equal(convertChmod(symbol).octal,mode)
  }
  assert.equal(convertChmod('drwxr-xr-x').lsSymbolic,'drwxr-xr-x')
  assert.equal(convertChmod('chmod -R 0755').octal,'755')
  for (const bad of ['888','rwxrwxrws','rwt------','chmod 755 file','rwxr-xr-x; rm -rf x']) assert.throws(()=>convertChmod(bad))
})

test('错误提示不包含可被 Markdown 解释的用户原文', () => {
  for (const fn of [calculateIpv4Cidr,convertChmod]) {
    try { fn('```\n![x](https://example.invalid/image)\n```'); assert.fail('应失败') }
    catch (error) { assert.doesNotMatch(error.message,/example\.invalid|!\[/) }
  }
})

test('子网掩码写法：点分、0x 十六进制（macOS ifconfig）与空格分隔，非连续掩码拒绝', () => {
  for (const input of ['192.168.1.5 255.255.255.0', '192.168.1.5/255.255.255.0', '192.168.1.5/0xffffff00', '192.168.1.5   0xFFFFFF00']) {
    const r = calculateIpv4Cidr(input)
    assert.equal(r.prefixLength, 24, input)
    assert.equal(r.networkAddress, '192.168.1.0', input)
  }
  assert.equal(calculateIpv4Cidr('10.1.2.3/255.255.255.252').prefixLength, 30)
  assert.equal(calculateIpv4Cidr('10.1.2.3 0.0.0.0').prefixLength, 0)
  assert.equal(calculateIpv4Cidr('10.1.2.3/0xffffffff').prefixLength, 32)
  for (const bad of ['10.0.0.1/255.0.255.0', '10.0.0.1/0xff00ff00', '10.0.0.1 255.255.255.0 extra', '10.0.0.1/24 255.255.255.0', '10.0.0.1/256.0.0.0', '10.0.0.1/0xfffff']) {
    assert.throws(() => calculateIpv4Cidr(bad), bad)
  }
})

test('macOS ls -l 的 @ / + 与 Linux 的 . 标记不影响权限解析', () => {
  for (const [input, octal, ls] of [['drwxr-xr-x@', '755', 'drwxr-xr-x'], ['-rw-r--r--+', '644', '-rw-r--r--'], ['-rwsr-xr-x.', '4755', '-rwsr-xr-x']]) {
    const r = convertChmod(input)
    assert.equal(r.octal, octal, input)
    assert.equal(r.lsSymbolic, ls, input)
  }
  for (const bad of ['rwxr-xr-x@', 'drwxr-xr-x@@', 'drwxr-xr-x#']) assert.throws(() => convertChmod(bad), bad)
})
