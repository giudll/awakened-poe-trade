import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export type UiLang = 'en' | 'zh_CN'

/**
 * Reads the UI language the renderer last saved to `apt-data/config.json`.
 *
 * The main process renders the tray menu and the update notification before the
 * renderer has a chance to talk to it, so the config file is the only source
 * available at that moment. Falls back to English on any error.
 */
export function readUiLang (): UiLang {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), 'apt-data', 'config.json'), 'utf8')
    const cfg = JSON.parse(raw) as { language?: unknown }
    return cfg.language === 'zh_CN' ? 'zh_CN' : 'en'
  } catch {
    return 'en'
  }
}
