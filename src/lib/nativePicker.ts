// Selectorul NATIV de dată sau de oră: pe Android e calendarul / ceasul
// sistemului (întâi ora, apoi minutul, OK), care bate orice am desena noi.
//
// Se deschide printr-un `<input type="date|time">` REAL, transparent, întins
// peste butonul pe care îl atinge omul (`components/NativePick.tsx`) — nu
// printr-un input ascuns plus `showPicker()`. Varianta cu `showPicker()`
// (be8d574) mergea în Chromium și trecea testele, dar pe telefon (APK-ul
// Capacitor, HyperOS) atingerea pe „Dată"/„Oră" nu deschidea nimic. Testul
// înlocuia `showPicker` cu o dublură, deci drumul real nu fusese rulat
// niciodată pe Android. Atingerea directă pe input e drumul pe care îl
// folosesc deja câmpurile vizibile din foile de tichet, verificat pe telefon;
// în plus nu cere activare tranzitorie (`showPicker` o CONSUMĂ, deci un al
// doilea apel din același gest aruncă `NotAllowedError`) și nu are nevoie de
// ghicit anularea (`cancel`/`focus`), fiindcă inputul rămâne montat.
//
// Prima zi a săptămânii și formatul le alege SISTEMUL (locale-ul Android sau al
// browserului), nu `lang` al paginii — nu există atribut care să le schimbe.

export type NativeKind = 'date' | 'time'

/** `YYYY-MM-DD` → ziua locală, la 00:00 (nu UTC, ca `new Date('2026-10-11')`). */
export function dateFromInput(v: string): Date {
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d)
}
