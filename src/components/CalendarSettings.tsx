import { useEffect, useState } from 'react'
import { useCalendar } from '../calendar'
import {
  calendarConfigured, disconnectCalendarAccount, googleConnectUrl, setCalendarEnabled, startErrorText,
} from '../data/calendar'
import { FALLBACK_COLOR, type CalendarAccount } from '../lib/calendarEvents'
import { toShortDate, toTimeInput } from '../lib/schedule'

/**
 * „Integrări" din rotița de setări: conturile Google legate, calendarele lor
 * cu comutator și „Deconectează" pe cont. Spre deosebire de restul foii, astea
 * NU sunt pe dispozitiv — sunt ale contului, pe server.
 *
 * Fără clientul OAuth configurat pe server spune asta direct, în loc să ofere
 * un buton care n-are cum să meargă.
 */
export function CalendarSettings() {
  const { available, accounts, reload, patchCalendar } = useCalendar()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!available) return
    let alive = true
    calendarConfigured().then((c) => { if (alive) setConfigured(c) }, (e) => { if (alive) { setConfigured(null); setErr(startErrorText(e)) } })
    return () => { alive = false }
  }, [available])

  if (!available) return null

  const connect = async () => {
    setBusy(true)
    setErr(null)
    try {
      // Navigare, nu fereastră nouă: întoarcerea de la Google e un redirect pe
      // aplicație. În cutiile de Linux și Android, o adresă din altă origine se
      // deschide în browserul sistemului — tokenul ajunge oricum pe server, iar
      // la revenirea în cutie lista se reîmprospătează singură.
      location.href = await googleConnectUrl()
    } catch (e) {
      setErr(startErrorText(e))
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sheet-section-t">Integrări</div>
      <div className="integrations">
        {accounts.map((a) => <AccountBlock key={a.id} account={a} reload={reload} patchCalendar={patchCalendar} onError={setErr} />)}
        {configured === false ? (
          <p className="int-note">
            Google Calendar nu e configurat încă pe server. Pașii sunt în <span className="mono">docs/google-calendar-setup.md</span>.
          </p>
        ) : (
          <button type="button" className="btn-ghost int-connect" onClick={() => void connect()} disabled={busy || configured === null}>
            {busy ? 'Se deschide Google…' : accounts.length ? 'Conectează alt cont Google' : 'Conectează Google Calendar'}
          </button>
        )}
        {err && <p className="int-err">{err}</p>}
        {accounts.length === 0 && configured && (
          <p className="int-note">Evenimentele apar în „Azi" și „7 zile", printre sarcini. Doar citire — nimic nu se scrie în Google.</p>
        )}
      </div>
    </>
  )
}

function AccountBlock({ account, reload, patchCalendar, onError }: {
  account: CalendarAccount
  reload: ReturnType<typeof useCalendar>['reload']
  patchCalendar(id: string, enabled: boolean): void
  onError(m: string | null): void
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const toggle = async (id: string, enabled: boolean) => {
    onError(null)
    patchCalendar(id, enabled)
    try {
      await setCalendarEnabled(id, enabled)
      // Pornit: evenimentele lui vin abia de la Google, deci o rundă forțată.
      // Oprit: triggerul le-a șters deja; o recitire ajunge.
      await reload({ sync: enabled, force: enabled })
    } catch (e) {
      patchCalendar(id, !enabled)
      onError(startErrorText(e))
    }
  }

  const disconnect = async () => {
    if (!confirm) { setConfirm(true); return }
    setBusy(true)
    onError(null)
    try {
      await disconnectCalendarAccount(account.id)
      await reload()
    } catch (e) {
      onError(startErrorText(e))
      setBusy(false)
      setConfirm(false)
    }
  }

  const synced = account.lastSyncedAt ? `${toShortDate(account.lastSyncedAt)} ${toTimeInput(account.lastSyncedAt)}` : null

  return (
    <div className="int-account">
      <div className="int-account-head">
        <span className="int-email">{account.email}</span>
        <button type="button" className={confirm ? 'btn-danger' : 'btn-ghost'} onClick={() => void disconnect()} disabled={busy}>
          {busy ? '…' : confirm ? 'Sigur? Deconectează' : 'Deconectează'}
        </button>
      </div>
      {account.status === 'reconnect' ? (
        <p className="int-err">Google nu mai dă acces la contul ăsta. Deconectează-l și conectează-l din nou.</p>
      ) : synced ? (
        <p className="int-sync">sincronizat <span className="mono">{synced}</span></p>
      ) : null}
      {account.calendars.map((c) => (
        <label key={c.id} className="int-cal">
          <span className="int-cal-dot" style={{ background: c.color || FALLBACK_COLOR }} />
          <span className="int-cal-name">{c.name}</span>
          <input type="checkbox" className="int-switch" checked={c.enabled} onChange={(e) => void toggle(c.id, e.target.checked)} />
        </label>
      ))}
    </div>
  )
}
