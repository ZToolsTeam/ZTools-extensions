import test from 'node:test'
import assert from 'node:assert/strict'
import {createHost,mount,tick} from '../../shared/test-harness.mjs'
import Command from '../dist/index.js'
import {searchLocalFiles} from '../dist/search-service.js'

test('A/B：有效空索引不会回退其他目录，大小写敏感路径保持原样',async()=>{
 const host=createHost();host.ipc.filesearch_query=({query})=>{assert.equal(query,'dir:/Users/Case/');return {files:[]}}
 assert.deepEqual(await searchLocalFiles('dir:/Users/Case/'),[])
 assert.deepEqual(host.ipcCalls.map(([m])=>m),['filesearch_query'])
})
test('C：所有搜索源失败有可重试错误，恢复后清除错误',async()=>{
 const host=createHost();await assert.rejects(searchLocalFiles('query'),/文件搜索不可用/)
 const view=await mount(Command,host)
 try {
  await tick(20);const row=view.item('search-error');assert.match(view.tree().props.filterBar.summaryText,/搜索失败/)
  host.ipc.filesearch_query=()=>({files:[{name:'real.txt',path:'/tmp/real.txt',size:10}]})
  await view.run(row,'重新搜索');await tick(20)
  assert.ok(view.items().some(i=>i.props.title==='real.txt'));assert.ok(!view.items().some(i=>i.props.id==='search-error'))
 }finally{view.unmount()}
})

test('搜索框为空时把空关键词原样发给宿主（宿主据此返回最近文件），不能改成 "."',async()=>{
 const host=createHost();const queries=[]
 host.ipc.filesearch_query=({query})=>{queries.push(query);return {files:query?[]:[{name:'recent.txt',path:'/tmp/recent.txt',size:1}]}}
 const view=await mount(Command,host)
 try {
  await tick(400)
  assert.equal(queries[0],'')
  assert.ok(!queries.includes('.'))
  assert.ok(view.items().some(i=>i.props.title==='recent.txt'))
 }finally{view.unmount()}
})
