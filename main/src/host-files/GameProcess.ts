import { execFile } from 'node:child_process'

/**
 * The overlay library attaches to whichever window enters the foreground and
 * carries the configured title, and it never looks at which process owns that
 * window. A File Explorer window opened at a game folder called "Path of
 * Exile" has exactly the same title as the game, so it gets attached to as if
 * it were the game: the overlay follows it, `focusTarget()` focuses it, and
 * the hotkeys, the screenshots and the focus reporting all end up bound to a
 * window that is not the game.
 *
 * The library starts its hook once and exposes no way to detach or to learn
 * the target's process, so the only place to tell the two apart is here: ask
 * the OS whether the game itself has a window with that title right now.
 *
 * The process name alone cannot answer it. The standalone client has a single
 * `PathOfExile.exe` (the 76 MB one - `Client.exe` and `PathOfExile_x64.exe`
 * are 0.5 MB stubs kept for compatibility), and that same executable is what
 * sits on screen downloading a patch with the progress in its title. Only the
 * window title separates "updating" from "playing".
 *
 * `null` means "cannot tell" and must never be treated as "not running" -
 * blocking the overlay on a failed process read would leave anyone whose
 * process list we cannot see without price checking, which is far worse than
 * the bug this guards against.
 */
export type GameRunning = boolean | null

const CACHE_MS = 2000

let cachedAt = 0
let cachedFor = ''
let cached: GameRunning = null
let inflightFor = ''
let inflight: Promise<GameRunning> | null = null

const GAME_PROCESS = /path ?of ?exile/i

function run (cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout: 4000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/**
 * `tasklist /FO CSV /V` ends every row with the window title as the last
 * quoted field, and escapes an inner quote by doubling it.
 */
function lastCsvField (line: string): string | null {
  const match = /,"((?:[^"]|"")*)"\r?$/.exec(line)
  if (!match) return null
  const value = match[1].replace(/""/g, '"')
  // Windows prints N/A for processes we are not allowed to inspect.
  if (value.length === 0 || value === 'N/A') return null
  return value
}

async function detect (windowTitle: string): Promise<GameRunning> {
  try {
    if (process.platform === 'win32') {
      const out = await run('tasklist', ['/NH', '/FO', 'CSV', '/V'])

      let seenGameProcess = false
      let seenReadableTitle = false

      for (const line of out.split('\n')) {
        const nameEnd = line.indexOf('","')
        if (nameEnd <= 0) continue

        const imageName = line.slice(1, nameEnd)
        if (!GAME_PROCESS.test(imageName)) continue
        seenGameProcess = true

        const title = lastCsvField(line)
        if (title === null) continue
        seenReadableTitle = true
        if (title === windowTitle) return true
      }

      if (!seenGameProcess) return false
      // The game is up but we cannot read any of its titles (usually because
      // it runs elevated). Do not guess against the user here.
      return seenReadableTitle ? false : null
    }

    // macOS and Linux: `comm` is the executable path, and it carries no
    // window title. Treat the process as the game, as before.
    const out = await run('ps', ['-A', '-o', 'comm='])
    return GAME_PROCESS.test(out)
  } catch {
    return null
  }
}

export async function isGameProcessRunning (windowTitle: string): Promise<GameRunning> {
  if (cachedFor === windowTitle && cached !== null && Date.now() - cachedAt < CACHE_MS) {
    return cached
  }
  if (inflight && inflightFor === windowTitle) return inflight

  inflightFor = windowTitle
  inflight = detect(windowTitle).then((result) => {
    cachedFor = inflightFor
    cached = result
    cachedAt = Date.now()
    inflight = null
    return result
  })

  return inflight
}
