import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

/** Un `document` minim: cât folosește fallback-ul (textarea + execCommand). */
function fakeDocument(execResult: boolean | 'throws') {
  const appended: { value: string }[] = []
  const focus = vi.fn()
  const doc = {
    activeElement: { focus },
    body: {
      appendChild: (el: { value: string }) => { appended.push(el) },
      removeChild: vi.fn(),
    },
    createElement: () => ({ value: '', style: {}, setAttribute() {}, select() {}, setSelectionRange() {} }),
    execCommand: vi.fn(() => { if (execResult === 'throws') throw new Error('nu'); return execResult }),
  }
  vi.stubGlobal('document', doc)
  return { doc, appended, focus }
}

afterEach(() => vi.unstubAllGlobals())

describe('copyText', () => {
  it('Clipboard API când există', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { doc } = fakeDocument(true)
    expect(await copyText('npm test')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('npm test')
    expect(doc.execCommand).not.toHaveBeenCalled()
  })
  it('WebView fără Clipboard API sau cu refuz → textarea + execCommand, focusul se întoarce', async () => {
    for (const nav of [{}, { clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } }]) {
      vi.stubGlobal('navigator', nav)
      const { doc, appended, focus } = fakeDocument(true)
      expect(await copyText('a\nb')).toBe(true)
      expect(appended[0].value).toBe('a\nb')
      expect(doc.execCommand).toHaveBeenCalledWith('copy')
      expect(doc.body.removeChild).toHaveBeenCalled()
      expect(focus).toHaveBeenCalled()
    }
  })
  it('fallback-ul eșuat (false sau excepție) → false, fără bifă', async () => {
    vi.stubGlobal('navigator', {})
    fakeDocument(false)
    expect(await copyText('x')).toBe(false)
    fakeDocument('throws')
    expect(await copyText('x')).toBe(false)
  })
})
