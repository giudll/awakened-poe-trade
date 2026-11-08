// Prints the version of the next Chinese build.
//
// electron-updater only offers a release when its version is greater than the
// installed one, and it refuses pre-release versions. So the fork cannot keep
// upstream's `3.29.108` forever: every build has to bump the patch. The version
// is derived from the highest existing git tag and the current upstream version,
// which keeps it monotonic even if upstream jumps several patches ahead.
//
//   node next-version.mjs 3.29.108 tags.txt
//
// `tags.txt` is one tag per line (`gh release list --json tagName`), missing or
// empty is fine. Output is `<key>=<value>` lines, ready for $GITHUB_OUTPUT.

import fs from 'node:fs'

const upstream = process.argv[2]
const tagsFile = process.argv[3]

if (!upstream || !/^\d+\.\d+\.\d+$/.test(upstream)) {
  throw new Error(`expected a stable upstream version, got "${upstream}"`)
}

const parse = (version) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

let best = parse(upstream)

if (tagsFile && fs.existsSync(tagsFile)) {
  for (const line of fs.readFileSync(tagsFile, 'utf8').split('\n')) {
    const parsed = parse(line)
    if (parsed && cmp(parsed, best) > 0) {
      best = parsed
    }
  }
}

const version = `${best[0]}.${best[1]}.${best[2] + 1}`
console.log(`version=${version}`)
console.log(`tag=v${version}`)
console.log(`upstream=${upstream}`)
