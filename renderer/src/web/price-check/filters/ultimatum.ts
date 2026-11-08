import { ITEM_BY_TRANSLATED } from '@/assets/data'
import type { ParsedItem } from '@/parser'
import type { FilterOption, ItemFilters } from './interfaces'

/**
 * Inscribed Ultimatum filters.
 *
 * The trade site exposes four conditions for these items, all of them in the
 * hidden `ultimatum_filters` group:
 *
 *   ultimatum_challenge  Exterminate | Survival | Defense | Conquer
 *   ultimatum_reward     DoubleCurrency | DoubleDivCards | MirrorRare | ExchangeUnique
 *   ultimatum_input      a known item name (what has to be sacrificed)
 *   ultimatum_output     a known unique name (when the reward is a unique)
 *
 * The game prints the *localised* wording ("挑战: 击败的怪物波数"), so the
 * English option ids have to be derived from the Chinese text. Matching on a
 * couple of keywords instead of an exact string keeps working when 编年史
 * rewords a line.
 */
const CHALLENGE_RULES: Array<[RegExp, string]> = [
  [/波数|击败的怪物|waves? of enemies/i, 'Exterminate'],
  [/幸存|存活|survive/i, 'Survival'],
  [/祭坛|altar/i, 'Defense'],
  [/符纹|石阵|stone circles/i, 'Conquer']
]

const REWARD_RULES: Array<[RegExp, string]> = [
  [/命运卡|divination/i, 'DoubleDivCards'],
  [/通货|currency/i, 'DoubleCurrency'],
  [/镜像|mirror/i, 'MirrorRare']
]

function option (value: string, text: string): FilterOption {
  return { option: value, text, disabled: false }
}

/** Resolves a localised item name to the English one the API expects. */
function tradeName (name: string): string | null {
  for (const ns of ['ITEM', 'UNIQUE', 'DIVINATION_CARD'] as const) {
    const hit = ITEM_BY_TRANSLATED(ns, name)?.[0]
    if (hit) return hit.refName
  }
  return null
}

export function createUltimatumFilters (
  item: ParsedItem
): NonNullable<ItemFilters['ultimatum']> | undefined {
  const trial = item.ultimatum
  if (!trial) return undefined

  const out: NonNullable<ItemFilters['ultimatum']> = {}

  if (trial.challenge) {
    const id = CHALLENGE_RULES.find(([re]) => re.test(trial.challenge!))?.[1]
    if (id) out.challenge = option(id, trial.challenge)
  }

  if (trial.sacrifice?.name) {
    const name = tradeName(trial.sacrifice.name)
    if (name) out.sacrifice = option(name, trial.sacrifice.name)
  }

  if (trial.reward) {
    const id = REWARD_RULES.find(([re]) => re.test(trial.reward!.text))?.[1]
    if (id) {
      out.reward = option(id, trial.reward.text)
    } else {
      // No fixed reward matched, so this line names the unique you receive.
      const name = tradeName(trial.reward.text)
      if (name) {
        out.rewardUnique = option(name, trial.reward.text)
      }
      // The API still expects `ultimatum_reward` for these, but the option id
      // alone (ExchangeUnique) would be far too broad to be useful.
    }
  }

  return Object.keys(out).length ? out : undefined
}
