// Display names for the synthetic trade filters.
//
// These `ref`s never appear in the game client: they are aggregates the app adds
// up itself (`+#% total Elemental Resistance`) or trade-site options that have no
// item text at all (`# Crafted Modifiers`, `Has Room: ...`). There is therefore
// nothing in the 编年史 patch to take a Chinese string from - which is why the
// price check window showed them in English while every real mod was Chinese.
//
// Every key here is verified against `stats.ndjson` by build-app-i18n.mjs, so a
// typo fails the build instead of silently doing nothing.
//
// `+#` / `#` / `#%` are placeholders consumed by ItemModifierText.vue; keep the
// shape of the English text or the roll will not be substituted.

const ZH_GEM_TYPE = {
  Aura: '光环',
  Bow: '弓',
  Chaos: '混沌',
  Cold: '冰霜',
  Curse: '诅咒',
  Dexterity: '敏捷',
  Elemental: '元素',
  Fire: '火焰',
  Golem: '魔像',
  Intelligence: '智慧',
  Lightning: '闪电',
  Melee: '近战',
  Minion: '召唤生物',
  Movement: '移动',
  Projectile: '投射物',
  Skill: '技能',
  Spell: '法术',
  Strength: '力量',
  Support: '辅助',
  Vaal: '瓦尔',
  Warcry: '战吼'
}

/** @type {Record<string, string>} */
export const PSEUDO_LABELS = {
  // --- resistances ---------------------------------------------------------------
  '+#% total Elemental Resistance': '+#% 总元素抗性',
  '+#% total Resistance': '+#% 总抗性',
  '+#% total to all Elemental Resistances': '+#% 总所有元素抗性',
  '+#% total to Fire Resistance': '+#% 总火焰抗性',
  '+#% total to Cold Resistance': '+#% 总冰霜抗性',
  '+#% total to Lightning Resistance': '+#% 总闪电抗性',
  '+#% total to Chaos Resistance': '+#% 总混沌抗性',
  '# total Elemental Resistances': '# 总元素抗性',
  '# total Resistances': '# 总抗性',

  // --- attributes ----------------------------------------------------------------
  '+# total to all Attributes': '+# 总全属性',
  '+# total to Strength': '+# 总力量',
  '+# total to Dexterity': '+# 总敏捷',
  '+# total to Intelligence': '+# 总智慧',

  // --- pools ---------------------------------------------------------------------
  '+# total maximum Life': '+# 总最大生命',
  '+# total maximum Mana': '+# 总最大魔力',
  '+# total maximum Energy Shield': '+# 总最大能量护盾',
  '#% total increased maximum Energy Shield': '#% 总提高的最大能量护盾',
  '#% total increased Physical Damage': '#% 总提高的物理伤害',

  // --- speed and crit -------------------------------------------------------------
  '+#% total Attack Speed': '+#% 总攻击速度',
  '+#% total Cast Speed': '+#% 总施法速度',
  '+#% total Critical Strike Chance for Spells': '+#% 总法术暴击几率',
  '+#% Global Critical Strike Chance': '+#% 全局暴击几率',
  '+#% Global Critical Strike Multiplier': '+#% 全局暴击伤害加成',

  // --- elemental spell damage -----------------------------------------------------
  '#% increased Fire Spell Damage': '#% 提高的火焰法术伤害',
  '#% increased Cold Spell Damage': '#% 提高的冰霜法术伤害',
  '#% increased Lightning Spell Damage': '#% 提高的闪电法术伤害',

  // --- regeneration ---------------------------------------------------------------
  '# Life Regenerated per Second': '每秒再生 # 生命',
  '#% of Life Regenerated per Second': '每秒再生 #% 生命',

  // --- modifier counters ----------------------------------------------------------
  '# Modifiers': '# 个词缀',
  '# Prefix Modifiers': '# 个前缀词缀',
  '# Suffix Modifiers': '# 个后缀词缀',
  '# Crafted Modifiers': '# 个工艺词缀',
  '# Crafted Prefix Modifiers': '# 个工艺前缀词缀',
  '# Crafted Suffix Modifiers': '# 个工艺后缀词缀',
  '# Empty Modifiers': '# 个空词缀',
  '# Empty Prefix Modifiers': '# 个空前缀',
  '# Empty Suffix Modifiers': '# 个空后缀',
  '# Enchant Modifiers': '# 个附魔词缀',
  '# Fractured Modifiers': '# 个破裂词缀',
  '# Implicit Modifiers': '# 个固有词缀',
  '# Notable Passive Skills': '# 个显著天赋',

  // --- misc ------------------------------------------------------------------------
  '#% Base Defence Percentile': '#% 基础防御百分位',
  '#% chance for dropped Maps to convert to Shaper Maps': '掉落的地图有 #% 几率转化为塑界者地图',
  '#% chance for dropped Maps to convert to Elder Maps': '掉落的地图有 #% 几率转化为裂界者地图',
  '#% chance for dropped Maps to convert to Conqueror Maps': '掉落的地图有 #% 几率转化为征服者地图',
  '#% chance for dropped Maps to convert to Unique Maps': '掉落的地图有 #% 几率转化为传奇地图',
  '#% chance for dropped Maps to convert to Atlas Memories': '掉落的地图有 #% 几率转化为舆图记忆',
  '#% chance for dropped Maps to convert to Maven Invitations': '掉落的地图有 #% 几率转化为释界邀请',
  '#% chance for dropped Maps to convert to Scarabs': '掉落的地图有 #% 几率转化为圣甲虫'
}

// The 21 "level of socketed X gems" aggregates are pure permutations.
for (const [type, zh] of Object.entries(ZH_GEM_TYPE)) {
  PSEUDO_LABELS[`+# total to Level of Socketed ${type} Gems`] = `+# 插槽内${zh}技能宝石等级`
}
PSEUDO_LABELS['+# total to Level of Socketed Gems'] = '+# 插槽内技能宝石等级'
