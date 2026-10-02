import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getAndroidBridge, type AndroidStatus as Status } from '../lib/androidBridge'
import { batteryNeedsHint, formatStamp, notificationsLabel } from '../lib/androidCard'
import { readAndroidChromeSubIds } from '../lib/androidSubs'
import { errorMessage } from '../lib/errorMessage'
import { Icon } from './Icon'

type SettingsKind = 'notifications' | 'exact-alarms' | 'battery'

/**
 * Ecranul de verificare al aplicației de Android, sus în panoul de referință.
 * Răspunde la „de ce n-a sunat?" fără `adb`: fiecare condiție de care depinde
 * o alarmă, cu starea ei reală citită din cutie și un drum direct spre setarea
 * care o repară. Citit la montare și la „Reîncarcă" — nu în buclă: e o
 * fotografie pe care omul o cere, nu un monitor.
 */
export function AndroidStatus() {
  const bridge = getAndroidBridge()
  const [status, setStatus] = useState<Status | null>(null)
  const [info, setInfo] = useState<{ version: string; api: number } | null>(null)
  // `null` = necunoscut (offline, modul local) — nu „0", care ar spune că nu e abonat.
  const [chromeSubs, setChromeSubs] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const read = useCallback(async () => {
    if (!bridge) return
    setBusy(true)
    setErr(null)
    try {
      const [s, i] = await Promise.all([bridge.status(), bridge.getInfo().catch(() => null)])
      setStatus(s)
      setInfo(i)
      setChromeSubs(await readAndroidChromeSubIds().then((ids) => ids.length, () => null))
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [bridge])

  useEffect(() => { void read() }, [read])

  if (!bridge) return null

  const settings = (kind: SettingsKind) => (
    <button className="and-link" onClick={() => void bridge.openSettings({ kind }).catch((e) => setErr(errorMessage(e)))}>
      Setări
    </button>
  )

  const rows: { label: string; value: ReactNode; extra?: ReactNode; note?: string }[] = status ? [
    {
      label: 'Notificări',
      value: notificationsLabel(status.notifications),
      // Doar refuzul trimite în setări; „necerute încă" o cere cardul din „Azi".
      extra: status.notifications === 'denied' && settings('notifications'),
    },
    {
      label: 'Alarme exacte',
      value: !status.exactAlarms
        ? 'nu — sună cu întârzieri de minute'
        : status.exactUsed ? 'da' : 'nu încă — se vor pune la următoarea alarmă',
      extra: !status.exactAlarms && settings('exact-alarms'),
    },
    {
      label: 'Baterie',
      value: status.batteryOptimized ? 'optimizată' : 'fără restricții',
      extra: batteryNeedsHint(status) && settings('battery'),
      note: batteryNeedsHint(status) ? 'Producătorul poate opri aplicația în fundal' : undefined,
    },
    { label: 'Ultima sincronizare', value: formatStamp(status.lastSyncAt) ?? 'niciodată' },
    { label: 'Următoarea alarmă', value: formatStamp(status.nextAlarmAt) ?? '—' },
    { label: 'În așteptare', value: status.queued },
    { label: 'Versiune', value: info ? `${info.version} (api ${info.api})` : '—' },
    { label: 'Chrome abonat pe telefon', value: chromeSubs ?? '—' },
  ] : []

  return (
    <section className="info-sec and-status">
      <div className="and-head">
        <h3>Aplicația de Android</h3>
        <button className="and-reload" onClick={() => void read()} disabled={busy}>
          <Icon name="refresh" size={13} />Reîncarcă
        </button>
      </div>
      {err && <p className="and-err">{err}</p>}
      <dl className="and-rows">
        {rows.map((r) => (
          <div key={r.label} className="and-row">
            <dt>{r.label}</dt>
            <dd>
              <span className="and-val">{r.value}</span>
              {r.extra || null}
              {r.note && <span className="and-note">{r.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
