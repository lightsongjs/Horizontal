import { describe, expect, it } from 'vitest'
import {
  crossedFull, dragOffset, drawerSwipe, fullThreshold, inEdge, lockAxis, movedBeyondTap, release,
  REVEAL_LEFT, REVEAL_RIGHT,
} from './swipe'

describe('lockAxis', () => {
  it('nu decide sub 10px', () => {
    expect(lockAxis(6, 6)).toBe('pending')
    expect(lockAxis(9, 0)).toBe('pending')
  })
  it('orizontal doar peste raportul 1,5', () => {
    expect(lockAxis(16, 10)).toBe('h')
    expect(lockAxis(-30, 4)).toBe('h')
    expect(lockAxis(15, 10)).toBe('v') // exact 1,5 → derularea câștigă
    expect(lockAxis(4, 30)).toBe('v')
  })
})

describe('praguri', () => {
  it('atingerea se anulează peste 8px', () => {
    expect(movedBeyondTap(5, 5)).toBe(false)
    expect(movedBeyondTap(9, 0)).toBe(true)
  })
  it('marginile de 24px sunt ale sistemului', () => {
    expect(inEdge(10, 390)).toBe(true)
    expect(inEdge(380, 390)).toBe(true)
    expect(inEdge(200, 390)).toBe(false)
  })
  it('glisarea completă e la 55% din rând', () => {
    expect(fullThreshold(360)).toBe(198)
    expect(crossedFull(197, 360)).toBe(false)
    expect(crossedFull(-198, 360)).toBe(true)
  })
})

describe('dragOffset', () => {
  it('pornește de la banda deschisă', () => {
    expect(dragOffset('right', 20, 360)).toBe(-REVEAL_RIGHT + 20)
    expect(dragOffset('left', -10, 360)).toBe(REVEAL_LEFT - 10)
  })
  it('un rând deschis nu sare peste zero pe cealaltă bandă', () => {
    expect(dragOffset('right', 400, 360)).toBe(0)
    expect(dragOffset('left', -400, 360)).toBe(0)
  })
  it('nu iese din rând', () => {
    expect(dragOffset('closed', 900, 360)).toBe(360)
    expect(dragOffset('closed', -900, 360)).toBe(-360)
  })
})

describe('release', () => {
  const w = 360
  it('dreapta peste prag → Mâine', () => expect(release(200, w)).toEqual({ kind: 'commit-right' }))
  it('stânga peste prag → foaia de dată, nu o acțiune', () => expect(release(-250, w)).toEqual({ kind: 'full-left' }))
  it('peste jumătatea benzii rămâne deschis', () => {
    expect(release(40, w)).toEqual({ kind: 'rest', rest: 'left' })
    expect(release(-90, w)).toEqual({ kind: 'rest', rest: 'right' })
  })
  it('altfel se închide', () => {
    expect(release(20, w)).toEqual({ kind: 'rest', rest: 'closed' })
    expect(release(-60, w)).toEqual({ kind: 'rest', rest: 'closed' })
  })
})

describe('drawerSwipe', () => {
  it('se deschide numai din marginea stângă, pe orizontală, spre dreapta', () => {
    expect(drawerSwipe(10, 'h', 60)).toBe(true)
    expect(drawerSwipe(10, 'h', 30)).toBe(false)
    expect(drawerSwipe(10, 'v', 80)).toBe(false)
    expect(drawerSwipe(10, 'h', -80)).toBe(false)
    // În afara marginii e glisarea rândului, nu a sertarului.
    expect(drawerSwipe(40, 'h', 80)).toBe(false)
  })
})
