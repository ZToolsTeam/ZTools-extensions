#!/usr/bin/env node
/**
 * 发布密钥检查：用发布脚本同一套代码实测 OSS / CDN 凭证，不发布任何插件
 *
 * 1. 上传 plugins-v2/_auth-check.txt（oss:PutObject）
 * 2. 读回并核对内容（oss:GetObject）
 * 3. 刷新该文件的 CDN 缓存（cdn:RefreshObjectCaches）
 * 4. 往 plugins-v2 以外上传，应被拒绝（确认权限没有给大）
 *
 * 凭证从环境变量读取：OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET、OSS_BUCKET、OSS_REGION，
 * 可选 CDN_ACCESS_KEY_ID、CDN_ACCESS_KEY_SECRET（不填沿用 OSS 凭证）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_CDN_BASE_URL,
  DEFAULT_OSS_BUCKET,
  DEFAULT_OSS_PREFIX,
  DEFAULT_OSS_REGION,
  readOssObject,
  refreshAliyunCdnCache,
  uploadToOss
} from './deploy-plugins-storage.mjs'

const accessKeyId = process.env.OSS_ACCESS_KEY_ID
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
if (!accessKeyId || !accessKeySecret) {
  console.error('❌ 缺少 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET')
  process.exit(1)
}
const bucket = process.env.OSS_BUCKET || DEFAULT_OSS_BUCKET
const region = process.env.OSS_REGION || DEFAULT_OSS_REGION
const oss = { accessKeyId, accessKeySecret, bucket, region }
const cdn = {
  accessKeyId: process.env.CDN_ACCESS_KEY_ID || accessKeyId,
  accessKeySecret: process.env.CDN_ACCESS_KEY_SECRET || accessKeySecret
}

const fileName = '_auth-check.txt'
const content = `ZTools 发布密钥检查 ${new Date().toISOString()}\n`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-key-check-'))
const fullPath = path.join(tmp, fileName)
fs.writeFileSync(fullPath, content)
const file = { fullPath, relPath: fileName, size: Buffer.byteLength(content) }

let failed = false
async function step(name, fn, { expectFailure = false } = {}) {
  try {
    const detail = await fn()
    if (expectFailure) {
      failed = true
      console.log(`❌ ${name}：本应被拒绝却成功了，权限给大了`)
    } else {
      console.log(`✅ ${name}${detail ? `：${detail}` : ''}`)
    }
  } catch (err) {
    if (expectFailure && /AccessDenied/.test(err.message)) {
      console.log(`✅ ${name}：已被拒绝（AccessDenied）`)
    } else if (expectFailure) {
      // 钥匙本身无效时也会失败，但那说明不了权限范围
      failed = true
      console.log(`❌ ${name}：失败原因不是权限不足，无法确认范围：${err.message}`)
    } else {
      failed = true
      console.log(`❌ ${name}：${err.message}`)
    }
  }
}

console.log(`存储桶 ${bucket}（${region}）\n`)
try {
  await step(`上传 ${DEFAULT_OSS_PREFIX}/${fileName}（oss:PutObject）`, async () => {
    await uploadToOss({ ...oss, file })
  })
  await step('读回并核对内容（oss:GetObject）', async () => {
    const data = await readOssObject({ ...oss, objectKey: `${DEFAULT_OSS_PREFIX}/${fileName}` })
    if (data !== content) throw new Error(data === null ? '文件不存在' : '读回内容不一致')
  })
  await step('刷新该文件的 CDN 缓存（cdn:RefreshObjectCaches）', async () => {
    const res = await refreshAliyunCdnCache({ ...cdn, urls: [`${DEFAULT_CDN_BASE_URL}/${DEFAULT_OSS_PREFIX}/${fileName}`] })
    return `任务 ${res.refreshTaskId}`
  })
  await step(`往 ${DEFAULT_OSS_PREFIX}/ 以外上传（应被拒绝）`, async () => {
    await uploadToOss({ ...oss, prefix: 'auth-check-outside', file })
  }, { expectFailure: true })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(failed ? '\n结论：凭证或权限有问题，见上面的 ❌' : '\n结论：凭证可用，权限范围正确')
process.exit(failed ? 1 : 0)
