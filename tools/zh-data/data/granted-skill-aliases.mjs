// Trade-site skill names that do not normalise to the game's `ActiveSkills` id.
//
// Only needed for the handful of "Grants Level # <skill> Skill" mods whose name
// on the trade site is not the internal id spelled out: the aspects are stored
// as `aspect_bird` / `aspect_cat` / ..., the barnacle uses an internal name, and
// the game itself misspells "Bestial" as "beastial" in three ids.
//
// Everything else is derived at build time (see `lib/skills.mjs`), so this table
// only has to grow when GGG adds a skill whose trade name is not a literal id.
export default {
  'Aspect of the Avian': 'aspect_bird',
  'Aspect of the Cat': 'aspect_cat',
  'Aspect of the Crab': 'aspect_crab',
  'Aspect of the Spider': 'aspect_spider',
  'Petrification Statue': 'summon_petrification_statue',
  Snipe: 'channelled_snipe',
  'Savage Barnacle': 'barnacle_snap',
  'Will of the Lords': 'breach_hand_trap',
  'Summon Bestial Rhoa': 'summon_beastial_rhoa',
  'Summon Bestial Snake': 'summon_beastial_snake',
  'Summon Bestial Ursa': 'summon_beastial_ursa'
}
