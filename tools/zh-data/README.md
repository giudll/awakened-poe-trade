# zh_CN data

Builds the Simplified Chinese data bundle in `renderer/public/data/zh_CN/` from the
[编年史 / poedb](https://poedb.tw/cn/chinese) localization patch, so that price
check works on a game client that is patched to Simplified Chinese while still
querying the **international** trade site.

The bundle is bilingual on purpose: every English matcher of the original data is
kept, and the Chinese ones are *added* to the same records. That means

* a Chinese modifier line resolves to the exact same `Stat` object - and therefore
  to the same language independent `trade.ids` - as its English counterpart,
* a half translated item (the localization lags behind on brand new content) still
  parses, because each line is matched on its own,
* nothing about the trade request changes. The trade site only ever sees English
  stat ids, English refNames and the league name.

## Where the data comes from

`VPatchGGPK3.exe` / `PoeChinese3.exe` pull the patch from a two step address:

```
https://poedb.tw/fg/pin_cn.json      -> { version, md5, pin }
https://poedb.tw/fg/{md5}.zip        -> the archive, MD5 verified after download
```

The archive contains 207 `Data/<language>/*.datc64` tables and 45
`Metadata/StatDescriptions/*.txt` files. One detail matters a lot: the *Simplified
Chinese* text is stored in the **`Traditional Chinese`** language slot, because that
is the slot the international client renders. Reading the `lang "Simplified
Chinese"` sections instead yields a different (Tencent) translation that does not
match what the patched client shows.

## The one rule: no Chinese text unless the patch has it

The game client is patched to 编年史's Simplified Chinese, so **anything 编年史 did not
translate is shown in English in game** - brand new affixes, new uniques, the odd
label. Consequently the bundle must not invent Chinese:

* every Chinese string in `stats.ndjson`, `items.ndjson` and `client_strings.js` is
  a string that exists verbatim in the patch;
* if a name cannot be traced back to the patch, the record keeps its **English**
  name, because that is exactly what the pasted text will contain;
* nothing from any other Chinese localization is merged in. Where a third party
  disagrees with 编年史 (`Assassin's Favour` is `刺客恩惠`, not `暗影恩惠`;
  `ItemPopupFoilUnique` is `烫金传奇`, not `古藏传奇`; a crafted mod header is
  `大师工艺前缀`, not `大师工艺 前缀属性`), 编年史 wins.

`build-items.mjs` enforces this with an assertion: a name that differs from its
`refName` but is not present in the patch fails the build.

| Output | Source |
| --- | --- |
| `stats.ndjson` | `Metadata/StatDescriptions/*.txt`, `lang "Traditional Chinese"` sections joined to the English text by stat id |
| `items.ndjson` names (uniques) | `words.datc64` - one row holds the English *and* the Chinese name, so the pairing is exact |
| `items.ndjson` names (by Id) | `baseitemtypes.datc64` / `worldareas.datc64`, paired through the language independent Id (`DivinationCardAssassinsFavour` -> `Assassin's Favour`) |
| `items.ndjson` names (variant gems) | `activeskills.datc64`, accepted only when the composed reading ends with the base gem's own name (`奋发之赦罪` ends with `赦罪`) |
| `items.ndjson` names (plain base types) | `data/pair-hints.json` proposes the pairing; the name itself still has to be found in `baseitemtypes.datc64`, otherwise the item stays English |
| `client_strings.js` | `data/client_strings-cn.mjs` as hints, every value verified against the patch; labels the patch has a template for are derived from it |
| `app_i18n.json` | **not generated and not game data** - the app's own UI translation, hand maintained. The only Chinese text in the bundle that does not come from the patch, and it never takes part in item matching |

`baseitemtypes.datc64` has no English column, so plain base types (armour/weapon
Ids are `GlovesDexInt10`, `BodyStr1`) cannot be paired from the table alone; the
hint file supplies the candidate, the table decides whether it is real. The common
"hint dropped a suffix" cases are repaired (`附加混沌伤害` -> `附加混沌伤害(辅)`,
`塑界守卫` -> `塑界守卫地图`). Rejected hints are listed in the report.

## The `.datc64` reader

`lib/datc64.mjs` reads the binary tables without a schema and without any
dependency:

* `uint32` row count, then `rowCount * rowLength` bytes of fixed size rows,
* the variable length section starts at an 8 byte `0xBB` marker whose offset has to
  be divisible by `rowCount`, which is how `rowLength` is derived,
* strings are UTF-16LE, NUL terminated, referenced by a 4 byte offset stored in the
  row (the field is 8 bytes wide).

String columns are found by trying every 4 byte aligned offset and keeping the ones
that decode to sane text for (nearly) every row. Pointers read one byte off produce
Hangul/private-use garbage, which is what the sanity check rejects - that is why
`detectStringColumns()` is stricter than "it decodes to something".

## Commands

```sh
# everything, from a local zip (offline)
node build-all.mjs --zip=/path/to/089a26b1b3f03321875d32002f1e786a.zip

# everything, pulling pin_cn.json + the zip over the network
node build-all.mjs

# only check the coverage gates against a patch, write nothing
node build-all.mjs --check

# individual steps
node build-stats.mjs --zip=...      # stats.ndjson
node build-items.mjs --zip=...      # items.ndjson
node build-client-strings.mjs --zip=...   # client_strings.js (verifies labels)
```

`build-all.mjs` writes `zh-data.lock.json` (patch version, md5, coverage). The daily
CI job compares the upstream `md5` against that lock and only rebuilds when it
changed.

`*.index.bin` are not written here: the renderer build regenerates them from the
ndjson files (`renderer/src/assets/vite-plugin-make-indexes.ts`).

## Coverage gates

| Gate | Minimum | Meaning |
| --- | --- | --- |
| `realMods` | 85% | item modifiers (excluding pseudo / anointment / synthetic gem stats) that have a Chinese matcher |
| `itemNames` | 90% | item records with a Chinese name (the rest are English on purpose) |
| `uniqueNames` | 95% | unique names coming from `words.datc64` |
| `labels` | 98% | parser vocabulary keys with a patch verified Chinese value |

Below these the patch is considered broken (wrong language slot, truncated
download, format change) rather than merely incomplete, and CI fails.

## Reports

Each step writes a machine readable report next to itself:
`out-stats-report.json`, `out-items-report.json`, `out-client-strings-report.json`.
`out-items-report.json` has `englishOnly` (records left English because the patch
has no name for them) and `rejectedHints` (pairing proposals the patch refused).
Both are worth a look after a league launch: captured beasts and mercenary builds
have no Id-based route yet, so they stay English.

`out-client-strings-report.json` has `unverified`: labels whose Chinese wording is
not in the patch and which therefore fell back to English.
