// Uploads `feat/zh-cn` to a fork without `git push`.
//
// This machine cannot reach github.com over HTTPS (the git transport is blocked),
// but api.github.com is reachable. So instead of pushing objects, we let GitHub
// fork the upstream repository for us and then write one commit through the Git
// Data API: blobs -> tree -> commit -> ref.
//
//   GH_TOKEN=ghp_xxx node push-via-api.mjs            # do it
//   GH_TOKEN=ghp_xxx node push-via-api.mjs --dry-run  # only print the plan
//
// The token needs `repo` (public_repo is enough) and `workflow` - the branch
// contains `.github/workflows/*`, which GitHub refuses to write without it.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM = 'SnosMe/awakened-poe-trade'
const BRANCH = 'feat/zh-cn'
const BASE_BRANCH = 'master'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(here, '../..')
const dryRun = process.argv.includes('--dry-run')
const token = process.env.GH_TOKEN

if (!token) {
  throw new Error('set GH_TOKEN')
}

const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'awakened-poe-trade-zh-cn'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`)
  }
  return json
}

const git = (...args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim()
const hasCommit = (sha) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repoDir })
    return true
  } catch {
    return false
  }
}

const COMMIT_SUBJECT = 'feat(zh_CN): Simplified Chinese price check, UI and release pipeline'
const COMMIT_BODY = [
  'Data: `renderer/public/data/zh_CN/` is generated from the 编年史 patch by',
  '`tools/zh-data/`, with hard assertions - no Chinese string may come from',
  'anywhere else, untranslated content stays English so it keeps matching the',
  'text the client actually shows.',
  '',
  'UI: `app_i18n.json` is rendered from `data/app-i18n-zh.mjs` against the key set',
  'of the English file, so a missing string fails the build. Terminology follows',
  'the patch (古灵, 秽生, 佣兵, 符文嵌板, 酊剂, 海图, 雕像, 魔符).',
  '',
  'Releases: every build bumps the patch and publishes a GitHub release with the',
  'NSIS installer, the portable exe and latest.yml, which is what lets a running',
  'copy notice a new build. The update feed is stamped from `github.repository`,',
  'so it can never fall back to the upstream English release.',
  '',
  'Watches: `upstream-watch.yml` merges new upstream commits and regenerates the',
  'bundle, `zh-data.yml` follows the patch, and neither commits when nothing',
  'changed.'
].join('\n')

// `git diff --name-status A..B` -> [{ status, file }]
const listChanges = (base) => git('diff', '--name-status', `${base}..${BRANCH}`)
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, ...rest] = line.split('\t')
    return { status: status[0], file: rest.at(-1) }
  })

const localBase = git('rev-parse', `origin/${BASE_BRANCH}`)

if (dryRun) {
  const changes = listChanges(`origin/${BASE_BRANCH}`)
  console.log(`plan: ${changes.length} files -> ${BRANCH}`)
  for (const { status, file } of changes) console.log(` ${status} ${file}`)
  process.exit(0)
}

const me = await api('GET', '/user')
console.log(`user: ${me.login}`)
const fork = `${me.login}/${UPSTREAM.split('/')[1]}`

// 1. fork (idempotent: an existing fork answers 200 instead of 202)
const existing = await fetch(`https://api.github.com/repos/${fork}`, {
  headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }
})
if (existing.ok) {
  console.log(`fork exists: ${fork}`)
} else {
  console.log(`creating fork: ${fork}`)
  await api('POST', `/repos/${UPSTREAM}/forks`, { default_branch_only: false })
}

// the fork is copied asynchronously; the ref is the last thing to appear
let baseSha = null
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    baseSha = (await api('GET', `/repos/${fork}/git/ref/heads/${BASE_BRANCH}`)).object.sha
    break
  } catch {
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}
if (!baseSha) {
  throw new Error('the fork did not become ready within 5 minutes')
}
console.log(`base: ${baseSha}`)

const baseCommit = await api('GET', `/repos/${fork}/git/commits/${baseSha}`)
const baseTree = baseCommit.tree.sha

// The diff must be taken against the commit the fork actually has, otherwise a
// fork that was created earlier would silently miss upstream files.
let diffBase = `origin/${BASE_BRANCH}`
if (baseSha !== localBase) {
  if (!hasCommit(baseSha)) {
    throw new Error(
      `the fork's ${BASE_BRANCH} is ${baseSha}, which is not in this local clone.\n` +
      `Delete the old fork (or re-fork) so it matches ${localBase}, then run again.`
    )
  }
  diffBase = baseSha
}
const changedFiles = listChanges(diffBase)
console.log(`plan: ${changedFiles.length} files -> ${BRANCH} (base ${diffBase})`)

// 2. blobs, a few at a time so the API is not flooded
const entries = []
const CONCURRENCY = 4
for (let i = 0; i < changedFiles.length; i += CONCURRENCY) {
  const slice = changedFiles.slice(i, i + CONCURRENCY)
  await Promise.all(slice.map(async ({ status, file }) => {
    if (status === 'D') {
      entries.push({ path: file, mode: '100644', type: 'blob', sha: null })
      return
    }
    const raw = fs.readFileSync(path.join(repoDir, file))
    const blob = await api('POST', `/repos/${fork}/git/blobs`, {
      content: raw.toString('base64'),
      encoding: 'base64'
    })
    entries.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha })
    console.log(` blob ${file} (${raw.length} B)`)
  }))
}

// 3. tree + commit + ref
const tree = await api('POST', `/repos/${fork}/git/trees`, {
  base_tree: baseTree,
  tree: entries
})
const commit = await api('POST', `/repos/${fork}/git/commits`, {
  message: `${COMMIT_SUBJECT}\n\n${COMMIT_BODY}`,
  tree: tree.sha,
  parents: [baseSha]
})

try {
  await api('POST', `/repos/${fork}/git/refs`, {
    ref: `refs/heads/${BRANCH}`,
    sha: commit.sha
  })
} catch (err) {
  if (!/already exists/i.test(String(err))) throw err
  await api('PATCH', `/repos/${fork}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true })
}
console.log(`branch pushed: ${commit.sha}`)

// 4. make it the landing page, so the repository opens on the Chinese README
await api('PATCH', `/repos/${fork}`, {
  default_branch: BRANCH,
  description: '流放之路 1 简中查价（国际服 + 编年史补丁）。下载成品见 Releases。',
  homepage: `https://github.com/${fork}/releases/latest`
})

// 5. the ref was created through the API, so no push event fired - dispatch by hand
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    await api('POST', `/repos/${fork}/actions/workflows/zh-cn.yml/dispatches`, { ref: BRANCH })
    console.log('build dispatched')
    break
  } catch (err) {
    if (attempt === 11) throw err
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}

console.log('')
console.log(`watch the build: https://github.com/${fork}/actions`)
console.log(`download:        https://github.com/${fork}/releases/latest`)
