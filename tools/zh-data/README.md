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
`Metadata/StatDescriptions/*.txt` files (since 3.30 they are named `*.csd`; the
content is unchanged UTF-16 text, and both extensions are accepted).

One detail matters a lot: the *Simplified Chinese* text is stored in the
**`Traditional Chinese`** language slot, because that is the slot the international
client renders. The two slots are not the same text in two character sets - they are
two different translations (`区域内的[异界图鉴掉落]提高 3%` vs `增加3%此區域的[輿圖掉落加成]`),
so converting one into the other with a character map gets most characters right and
the wording wrong everywhere else, and the affected lines silently stop matching what
the client shows. `detectChineseSlot` therefore derives the slot from the content
(20k+ script-exclusive characters separate the two) instead of trusting the label, and
`buildStats` refuses to emit Chinese text that is not a verbatim patch string.

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
`refName` but is not present in the patch fails the build. `build-stats.mjs` does the
same for every Chinese matcher in `stats.ndjson`: the string has to be one of the
patch strings (or be composed by one of the documented synths - cluster jewel grants,
anointments, ultimatum mods, ``Grants Level N <skill>``) or the build stops. That is
what makes a traditional-to-simplified rewrite impossible to merge by accident.

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

## `Grants Level N <skill>` lines

Some mods do not describe a number, they hand you a skill: Hyrri's Truth, the four
aspects, Herald rings, every "Grants Level 20 ... Skill" unique. For those the client
does not read a stat description at all - it composes the line from a ClientString
plus the skill's **localised name**:

```
ModGrantsEffectWithLevel = "Grants Level {1} {0}"     ClientStrings.datc64
                                    level  skill name (Data/<lang>/ActiveSkills.datc64)
```

which is why a Chinese client prints a half-English line:

```
Grants Level 30 精准
```

No matcher derived from the trade site can match that. The trade site files the mod as
`Grants Level # Precision Skill` (it appends a "Skill" the client never prints, and
keeps the English skill name), so the Chinese half has no Chinese twin and the English
half is not the text on screen. `lib/skills.mjs` rebuilds it in three steps:

1. index the patch's English text **without** its `[Id::#|Name]` markup as well, which
   is what pairs `Grants Level {0} [BattlemagesCry|Battlemage's Cry] Skill` with the
   trade wording;
2. drop the trade site's trailing `Skill` and look the line up again - several of these
   mods *are* described (`Grants Level {0} [Frostbite::{0}|Frostbite]` -> `获得 # 级的
   主动技能冻伤…`), they only miss because of that one word;
3. otherwise compose the line from the ClientString read out of the patch and the skill
   name read out of `ActiveSkills.datc64` (`Precision` -> `precision` -> `精准`). A
   skill 编年史 has not named yet keeps its English name, which is what the client shows
   for it.

The template is read from the patch rather than hardcoded, so if 编年史 ever translates
`ModGrantsEffectWithLevel` (`获得 {1} 级{0}`) the bundle follows without a code change.
`data/granted-skill-aliases.mjs` covers the handful of skills whose trade name is not
the internal id spelled out (`Aspect of the Avian` is `aspect_bird`, `Will of the Lords`
is `breach_hand_trap`, and the game itself misspells `Bestial` as `beastial`).

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

# rebuild the overlay (see below) - network, or cached JSON with --trade-items=
node refresh-overlay.mjs
node inputs-hash.mjs                # fingerprint of en/ + the overlay
```

`build-all.mjs` writes `zh-data.lock.json` (patch version, md5, the slot the Chinese
came from, coverage, what the overlay contributed, and an `inputs` fingerprint). The
daily CI job rebuilds when **either** the upstream patch `md5` **or** the `inputs`
fingerprint moved, so the bundle cannot sit on an older English skeleton after an
upstream sync that did not touch the patch.

## Content the skeleton does not have yet (the overlay)

`renderer/public/data/en/` is a snapshot of SnosMe's build. Between two of his
releases a league starts, and the game already shows items and modifiers that the
snapshot has never heard of: the price check answers `item.unknown`, or - worse -
drops the whole modifier section without a word. The trade site knows about that
content on day one, because it is the same game data, so `refresh-overlay.mjs`
recovers it from `https://www.pathofexile.com/api/trade/data/{items,stats}` into
`data/new-content.json`:

| List | What it holds | Why it is needed |
| --- | --- | --- |
| `items` | item records by English name (`Viscera`, `Graft`, `Wombgift` families) | without a record the parser stops at `item.unknown` and never queries |
| `items` (unique) | `name` + `unique.base`, read from the trade list's `name`/`type` pair | a unique added after the snapshot has no record at all, so none of the 200+ missing uniques could be priced |
| `statIds` | `(ref, domain, ids)` the skeleton forgot | a modifier whose domain is missing is silently dropped from the filters, or never resolves at all |
| `stats` | whole stat records, English text only | a line the client prints but the skeleton lacks is an "unrecognised modifier" |

Three properties keep this from drifting away from upstream and 编年史:

1. **Additive only.** `lib/overlay.mjs` never overwrites a base record and never
   fills a trade id domain the base already has. Anything upstream ships wins, so
   an upstream refresh converges back to upstream's data by itself - the stale
   entries are reported as `superseded` in the lock and can be pruned by
   re-running `refresh-overlay.mjs`. An empty overlay is the ideal state.
2. **No Chinese.** The overlay stores English only. `build-items` / `build-stats`
   resolve names and matchers out of the patch as usual, so the day 编年史
   translates a new item its text is picked up automatically - and until then the
   item simply stays English, which is exactly what the patched client shows.
3. **Nothing is counted.** Overlay records are excluded from the coverage gates
   (they are untranslated by design) but counted separately in the lock
   (`overlay.items`, `overlay.statRecords`, `overlay.statIdDomains`,
   `overlay.superseded`), so a gate failure always means the localization broke,
   not that a new league started.

`stats` entries are created with `better: NotComparable`. The trade API does not
publish which direction is "better", and guessing from `reduced` / `less` is wrong
about as often as it is right ("reduced Damage taken" improves as the number
grows), so those modifiers are searchable but get no automatic min/max bounds.
Upstream carries the real flag, so it comes back the moment the record exists
there.

A trade line that differs from a known record by exactly one filler `to`
(`+#% to Item Rarity` on grafts vs the older `+#% Item Rarity`) is the same
modifier, so its trade ids are added to that record and the new wording is added
as an extra English matcher (`statMatchers`). It is not a second record: the
matcher index has no grouping for that case, and two records with one Chinese
matcher would resolve by whichever line came first.

The same holds for a leading `+` (`Goreblossom has +# maximum Bloom` on the trade
site, `Goreblossom has # maximum Bloom` in the patch). `signVariants()` supplies
the unsigned form as an extra matcher; the patch's own spelling stays the one
that supplies the Chinese.

When one line genuinely belongs to two records - 3.30 prints `怪物生命总增 #%`
both as an explicit map mod and as a heist enchant - the index can only hand the
parser one of them, and which one depends on where the hash lands in the index.
`STAT_BY_MATCH_STR_ALL` exists for that: if the record the index returned has no
id for the modifier's type, the parser asks for the other records that answer to
the same line. Without it the modifier is reported as unrecognised at random,
which is not a state a data rebuild can be allowed to reach.

## Coverage gates

| Gate | Minimum | Meaning |
| --- | --- | --- |
| `realMods` | 85% | item modifiers **this patch still contains** (excluding pseudo / anointment / synthetic gem stats) that have a Chinese matcher |
| `itemNames` | 90% | item records with a Chinese name (the rest are English on purpose) |
| `uniqueNames` | 95% | unique names coming from `words.datc64` |
| `labels` | 98% | parser vocabulary keys with a patch verified Chinese value |

`realMods` is measured against the lines the patched client can actually print, not
against every record in the English skeleton: the skeleton keeps stats that a balance
patch deleted, and those can never appear on an item again. They are still emitted
(old items keep parsing) but no longer drag the ratio down. The unfiltered number is
recorded as `realModsRaw` in the lock so a real regression stays visible, and the gate
fails if the "deleted line" filter ever classifies more than 30% of the bundle, which
would mean the filter itself broke.

Below these the patch is considered broken (wrong language slot, truncated
download, format change) rather than merely incomplete, and CI fails.

`*.index.bin` are not written here: the renderer build regenerates them from the
ndjson files (`renderer/src/assets/vite-plugin-make-indexes.ts`).

## Reports

Each step writes a machine readable report next to itself:
`out-stats-report.json`, `out-items-report.json`, `out-client-strings-report.json`.
`out-items-report.json` has `englishOnly` (records left English because the patch
has no name for them) and `rejectedHints` (pairing proposals the patch refused).
Both are worth a look after a league launch: captured beasts and mercenary builds
have no Id-based route yet, so they stay English.

`out-client-strings-report.json` has `unverified`: labels whose Chinese wording is
not in the patch and which therefore fell back to English.
