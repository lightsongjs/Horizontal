import { describe, expect, it } from 'vitest'
import { FIT, MAX_SCALE, clampScale, clampView, isZoomed, pan, pinch, toggleZoom, wheelScale, zoomAt } from './zoom'

const box = { w: 390, h: 800 }
const img = { w: 390, h: 292 } // 4000×3000 încăpută pe lățime

/** Unde ajunge pe ecran un punct al imaginii (față de centrul ei). */
const screen = (v: { s: number; x: number; y: number }, q: { x: number; y: number }) => ({ x: v.x + v.s * q.x, y: v.y + v.s * q.y })

describe('clampScale', () => {
  it('nu coboară sub „încape" și nu trece de maxim', () => {
    expect(clampScale(0.3)).toBe(1)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(NaN)).toBe(1)
  })
})

describe('clampView', () => {
  it('la „încape" imaginea stă centrată, oricât ai trage', () => {
    expect(clampView({ s: 1, x: 120, y: -80 }, img, box)).toEqual(FIT)
  })
  it('mărită, marginea nu intră în cutie', () => {
    // 2× → 780 lățime într-o cutie de 390: se poate trage ±195.
    expect(clampView({ s: 2, x: 500, y: 0 }, img, box).x).toBe(195)
    expect(clampView({ s: 2, x: -500, y: 0 }, img, box).x).toBe(-195)
  })
  it('pe axa pe care încă încape, rămâne centrată', () => {
    // 2× → 584 înălțime într-o cutie de 800: încă încape vertical.
    expect(clampView({ s: 2, x: 0, y: 100 }, img, box).y).toBe(0)
  })
})

describe('zoomAt', () => {
  it('ține punctul de sub deget pe loc', () => {
    const f = { x: 100, y: 50 }
    const v = zoomAt(FIT, 2, f, img, box)
    // Punctul imaginii care era sub f (la s=1, q = f) e tot sub f.
    expect(screen(v, f)).toEqual({ x: 200 - 100, y: 0 + 100 })
    expect(v).toEqual({ s: 2, x: -100, y: 0 })
  })
  it('în centru nu mută nimic', () => {
    expect(zoomAt(FIT, 3, { x: 0, y: 0 }, img, box)).toEqual({ s: 3, x: 0, y: 0 })
  })
  it('la colț, marginea e prinsă în loc să lase gol', () => {
    const v = zoomAt(FIT, 2, { x: 195, y: 0 }, img, box)
    expect(v.x).toBe(-195)
  })
})

describe('toggleZoom', () => {
  it('încăpută → 2×, mărită → „încape"', () => {
    const z = toggleZoom(FIT, { x: 50, y: 20 }, img, box)
    expect(z.s).toBe(2)
    expect(isZoomed(z)).toBe(true)
    expect(toggleZoom(z, { x: 0, y: 0 }, img, box)).toEqual(FIT)
  })
})

describe('pinch', () => {
  it('degetele care se depărtează de două ori dublează scara', () => {
    const v = pinch(FIT, { x: -50, y: 0 }, { x: 50, y: 0 }, { x: -100, y: 0 }, { x: 100, y: 0 }, img, box)
    expect(v).toEqual({ s: 2, x: 0, y: 0 })
  })
  it('punctul dintre degete rămâne între degete', () => {
    const a0 = { x: 0, y: 0 }, b0 = { x: 100, y: 0 }
    const a = { x: -50, y: 0 }, b = { x: 150, y: 0 }
    const v = pinch(FIT, a0, b0, a, b, img, box)
    // Mijlocul la început: (50,0) → punctul imaginii q = 50. Acum mijlocul e tot 50.
    expect(screen(v, { x: 50, y: 0 }).x).toBeCloseTo(50)
  })
  it('ciupitul în interior nu coboară sub „încape"', () => {
    const v = pinch({ s: 2, x: 40, y: 0 }, { x: -100, y: 0 }, { x: 100, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }, img, box)
    expect(v).toEqual(FIT)
  })
})

describe('pan', () => {
  it('trage în limitele imaginii', () => {
    expect(pan({ s: 3, x: 0, y: 0 }, 50, 0, img, box)).toEqual({ s: 3, x: 50, y: 0 })
    expect(pan({ s: 3, x: 0, y: 0 }, 9999, 0, img, box).x).toBe(390)
  })
})

describe('wheelScale', () => {
  it('în sus mărește, în jos micșorează, în limite', () => {
    expect(wheelScale(1, -100)).toBeGreaterThan(1)
    expect(wheelScale(2, 100)).toBeLessThan(2)
    expect(wheelScale(1, 1000)).toBe(1)
  })
})
