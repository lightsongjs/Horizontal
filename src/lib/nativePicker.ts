// Selectorul NATIV de dată sau de oră, deschis direct dintr-o atingere: pe
// Android e calendarul / ceasul sistemului (întâi ora, apoi minutul, OK),
// care bate orice am desena noi. Un `<input type="date|time">` ascuns, creat
// pe loc, plus `showPicker()`.
//
// `showPicker()` cere un gest al utilizatorului (activare tranzitorie), deci
// funcția se cheamă SINCRON din handlerul atingerii — nu după un `await`, nu
// dintr-un efect. Fără gest browserul aruncă `NotAllowedError`, iar promisiunea
// se respinge (`PickerBlocked`): apelantul are atunci o cale de rezervă (foaia
// de dată), în loc de o atingere care pare să nu facă nimic.
//
// Prima zi a săptămânii și formatul le alege SISTEMUL (locale-ul Android sau al
// browserului), nu `lang` al paginii — nu există atribut care să le schimbe.

export type NativeKind = 'date' | 'time'

export class PickerBlocked extends Error {
  constructor() { super('Selectorul nativ cere o atingere.') }
}

/** Selectorul încă deschis: unul nou îl închide pe cel vechi ca anulat. */
let pending: (() => void) | null = null

/**
 * Deschide selectorul și întoarce valoarea aleasă (`YYYY-MM-DD` / `HH:MM`), sau
 * `null` la anulare. O alegere identică cu `value` nu e o schimbare (`change`
 * nu vine), deci tot `null` — iar „nimic de schimbat" e exact ce trebuie.
 */
export function pickNative(type: NativeKind, value = ''): Promise<string | null> {
  pending?.()
  return new Promise<string | null>((resolve, reject) => {
    const input = document.createElement('input')
    input.type = type
    input.value = value
    input.tabIndex = -1
    input.setAttribute('aria-hidden', 'true')
    input.dataset.nativePicker = type
    // În document și „randat": `showPicker()` refuză un element detașat. Nu
    // `display: none` — opac, de un pixel, fără atingeri.
    Object.assign(input.style, {
      position: 'fixed', left: '50%', bottom: '0', width: '1px', height: '1px',
      opacity: '0', pointerEvents: 'none', border: '0', padding: '0',
    })
    document.body.appendChild(input)

    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      settled = true
      if (timer) clearTimeout(timer)
      input.removeEventListener('change', onChange)
      input.removeEventListener('cancel', onCancel)
      window.removeEventListener('focus', onRefocus)
      document.removeEventListener('pointerdown', onCancel, true)
      if (pending === cancel) pending = null
      input.remove()
    }
    const finish = (v: string | null) => {
      if (settled) return
      cleanup()
      resolve(v)
    }
    const onChange = () => finish(input.value || null)
    const onCancel = () => finish(null)
    const cancel = () => finish(null)
    // Anularea nu are un eveniment sigur peste tot (`cancel` e nou). Pe Android
    // dialogul ia focusul ferestrei; la întoarcere, dacă `change` n-a venit în
    // scurt timp, a fost „Anulează". Următoarea atingere în pagină la fel.
    const onRefocus = () => { timer = setTimeout(() => finish(null), 400) }
    input.addEventListener('change', onChange)
    input.addEventListener('cancel', onCancel)
    window.addEventListener('focus', onRefocus)
    document.addEventListener('pointerdown', onCancel, true)
    pending = cancel

    try {
      if (typeof input.showPicker === 'function') input.showPicker()
      else { input.focus(); input.click() }
    } catch {
      cleanup()
      reject(new PickerBlocked())
    }
  })
}

/** `YYYY-MM-DD` → ziua locală, la 00:00 (nu UTC, ca `new Date('2026-10-11')`). */
export function dateFromInput(v: string): Date {
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d)
}
