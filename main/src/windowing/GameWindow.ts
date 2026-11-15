import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { OverlayController, AttachEvent } from 'electron-overlay-window'
import { isGameProcessRunning } from '../host-files/GameProcess'

export interface GameWindow {
  on: (event: 'active-change', listener: (isActive: boolean) => void) => this
  on: (event: 'target-change', listener: (isGame: boolean | null) => void) => this
}
export class GameWindow extends EventEmitter {
  private _isActive = false
  private _isTracking = false
  /**
   * Whether the attached window belongs to the game. The library matches on
   * the window title alone, so any other window with the same title -a File
   * Explorer window sitting in a folder named after the game- is attached to
   * just the same, and everything from here on treats it as the game.
   *
   * `null` until checked, and also when the check cannot decide; only an
   * explicit `false` disables anything.
   */
  private _targetIsGame: boolean | null = null
  private targetTitle = ''
  private verifyToken = 0

  get bounds () { return OverlayController.targetBounds }

  get isActive () { return this._isActive && this._targetIsGame !== false }

  set isActive (active: boolean) {
    if (this._isActive !== active) {
      this._isActive = active
      this.emit('active-change', this.isActive)
    }
  }

  get targetIsGame () { return this._targetIsGame }

  get uiSidebarWidth () {
    // sidebar is 370px at 800x600
    const ratio = 370 / 600
    return Math.round(this.bounds.height * ratio)
  }

  constructor () {
    super()
  }

  attach (window: BrowserWindow | undefined, title: string) {
    if (!this._isTracking) {
      this.targetTitle = title
      OverlayController.events.on('focus', () => { this.isActive = true })
      OverlayController.events.on('blur', () => { this.isActive = false })
      OverlayController.events.on('attach', () => { void this.verifyTarget() })
      OverlayController.events.on('detach', () => {
        this.verifyToken += 1
        this.setTargetIsGame(null)
        this.isActive = false
      })
      OverlayController.attachByTitle(window, title, { hasTitleBarOnMac: true })
      this._isTracking = true
    }
  }

  onAttach (cb: (hasAccess: boolean | undefined) => void) {
    OverlayController.events.on('attach', (e: AttachEvent) => {
      cb(e.hasAccess)
    })
  }

  screenshot () {
    return OverlayController.screenshot()
  }

  private async verifyTarget () {
    // Without a title there is nothing to match against, and guessing here
    // would switch the overlay off for someone who never set one.
    if (!this.targetTitle) return

    const token = ++this.verifyToken
    const running = await isGameProcessRunning(this.targetTitle)
    // A newer attach happened while we were asking; its answer is the one
    // that describes the window we are attached to now.
    if (token !== this.verifyToken) return
    if (running === null) return
    this.setTargetIsGame(running)
  }

  private setTargetIsGame (isGame: boolean | null) {
    if (this._targetIsGame === isGame) return
    const wasActive = this.isActive
    this._targetIsGame = isGame
    this.emit('target-change', isGame)
    if (wasActive !== this.isActive) {
      this.emit('active-change', this.isActive)
    }
  }
}
