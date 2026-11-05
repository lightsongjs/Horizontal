import type { PointerEvent } from 'react'
import { swallowNextClick } from '../hooks'
import { titleParts } from '../lib/titleLinks'

/**
 * Titlul cu linkurile scoase în evidență. Linkul NU își ia singur click-ul:
 * rândul are deja regulile lui (glisare, apăsare lungă, selecție, arbore, rând
 * deschis), iar în locul în care ar deschide tichetul întreabă `openTitleLink`.
 * Așa o atingere pe link în selecție tot selectează, iar o glisare care s-a
 * terminat pe link nu deschide YouTube.
 *
 * Span, nu `<a>`: rândurile și cardurile sunt `<button>`, iar un link în buton
 * nu e HTML valid (Firefox nu-i trimite click-ul).
 */
export function TitleText({ title }: { title: string }) {
  const parts = titleParts(title)
  if (parts.length === 1 && !('href' in parts[0])) return <>{title}</>
  return (
    <>
      {parts.map((p, i) => 'href' in p
        ? <span key={i} className="title-link" data-href={p.href} title={p.href}>{p.text}</span>
        : p.text)}
    </>
  )
}

/**
 * Atingerea a căzut pe un link din titlu → îl deschide și întoarce `true`
 * (rândul nu mai deschide tichetul). În APK `window.open` ajunge în browserul
 * sistemului / aplicația YouTube, ca linkurile din descriere.
 */
export function openTitleLink(e: { target: EventTarget | null }): boolean {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>('.title-link[data-href]') : null
  if (!el?.dataset.href) return false
  window.open(el.dataset.href, '_blank', 'noopener,noreferrer')
  return true
}

/**
 * Ținta linkului din oglinda unui titlu editabil aflat sub punct —
 * dreptunghiurile reale, câte unul pe rând de text. ±3px pe verticală: un link
 * rupt pe două rânduri lasă între ele un gol de interlinie în care degetul
 * cade ușor.
 */
function linkAt(mirror: HTMLElement | null, x: number, y: number): string | null {
  for (const el of mirror?.querySelectorAll<HTMLElement>('.mirror-link[data-href]') ?? []) {
    for (const r of el.getClientRects()) {
      if (x >= r.left && x <= r.right && y >= r.top - 3 && y <= r.bottom + 3) return el.dataset.href ?? null
    }
  }
  return null
}

/** Cât nu scrii în titlu, sau cu Ctrl/⌘ oricând — regula linkurilor din descriere. */
const opens = (e: PointerEvent<HTMLElement>) =>
  document.activeElement !== e.currentTarget || e.ctrlKey || e.metaKey

/**
 * `pointerdown` pe textarea unui titlu cu oglindă (foaia de tichet, formularul):
 * deschide linkul de sub deget și întoarce `true`. Comanda, nu poziționare:
 * fără focus, fără tastatură, iar click-ul de după ridicare nu ajunge pe foaie.
 */
export function mirrorLinkDown(e: PointerEvent<HTMLElement>, mirror: HTMLElement | null): boolean {
  if (!opens(e)) return false
  const href = linkAt(mirror, e.clientX, e.clientY)
  if (!href) return false
  e.preventDefault()
  swallowNextClick()
  window.open(href, '_blank', 'noopener,noreferrer')
  return true
}

/** Maus: mânuța peste un link care s-ar deschide la click. */
export function mirrorLinkHover(e: PointerEvent<HTMLElement>, mirror: HTMLElement | null) {
  if (e.pointerType !== 'mouse') return
  const on = opens(e) && linkAt(mirror, e.clientX, e.clientY) !== null
  e.currentTarget.style.cursor = on ? 'pointer' : ''
}
