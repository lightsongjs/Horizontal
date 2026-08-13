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

export type RejectReason = 'gol'

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
 * Respinge ce nu se poate încărca și sintetizează nume pentru screenshot-urile
 * lipite.
 *
 * De ce redenumirea: un screenshot lipit ajunge de la browser cu numele
 * `image.png`, mereu. Fără redenumire fiecare rând din listă ar arăta identic
 * și n-ai putea deosebi două poze una de alta.
 */
export function pickFiles<T extends FileLike>(
  input: { types: readonly string[]; files: readonly T[] },
  opts: { now?: () => Date } = {},
): PickResult<T> {
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

const FOLDER_TEXT = 'Folderele nu se pot atașa — trage fișierele din ele.'

/**
 * Ce se arată pe ecran când un fișier a fost respins. Refuzul tăcut e un bug
 * în altă haină: alegi șase fișiere, vezi cinci, și n-ai cum să afli de ce.
 */
export function rejectMessage(rejected: PickResult<FileLike>['rejected']): string | null {
  if (rejected.length === 0) return null

  return rejected.length === 1
    ? `${rejected[0].name} nu a putut fi citit. ${FOLDER_TEXT}`
    : `${rejected.length} fișiere nu au putut fi citite. ${FOLDER_TEXT}`
}
