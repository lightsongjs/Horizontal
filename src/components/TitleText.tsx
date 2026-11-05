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
