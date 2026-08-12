import { describe, it, expect } from 'vitest'
import {
  shrinkPlan,
  safeFilename,
  attachmentFilename,
  SHRINK_DEFAULTS,
} from './shrinkImage'

const KB = 1024
const MB = 1024 * 1024

describe('shrinkPlan — ramificarea pe format', () => {
  it('ce nu e imagine nu se atinge', () => {
    const p = shrinkPlan({ type: 'application/pdf', size: 9 * MB, width: 0, height: 0 })
    expect(p).toEqual({ action: 'skip', width: 0, height: 0, outputType: null, reason: 'nu-e-imagine' })
  })

  it('GIF-ul nu se atinge niciodată — canvas i-ar distruge animația', () => {
    const p = shrinkPlan({ type: 'image/gif', size: 8 * MB, width: 900, height: 700 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('format-neatins')
  })

  it('SVG-ul nu se atinge niciodată — rasterizarea e o degradare', () => {
    const p = shrinkPlan({ type: 'image/svg+xml', size: 3 * MB, width: 4000, height: 4000 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('format-neatins')
  })

  it('WEBP-ul se lasă în pace', () => {
    const p = shrinkPlan({ type: 'image/webp', size: 5 * MB, width: 5000, height: 4000 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('format-neatins')
  })

  it('un tip de imagine necunoscut se lasă în pace, nu se ghicește', () => {
    const p = shrinkPlan({ type: 'image/avif', size: 5 * MB, width: 5000, height: 4000 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('format-neatins')
  })

  it('PNG nu produce NICIODATĂ JPEG — ar pierde alpha și ar întinde culorile pe text', () => {
    const p = shrinkPlan({ type: 'image/png', size: 9 * MB, width: 5000, height: 3000 })
    expect(p.outputType).toBe('image/webp')
  })

  it('JPEG rămâne JPEG', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 9 * MB, width: 5000, height: 3000 })
    expect(p.outputType).toBe('image/jpeg')
  })

  it('HEIC de pe iPhone e tratat ca fotografie', () => {
    const p = shrinkPlan({ type: 'image/heic', size: 9 * MB, width: 4032, height: 3024 })
    expect(p.outputType).toBe('image/jpeg')
  })
})

describe('shrinkPlan — praguri', () => {
  it('screenshot-ul de terminal măsurat pe ecranul real nu se atinge (1787x481, 53 KB)', () => {
    const p = shrinkPlan({ type: 'image/png', size: 53 * KB, width: 1787, height: 481 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('deja-mica')
  })

  it('PNG-urile de desktop au prag mai generos decât fotografiile', () => {
    // 900 KB e peste pragul de fotografie (400 KB) dar sub cel de captură (1,5 MB).
    const shot = shrinkPlan({ type: 'image/png', size: 900 * KB, width: 1900, height: 1000 })
    expect(shot.action).toBe('skip')
    const photo = shrinkPlan({ type: 'image/jpeg', size: 900 * KB, width: 1900, height: 1000 })
    expect(photo.action).toBe('recompress')
  })

  it('captura de telefon de 1,1 MB se recomprimă, fără redimensionare', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 1100 * KB, width: 1080, height: 2400 })
    expect(p).toEqual({
      action: 'recompress',
      width: 1080,
      height: 2400,
      outputType: 'image/jpeg',
      reason: 'doar-recomprimare',
    })
  })

  it('pragul de octeți singur nu scutește o imagine uriașă', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 300 * KB, width: 8000, height: 4000 })
    expect(p.action).toBe('resize')
  })

  it('nu mărește niciodată', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 100 * KB, width: 640, height: 480 })
    expect(p.width).toBe(640)
    expect(p.height).toBe(480)
  })

  it('exact la maxEdge nu se redimensionează degeaba', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 5 * MB, width: SHRINK_DEFAULTS.maxEdge, height: 1000 })
    expect(p.reason).toBe('doar-recomprimare')
    expect(p.width).toBe(SHRINK_DEFAULTS.maxEdge)
  })
})

describe('shrinkPlan — scara e o împărțire cu numere întregi', () => {
  it('poza de 200 MP se împarte cu un întreg, nu se potrivește exact pe maxEdge', () => {
    // 16320 / 3072 = 5,31 → divizor 6 → 2720. Scalarea fracționară aliazează
    // liniile de 1px; ÷6 filtrează curat.
    const p = shrinkPlan({ type: 'image/jpeg', size: 13 * MB, width: 12288, height: 16320 })
    expect(p.action).toBe('resize')
    expect(p.width).toBe(2048)
    expect(p.height).toBe(2720)
  })

  it('rezultatul nu depășește niciodată maxEdge', () => {
    for (const long of [3073, 4000, 4096, 6144, 8000, 16320]) {
      const p = shrinkPlan({ type: 'image/jpeg', size: 20 * MB, width: long, height: Math.round(long / 2) })
      expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(SHRINK_DEFAULTS.maxEdge)
    }
  })

  it('proporția se păstrează', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 13 * MB, width: 12288, height: 16320 })
    expect(p.width / p.height).toBeCloseTo(12288 / 16320, 2)
  })

  it('o latură nu ajunge niciodată la 0', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 20 * MB, width: 20000, height: 3 })
    expect(p.height).toBeGreaterThanOrEqual(1)
  })

  it('respectă opțiuni date, nu doar implicitele', () => {
    const p = shrinkPlan(
      { type: 'image/jpeg', size: 5 * MB, width: 4000, height: 2000 },
      { maxEdge: 1000, photoQuality: 0.7, photoSkipUnderBytes: 0, shotSkipUnderBytes: 0 },
    )
    expect(p.width).toBe(1000)
  })
})

describe('safeFilename', () => {
  it('scoate calea', () => {
    expect(safeFilename('C:\\poze\\ecran.png')).toBe('ecran.png')
    expect(safeFilename('/home/user/ecran.png')).toBe('ecran.png')
  })

  it('înlocuiește caracterele de control, păstrează spațiile', () => {
    expect(safeFilename('note de\u0001 lucru.txt')).toBe('note de_ lucru.txt')
  })

  it('nume gol primește unul', () => {
    expect(safeFilename('')).toBe('fisier')
    expect(safeFilename('   ')).toBe('fisier')
  })

  it('taie la 200 de caractere', () => {
    expect(safeFilename('a'.repeat(500)).length).toBe(200)
  })
})

describe('attachmentFilename', () => {
  it('fără reencodare, numele rămâne (curățat)', () => {
    expect(attachmentFilename('C:\\x\\raport.pdf', null)).toBe('raport.pdf')
  })

  it('extensia urmează formatul de IEȘIRE, nu de intrare', () => {
    expect(attachmentFilename('ecran.png', 'image/webp')).toBe('ecran.webp')
    expect(attachmentFilename('IMG_1234.HEIC', 'image/jpeg')).toBe('IMG_1234.jpg')
  })

  it('fișier fără extensie primește una', () => {
    expect(attachmentFilename('scan', 'image/jpeg')).toBe('scan.jpg')
  })

  it('nu produce un nume care e doar extensie', () => {
    expect(attachmentFilename('.HEIC', 'image/jpeg')).toBe('fisier.jpg')
  })
})
