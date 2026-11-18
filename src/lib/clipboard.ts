/**
 * Copiază text în clipboard; `true` doar la o copiere confirmată.
 *
 * `navigator.clipboard.writeText` cere context securizat și, în unele WebView-uri
 * (APK-ul, Electron fără permisiune), lipsește sau respinge — atunci textarea
 * ascuns + `execCommand('copy')`. Acela e deprecat și poate eșua în tăcere, deci
 * îi verificăm rezultatul: bifa se arată numai când chiar s-a copiat.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('fără Clipboard API')
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.opacity = '0'
    // Focusul de dinainte (editorul) se întoarce după copiere.
    const prev = document.activeElement as HTMLElement | null
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    document.body.removeChild(ta)
    prev?.focus?.({ preventScroll: true })
    return ok
  }
}
