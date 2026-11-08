import path from 'path'
import { app, Tray, Menu, shell, nativeImage, dialog } from 'electron'
import type { ServerEvents } from './server'
import { readUiLang, type UiLang } from './host-files/readUiLang'

interface TrayText {
  settings: string
  settingsTitle: string
  settingsHint: string
  openInBrowser: string
  openConfigFolder: string
  quit: string
}

const TRAY_TEXT: Record<UiLang, TrayText> = {
  en: {
    settings: 'Settings/League',
    settingsTitle: 'Settings',
    settingsHint: 'Open Path of Exile and press "{0}". Click on the button with cog icon there.',
    openInBrowser: 'Open in Browser',
    openConfigFolder: 'Open config folder',
    quit: 'Quit'
  },
  zh_CN: {
    settings: '设置 / 赛季',
    settingsTitle: '设置',
    settingsHint: '打开流放之路，按 "{0}"，然后点击带齿轮图标的按钮。',
    openInBrowser: '在浏览器中打开',
    openConfigFolder: '打开配置文件夹',
    quit: '退出'
  }
}

export class AppTray {
  public overlayKey = 'Shift + Space'
  public lang: UiLang = readUiLang()
  private tray: Tray
  serverPort = 0

  constructor (server: ServerEvents) {
    let trayImage = nativeImage.createFromPath(
      path.join(
        __dirname,
        process.env.STATIC!,
        process.platform === "win32" ? "icon.ico" : "icon.png"
      )
    )

    if (process.platform === 'darwin') {
      // Mac image size needs to be smaller, or else it looks huge. Size
      // guideline is from https://iconhandbook.co.uk/reference/chart/osx/
      trayImage = trayImage.resize({ width: 22, height: 22 })
    }

    this.tray = new Tray(trayImage)
    this.tray.setToolTip(`Awakened PoE Trade v${app.getVersion()}`)
    this.rebuildMenu()

    server.onEventAnyClient('CLIENT->MAIN::user-action', ({ action }) => {
      if (action === 'quit') {
        app.quit()
      }
    })
  }

  rebuildMenu () {
    const text = TRAY_TEXT[this.lang]
    const contextMenu = Menu.buildFromTemplate([
      {
        label: text.settings,
        click: () => {
          dialog.showMessageBox({
            title: text.settingsTitle,
            message: text.settingsHint.replace('{0}', this.overlayKey)
          })
        }
      },
      {
        label: text.openInBrowser,
        click: () => {
          shell.openExternal(`http://localhost:${this.serverPort}`)
        }
      },
      { type: 'separator' },
      {
        label: text.openConfigFolder,
        click: () => {
          shell.openPath(path.join(app.getPath('userData'), 'apt-data'))
        }
      },
      {
        label: text.quit,
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }
}
