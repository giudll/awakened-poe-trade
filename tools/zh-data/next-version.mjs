// Prints the version of the next Chinese build.
//
// electron-updater only offers a release when its version is greater than the
// installed one, and it refuses pre-release versions. So the fork cannot keep
// upstream's `3.29.108` forever: every build has to bump the patch.
//
// The version tracks the *game* version the bundle was built from, not upstream's
// code version - a 3.30 bundle numbered `3.29.126` is misleading when the whole
// point of the release is "the new league's content is in it". So:
//
//   * the 编年史 patch version (`tools/zh-data/zh-data.lock.json`) decides the
//     major.minor, because that is the data the bundle contains;
//   * the number after it keeps growing, seeded from the highest existing tag
//     that already uses that major.minor;
//   * when upstream's code is ahead of the patch (the usual case between
//     leagues) the old rule applies unchanged - upstream version, patch + 1.
//
//   node next-version.mjs 3.29.108 tags.txt 3.30.0.2
//
// `tags.txt` is one tag per line (`gh release list --json tagName`), missing or
// empty is fine. The patch version is optional. Output is `<key>=<value>` lines,
// ready for $GITHUB_OUTPUT.

import fs from 'node:fs'

const upstream = process.argv[2]
const tagsFile = process.argv[3]
const patchVersion = process.argv[4]

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

const tags = []
if (tagsFile && fs.existsSync(tagsFile)) {
  for (const line of fs.readFileSync(tagsFile, 'utf8').split('\n')) {
    const parsed = parse(line)
    if (parsed) tags.push(parsed)
  }
}

let best = parse(upstream)
for (const parsed of tags) {
  if (cmp(parsed, best) > 0) best = parsed
}

// `3.30.0.2` -> [3, 30]; the fourth component is the patch's own build counter
// and is not part of the app version.
const patch = patchVersion ? parse(patchVersion.replace(/^(\d+\.\d+\.\d+)\.\d+$/, '$1')) : null

let version
if (patch && (patch[0] > best[0] || (patch[0] === best[0] && patch[1] > best[1]))) {
  const used = tags
    .filter(t => t[0] === patch[0] && t[1] === patch[1])
    .reduce((max, t) => Math.max(max, t[2]), 0)
  version = `${patch[0]}.${patch[1]}.${used + 1}`
} else {
  version = `${best[0]}.${best[1]}.${best[2] + 1}`
}

console.log(`version=${version}`)
console.log(`tag=v${version}`)
console.log(`upstream=${upstream}`)
