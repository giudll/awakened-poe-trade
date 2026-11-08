import { Notification, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'fs'
import path from 'path'
import type { ServerEvents } from './server'
import type { UpdateInfo } from '../../ipc/types'
import { readUiLang, type UiLang } from './host-files/readUiLang'

const CHECK_INTERVAL = 30 * 60 * 1000

const NOTIFY_TEXT: Record<UiLang, { title: string, body: string }> = {
  en: {
    title: 'Update available',
    body: 'Version {0} is ready. Click to open the downloads page.'
  },
  zh_CN: {
    title: '有新版本可用',
    body: '新版本 {0} 已发布，点击打开下载页面。'
  }
}

/** `releaseType`/`owner`/`repo` of the packaged app, see `resources/app-update.yml`. */
function readReleasesPage (): string | null {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const owner = /^owner:\s*(\S+)$/m.exec(yml)?.[1]
    const repo = /^repo:\s*(\S+)$/m.exec(yml)?.[1]
    return (owner && repo) ? `https://github.com/${owner}/${repo}/releases` : null
  } catch {
    return null
  }
}

export class AppUpdater {
  private _checkedAtStartup = false
  private _info: UpdateInfo = { state: 'initial' }
  private _notifiedVersion: string | null = null

  public readonly noAutoUpdatesReason:
    Extract<UpdateInfo, { state: 'update-available' }>['noDownloadReason'] = null

  get info () { return this._info }
  set info (info: UpdateInfo) {
    this._info = info
    this.server.sendEventTo('broadcast', {
      name: 'MAIN->CLIENT::updater-state',
      payload: info
    })
  }

  constructor (
    private server: ServerEvents
  ) {
    // Upstream checks every 16 hours, which is fine for a handful of releases a
    // year. This fork rebuilds whenever the 编年史 patch changes, so a running
    // copy has to notice a new build within the same session.
    setInterval(this.check, CHECK_INTERVAL)

    this.server.onEventAnyClient('CLIENT->MAIN::user-action', ({ action }) => {
      if (action === 'check-for-update') {
        this.check()
      } else if (action === 'update-and-restart') {
        autoUpdater.quitAndInstall(false)
      }
    })

    // https://www.electron.build/configuration/nsis.html#portable
    autoUpdater.autoDownload = !process.env.PORTABLE_EXECUTABLE_DIR

    if (!autoUpdater.autoDownload || process.platform === 'darwin') {
      this.noAutoUpdatesReason = 'not-supported'
    } else if (process.argv.includes('--no-updates')) {
      autoUpdater.autoDownload = false
      this.noAutoUpdatesReason = 'disabled-by-flag'
    }

    autoUpdater.on('checking-for-update', () => {
      this.info = { state: 'checking-for-update' }
    })
    autoUpdater.on('update-available', (info: { version: string }) => {
      this.info = { state: 'update-available', version: info.version, noDownloadReason: this.noAutoUpdatesReason }
      this.notify(info.version)
    })
    autoUpdater.on('update-not-available', () => {
      this.info = { state: 'update-not-available', checkedAt: Date.now() }
    })
    autoUpdater.on('error', () => {
      this.info = { state: 'error', checkedAt: Date.now() }
    })
    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      this.info = { state: 'update-downloaded', version: info.version }
    })
    // on('download-progress') https://github.com/electron-userland/electron-builder/issues/2521
  }

  checkAtStartup () {
    if (!this._checkedAtStartup) {
      this._checkedAtStartup = true
      this.check()
    }
  }

  private check = async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // handled by event
    }
  }

  /**
   * Desktop notification for a freshly published build. A running copy is
   * checked every `CHECK_INTERVAL`, so the toast shows up while the user is
   * still in game instead of only at the next start. One toast per version.
   */
  private notify (version: string) {
    if (this._notifiedVersion === version) {
      return
    }
    if (!Notification.isSupported()) {
      return
    }
    this._notifiedVersion = version

    const text = NOTIFY_TEXT[readUiLang()]
    const notification = new Notification({
      title: text.title,
      body: text.body.replace('{0}', version),
      silent: true
    })
    notification.on('click', () => {
      const page = readReleasesPage()
      if (page) {
        void shell.openExternal(page)
      }
    })
    notification.show()
  }
}
