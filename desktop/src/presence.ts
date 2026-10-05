import { execFile } from 'node:child_process'

/** Cât de des întreabă cutia GNOME și trimite paginii starea. */
export const PRESENCE_TICK_MS = 30_000
/** Fără tastatură/maus de atâta timp, omul nu mai e la laptop. */
export const IDLE_LIMIT_MS = 120_000

/**
 * „Omul e la laptop": ecranul deblocat ȘI o atingere recentă. Orice citire
 * eșuată (`null`) înseamnă „nu știu", iar „nu știu" e INACTIV — telefonul sună
 * atunci la minut, ca înainte. O eroare n-are voie să amâne un memento.
 */
export function isActive(idleMs: number | null, locked: boolean | null): boolean {
  return idleMs !== null && locked === false && idleMs < IDLE_LIMIT_MS
}

function gdbus(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gdbus', ['call', '--session', ...args], { timeout: 3000 }, (err, out) => resolve(err ? null : out))
  })
}

/**
 * Prin D-Bus, nu prin `powerMonitor`: pe GNOME Wayland `getSystemIdleTime` nu
 * vede intrarea, iar `lock-screen` nu există pe Linux. `IdleMonitor` (Mutter)
 * și `ScreenSaver` sunt ale shell-ului, deci văd tot (proba, 2026-10-05).
 */
export async function readActive(): Promise<boolean> {
  const [idle, saver] = await Promise.all([
    gdbus(['--dest', 'org.gnome.Mutter.IdleMonitor', '--object-path', '/org/gnome/Mutter/IdleMonitor/Core', '--method', 'org.gnome.Mutter.IdleMonitor.GetIdletime']),
    gdbus(['--dest', 'org.gnome.ScreenSaver', '--object-path', '/org/gnome/ScreenSaver', '--method', 'org.gnome.ScreenSaver.GetActive']),
  ])
  return isActive(parseIdle(idle), parseLocked(saver))
}

/** `(uint64 3904,)` → 3904. Atenție la „64" din tip: numărul e cel DE DUPĂ el. */
export function parseIdle(out: string | null): number | null {
  const m = out?.match(/uint64\s+(\d+)/)
  return m ? Number(m[1]) : null
}

/** `(false,)` → false. */
export function parseLocked(out: string | null): boolean | null {
  if (out == null) return null
  return /\btrue\b/.test(out) ? true : /\bfalse\b/.test(out) ? false : null
}
