// Numele arhivei „descarcă tot" și ale fișierelor din ea. Pur, ca să aibă teste.
//
// Un browser nu poate crea un folder în Descărcări — poate salva doar un fișier.
// De-aia folderul călătorește ÎN arhivă: `HZ-12 Titlu.zip` conține
// `HZ-12 Titlu/…`, iar dezarhivarea dă exact folderul cu numele tichetului.

/** Caractere interzise pe Windows (cel mai strict dintre sisteme) + control. */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/** Destul cât să recunoști tichetul, puțin cât să nu treacă de MAX_PATH. */
const TITLE_MAX = 60

/**
 * `HZ-12 Titlul tichetului`. ID-ul e primul: două tichete cu același titlu
 * n-au voie să dea același folder, iar sortarea alfabetică le ține pe proiect.
 * Fără punct sau spațiu la capăt (Windows le taie și numele nu se mai potrivește).
 */
export function zipFolderName(issueId: string, title: string): string {
  const clean = (s: string) => s.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim()
  let t = clean(title)
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX).trimEnd() + '…'
  const name = clean(`${clean(issueId)} ${t}`).replace(/[. ]+$/, '')
  return name || 'atasamente'
}

/**
 * Nume unice în arhivă, în ordinea primită. Două poze lipite pot avea același
 * nume, iar o arhivă cu două intrări identice pierde una la dezarhivare.
 * A doua devine `nume (2).ext`, ca în Descărcări.
 */
export function uniqueNames(filenames: readonly string[]): string[] {
  const taken = new Set<string>()
  return filenames.map((raw) => {
    const name = raw.replace(FORBIDDEN, '_').trim() || 'fisier'
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = name
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`
    taken.add(candidate.toLowerCase())
    return candidate
  })
}
