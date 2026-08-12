// Ce fișiere intră, din paste sau din drop.
//
// Fără DOM, anume: Vitest rulează în `environment: 'node'` aici, deci un seam
// care atinge ClipboardEvent n-ar putea fi testat. Adaptoarele care ating
// evenimentele reale (`fromClipboard`, `fromDrop` din Attachments.tsx) au trei
// linii și doar reformează datele; toată politica e mai jos, testabilă cu
// obiecte literale.

export interface FileLike {
  name: string
  type: string
  size: number
}

export interface PickCaps {
  imageMaxBytes: number
  otherMaxBytes: number
}

/**
 * Plafoanele sunt PUR UX, nu apărare: browserul urcă direct în Storage, nu
 * există server pe traseu, deci cine vrea le ocolește. Apărarea reală e RLS-ul,
 * care decide *dacă* poți scrie, nu *cât*.
 *
 * Imaginile se măsoară ÎNAINTE de micșorare, fiindcă micșorarea poate eșua (un
 * format nedecodabil) și atunci pleacă originalul.
 */
export const PICK_CAPS: PickCaps = {
  imageMaxBytes: 20 * 1024 * 1024,
  otherMaxBytes: 10 * 1024 * 1024,
}

export type RejectReason = 'prea-mare' | 'gol'

export interface PickResult<T extends FileLike> {
  accept: T[]
  /**
   * Nume de înlocuire, cheiat pe indexul din `accept`. Separat de `accept` ca
   * fișierele să rămână obiectele originale (`File`), nu copii — un `new File`
   * doar pentru redenumire ar rescrie octeții degeaba.
   */
  renamed: Record<number, string>
  rejected: { name: string; reason: RejectReason }[]
}

/** `dataTransfer.types` conține 'Files' doar când transferul poartă fișiere. */
export function carriesFiles(types: readonly string[]): boolean {
  return types.includes('Files')
}

/** Numele pe care browserele le dau unui screenshot din clipboard. */
const GENERIC = /^(image|imagine)\.(png|jpe?g|webp|gif)$/i

const SYNTH_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/**
 * Aplică plafoanele și sintetizează nume pentru screenshot-urile lipite.
 *
 * De ce redenumirea: un screenshot lipit ajunge de la browser cu numele
 * `image.png`, mereu. Fără redenumire fiecare rând din listă ar arăta identic
 * și n-ai putea deosebi două poze una de alta.
 */
export function pickFiles<T extends FileLike>(
  input: { types: readonly string[]; files: readonly T[] },
  opts: { caps?: PickCaps; now?: () => Date } = {},
): PickResult<T> {
  const caps = opts.caps ?? PICK_CAPS
  const now = opts.now ?? (() => new Date())

  const accept: T[] = []
  const renamed: Record<number, string> = {}
  const rejected: { name: string; reason: RejectReason }[] = []

  if (!carriesFiles(input.types)) return { accept, renamed, rejected }

  let synthesized = 0
  for (const file of input.files) {
    const type = file.type.toLowerCase()
    if (file.size === 0) {
      rejected.push({ name: file.name || 'fișier', reason: 'gol' })
      continue
    }
    const cap = type.startsWith('image/') ? caps.imageMaxBytes : caps.otherMaxBytes
    if (file.size > cap) {
      rejected.push({ name: file.name || 'fișier', reason: 'prea-mare' })
      continue
    }
    const index = accept.length
    accept.push(file)
    if (!file.name || GENERIC.test(file.name)) {
      synthesized += 1
      const ext = SYNTH_EXT[type] ?? 'png'
      const suffix = synthesized > 1 ? `-${synthesized}` : ''
      renamed[index] = `screenshot-${stamp(now())}${suffix}.${ext}`
    }
  }

  return { accept, renamed, rejected }
}

const CAPS_TEXT = 'Imaginile pot avea cel mult 20 MB, celelalte fișiere 10 MB.'
const FOLDER_TEXT = 'Folderele nu se pot atașa — trage fișierele din ele.'

/**
 * Ce se arată pe ecran când plafonul a tăiat din ce ai ales. Refuzul tăcut e un
 * bug în altă haină: alegi șase fișiere, vezi două, și n-ai cum să afli de ce.
 *
 * Cele două motive se raportează SEPARAT. Un lot amestecat — un folder tras
 * peste un fișier gras — se întâmplă în practică, iar un mesaj care spune
 * „prea mari" despre folder minte exact acolo unde funcția asta există ca să
 * nu mintă.
 */
export function rejectMessage(rejected: PickResult<FileLike>['rejected']): string | null {
  if (rejected.length === 0) return null

  const tooBig = rejected.filter((r) => r.reason === 'prea-mare')
  const empty = rejected.filter((r) => r.reason === 'gol')

  const bigSentence =
    tooBig.length === 0
      ? null
      : tooBig.length === 1
        ? `${tooBig[0].name} e prea mare. ${CAPS_TEXT}`
        : `${tooBig.length} fișiere nu au fost adăugate: prea mari. ${CAPS_TEXT}`

  const emptySentence =
    empty.length === 0
      ? null
      : empty.length === 1
        ? `${empty[0].name} nu a putut fi citit. ${FOLDER_TEXT}`
        : `${empty.length} fișiere nu au putut fi citite. ${FOLDER_TEXT}`

  return [bigSentence, emptySentence].filter(Boolean).join(' ')
}
