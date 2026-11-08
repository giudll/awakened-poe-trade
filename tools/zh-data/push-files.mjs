// Commits a handful of files onto an existing branch through the GitHub API.
//
// `git push` is blocked on the build machine, and `push-via-api.mjs` rebuilds the
// whole tree from upstream `master`, which throws the branch history away. This
// script instead reads the branch head, writes blobs for the given files and
// creates one commit on top - so one edit round becomes one commit and one
// build, not one build per file.
//
//   GH_TOKEN=ghp_xxx node push-files.mjs -m "message" file1 file2 ...
//
// Only the listed files change; everything else stays at the branch head.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = process.env.GH_REPO ?? 'giudll/awakened-poe-trade'
const BRANCH = process.env.GH_BRANCH ?? 'feat/zh-cn'
const token = process.env.GH_TOKEN

if (!token) throw new Error('set GH_TOKEN')

const argv = process.argv.slice(2)
const messageIndex = argv.findIndex(a => a === '-m' || a === '--message')
if (messageIndex === -1 || !argv[messageIndex + 1]) throw new Error('pass -m "message"')
const message = argv[messageIndex + 1]
const files = argv.filter((_, i) => i !== messageIndex && i !== messageIndex + 1)

if (!files.length) throw new Error('pass at least one file')

const here = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(here, '../..')

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

const head = (await api('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`)).object.sha
const headCommit = await api('GET', `/repos/${REPO}/git/commits/${head}`)
console.log(`head: ${head.slice(0, 7)} (${headCommit.message.split('\n')[0]})`)

// `sha: null` in a tree entry removes the path, which is the only way to delete
// through the Git Data API. Verify the file is really there first so a typo in a
// path cannot silently turn into a no-op.
const headTree = await api('GET', `/repos/${REPO}/git/trees/${headCommit.tree.sha}?recursive=1`)
const headPaths = new Set(headTree.tree.map(entry => entry.path))

const entries = []
for (const file of files) {
  const abs = path.join(repoDir, file)
  if (!fs.existsSync(abs)) {
    if (!headPaths.has(file)) throw new Error(`no such file locally or on the branch: ${file}`)
    entries.push({ path: file, mode: '100644', type: 'blob', sha: null })
    console.log(` delete ${file}`)
    continue
  }
  let raw = fs.readFileSync(abs)
  // The Windows checkout has CRLF on disk while the repository stores LF, so
  // uploading the file as-is would silently rewrite every line and make a
  // translated file differ from upstream in the diff without the content
  // differing at all. Normalise text files, leave binaries alone.
  if (!raw.includes(0) && raw.includes('\r\n')) {
    raw = Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    console.log(' (crlf -> lf)')
  }
  const blob = await api('POST', `/repos/${REPO}/git/blobs`, {
    content: raw.toString('base64'),
    encoding: 'base64'
  })
  entries.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha })
  console.log(` blob ${file} (${raw.length} B)`)
}

const tree = await api('POST', `/repos/${REPO}/git/trees`, {
  base_tree: headCommit.tree.sha,
  tree: entries
})
const commit = await api('POST', `/repos/${REPO}/git/commits`, {
  message,
  tree: tree.sha,
  parents: [head]
})
await api('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false })

console.log(`committed: ${commit.sha}`)
console.log(`https://github.com/${REPO}/commit/${commit.sha}`)

// keep the local clone in step, otherwise the next diff is computed against
// files that are one round behind the branch
try {
  execFileSync('git', ['fetch', '--depth=1', 'origin', BRANCH], { cwd: repoDir, stdio: 'ignore' })
} catch {
  // the git transport is usually blocked here; harmless
}
