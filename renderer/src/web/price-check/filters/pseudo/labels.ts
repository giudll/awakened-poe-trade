import { globalMessages } from '@/web/i18n'

/**
 * Display name for a synthetic filter.
 *
 * The pseudo filters have no game text behind them - they are sums the app
 * computes (`+#% total Elemental Resistance`) or trade-site options that never
 * appear on an item (`# Crafted Modifiers`). The 编年史 patch therefore has
 * nothing to translate, and the price check window printed them in English while
 * every real mod was Chinese.
 *
 * `pseudo_text` in the Chinese bundle maps the stat ref to a Chinese label. The
 * English bundle has no such node, so `fallback` - the original English string -
 * is returned there and nothing changes for upstream.
 */
export function pseudoLabel (statRef: string, fallback: string): string {
  const table = globalMessages().pseudo_text as Record<string, string> | undefined
  return table?.[statRef] ?? fallback
}
