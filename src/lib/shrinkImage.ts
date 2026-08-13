// Micșorarea imaginilor înainte de upload.
//
// De ce în browser: nu există server pe traseu — browserul urcă direct în
// Supabase Storage. Micșorarea aici scutește spațiul din bucket (1 GB pe planul
// gratuit) și timpul de așteptare.
//
// SINGURUL PLAFON RĂMAS E CEL DE PROIECT AL SUPABASE (setare din dashboard, ~50 MB
// pe planul gratuit), în afara controlului aplicației. Micșorarea e optimizare,
// nu apărare — poate eșua (format nedecodabil) și atunci pleacă originalul.
//
// CALIBRARE: numerele de mai jos vin din măsurători pe materialul real al
// utilizatorului (70 de imagini, 2026-08-12) — vezi secțiunea „Calibrare" din
// spec. Recalibrare: `npm run test:shrink -- --calibrate <cale-poza>`.

export interface ShrinkOptions {
  /** Latura lungă maximă, în pixeli. */
  maxEdge: number
  /** Calitatea pentru ramura de fotografie, 0..1. */
  photoQuality: number
  /** Sub atâția octeți nu se atinge o fotografie. */
  photoSkipUnderBytes: number
  /** Sub atâția octeți nu se atinge o captură PNG. Mai generos: capturile sunt
   *  deja bine comprimate, iar reencodarea lor câștigă puțin și riscă mult. */
  shotSkipUnderBytes: number
}

/**
 * `maxEdge: 3072` nu e o preferință — e alegerea corpusului. Din 70 de imagini
 * reale, peste 2000px sunt 43, peste 3072px sunt 2. Adică 2000 ar redimensiona
 * majoritatea (inclusiv capturile de telefon de 1080×2400, care au text mic),
 * iar 3072 atinge exact cele două poze de cameră care au nevoie.
 *
 * `photoQuality: 0.92` e calibrat pe două fișiere reale (2026-08-12), prin
 * `npm run test:shrink -- --calibrate`. Cazul care decide e captura de telefon
 * `Screenshot_2026-02-05-20-39-01-973_com.sonar.app.jpg` (1240 KB, 1080×2400):
 * fiind sub `maxEdge`, se doar RECOMPRIMĂ, nu se redimensionează — JPEG peste
 * JPEG, a doua generație de pierderi, pe text mic. La `maxEdge 3072`:
 *
 * | quality | rezultat | raport |
 * |---|---|---|
 * | 0.92 | 561 KB | 2,2× mai mic |
 * | 0.85 | 423 KB | 2,9× mai mic |
 * | 0.78 | 349 KB | 3,6× mai mic |
 *
 * Poza de cameră de 200 MP (`IMG_20260805_113025.jpg`, 13366 KB) nu decide
 * nimic aici: trece pe ramura de redimensionare (12288×16320 → 2048×2720,
 * confirmând regula divizorului întreg), unde pierderea de calitate nu se
 * vede — la 0.92 iese oricum de 25× mai mică.
 *
 * Utilizatorul a ales 0.92, nu 0.85, uitându-se la decupajele 1:1 din ambele
 * cazuri: diferența de octeți între ele e mică la scara asta de stocare (sute
 * de KB pe fișier, planul gratuit Supabase), dar text ilizibil într-o captură
 * de telefon costă mai mult decât economisește spațiul. Marja a câștigat.
 */
export const SHRINK_DEFAULTS: ShrinkOptions = {
  maxEdge: 3072,
  photoQuality: 0.92,
  photoSkipUnderBytes: 400 * 1024,
  shotSkipUnderBytes: 1536 * 1024,
}

export type ShrinkOutputType = 'image/jpeg' | 'image/webp'

export interface ShrinkPlan {
  action: 'skip' | 'recompress' | 'resize'
  /** Dimensiunile țintă; egale cu cele de intrare când doar se recomprimă. */
  width: number
  height: number
  /**
   * Formatul de ieșire, câmp de prim rang **anume** ca decizia să fie date
   * testabile. O simplă comparație de octeți („dacă a ieșit mai mare, ține
   * originalul") nu poate vedea pierderea canalului alpha, deci nu poate ține
   * locul deciziei de format. `null` = nu reencodăm.
   */
  outputType: ShrinkOutputType | null
  reason: 'nu-e-imagine' | 'format-neatins' | 'deja-mica' | 'doar-recomprimare' | 'prea-mare'
}

/** Formatele pe care le reencodăm, și în ce. Orice altceva se lasă în pace. */
const BRANCH: Record<string, ShrinkOutputType> = {
  'image/png': 'image/webp',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/heic': 'image/jpeg',
  'image/heif': 'image/jpeg',
}

/**
 * Decizia, separată de canvas ca să poată fi testată fără browser.
 *
 * Nu mărește niciodată. Iar când micșorează, scara e o împărțire cu un număr
 * ÎNTREG, nu o potrivire exactă pe `maxEdge`: scalarea fracționară aliazează
 * liniile de 1px (bordurile de UI, conturul glifelor), iar ÷2 sau ÷3 filtrează
 * curat. Plătim cu câțiva pixeli sub limită, câștigăm text care se citește.
 */
export function shrinkPlan(
  input: { type: string; size: number; width: number; height: number },
  opts: ShrinkOptions = SHRINK_DEFAULTS,
): ShrinkPlan {
  const { size, width, height } = input
  // Normalizat o singură dată: garda de mai jos și tabelul BRANCH trebuie să
  // vadă același șir, altfel un tip ca 'IMAGE/PNG' pică la gardă înainte să
  // ajungă la potrivirea case-insensitive din BRANCH.
  const type = input.type.toLowerCase()
  const keep = (reason: ShrinkPlan['reason']): ShrinkPlan => ({
    action: 'skip',
    width,
    height,
    outputType: null,
    reason,
  })

  if (!type.startsWith('image/')) return keep('nu-e-imagine')

  const outputType = BRANCH[type]
  // GIF (canvas îi pierde animația), SVG (rasterizarea e o degradare), WEBP
  // (deja eficient) și orice tip necunoscut: nu ghicim, nu atingem.
  if (!outputType) return keep('format-neatins')

  // Derivat din tipul de INTRARE, nu din formatul de ieșire: azi doar PNG
  // mapează spre webp, dar cuplarea pragului de "e o captură" de decizia de
  // format ar rupe silențios dacă mâine se adaugă un alt format în BRANCH.
  const isShot = type === 'image/png'
  const skipUnder = isShot ? opts.shotSkipUnderBytes : opts.photoSkipUnderBytes
  const longEdge = Math.max(width, height)

  if (size <= skipUnder && longEdge <= opts.maxEdge) return keep('deja-mica')

  if (longEdge <= opts.maxEdge) {
    // Fișier gras, dimensiuni rezonabile: merită recomprimat, nu redimensionat.
    return { action: 'recompress', width, height, outputType, reason: 'doar-recomprimare' }
  }

  const divisor = Math.ceil(longEdge / opts.maxEdge)
  return {
    action: 'resize',
    width: Math.max(1, Math.round(width / divisor)),
    height: Math.max(1, Math.round(height / divisor)),
    outputType,
    reason: 'prea-mare',
  }
}

/**
 * Nume pentru AFIȘARE (coloana `filename`). Scoate calea, caracterele de
 * control, limitează lungimea. NU se folosește niciodată în calea din Storage —
 * aceea e construită doar din id-uri.
 */
export function safeFilename(name: string): string {
  const base = (name ?? '').split(/[/\\]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex -- match intenționat de caractere de control
  const cleaned = base.replace(/[\x00-\x1f]/g, '_').trim()
  if (!cleaned) return 'fisier'
  return cleaned.slice(0, 200)
}

const EXT: Record<ShrinkOutputType, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * `ecran.png` + WebP → `ecran.webp`. Extensia e cosmetică (`content_type` din DB
 * e sursa de adevăr la descărcare), dar un nume care minte despre conținut
 * încurcă pe oricine descarcă fișierul.
 *
 * Se apelează DUPĂ micșorare, cu formatul chiar produs — inclusiv `null`, când
 * garda de dimensiune a păstrat originalul.
 */
export function attachmentFilename(name: string, outputType: ShrinkOutputType | null): string {
  const safe = safeFilename(name)
  if (!outputType) return safe
  const stem = safe.replace(/\.[^.]+$/, '')
  return `${stem || 'fisier'}.${EXT[outputType]}`
}

function drawTo(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Implicitul browserului pe scalări mari face textul zimțat, exact la ce ne
  // uităm noi într-un screenshot de cod.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

/**
 * Întoarce fișierul micșorat sau, în ORICE caz de îndoială, fișierul primit.
 *
 * Regula întregii funcții: **nu strica uploadul**. Orice eșec — format pe care
 * browserul nu-l decodează (HEIC în majoritatea browserelor), canvas
 * indisponibil, rezultat mai mare decât originalul — se termină cu fișierul
 * original, nu cu o eroare în fața utilizatorului.
 *
 * Orientarea: reencodarea prin canvas pierde EXIF-ul, deci orientarea trebuie
 * să intre în pixeli la decodare, altfel o poză verticală ajunge culcată.
 * `imageOrientation: 'from-image'` e scris explicit nu pentru că Chromium ar
 * greși fără el — acolo e deja implicitul — ci pentru că implicitul din
 * specificație a fost `none` până nu demult, iar orientarea nu are voie să
 * depindă de versiunea de browser.
 *
 * Calitatea la WebP e 1.0 = fără pierderi. Ramura de PNG există ca să scadă
 * octeții FĂRĂ să atingă pixelii; un WebP cu pierderi ar readuce exact
 * artefactele pentru care am ocolit JPEG-ul.
 */
export async function shrinkImage(file: File, opts: ShrinkOptions = SHRINK_DEFAULTS): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file // format nedecodabil aici
  }

  try {
    const plan = shrinkPlan(
      { type: file.type, size: file.size, width: bitmap.width, height: bitmap.height },
      opts,
    )
    if (plan.action === 'skip' || !plan.outputType) return file

    const target = drawTo(plan.width, plan.height)
    if (!target) return file
    target.ctx.drawImage(bitmap, 0, 0, plan.width, plan.height)

    const quality = plan.outputType === 'image/webp' ? 1 : opts.photoQuality
    const blob = await new Promise<Blob | null>((resolve) =>
      target.canvas.toBlob(resolve, plan.outputType!, quality),
    )
    // Plasă de siguranță, nu decizia principală: se întâmplă real ca o
    // reencodare să crească. Decizia de format s-a luat deja în `shrinkPlan`.
    if (!blob || blob.size >= file.size) return file

    return new File([blob], attachmentFilename(file.name, plan.outputType), {
      type: plan.outputType,
      lastModified: file.lastModified,
    })
  } finally {
    bitmap.close()
  }
}
