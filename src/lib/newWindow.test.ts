import { afterEach, describe, expect, it, vi } from 'vitest'
import { newWindowOpener } from './newWindow'

const g = globalThis as Record<string, unknown>
afterEach(() => { delete g.window; delete g.location })

describe('newWindowOpener', () => {
  it('cutia de Linux: prin punte, nu prin window.open', () => {
    const newWindow = vi.fn(), open = vi.fn()
    g.window = { horizontalDesktop: { newWindow }, open }
    newWindowOpener()!()
    expect(newWindow).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
  })
  it('cutie veche, fără metodă: fără buton', () => {
    g.window = { horizontalDesktop: {} }
    expect(newWindowOpener()).toBeNull()
  })
  it('APK: fără buton', () => {
    g.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} } }
    expect(newWindowOpener()).toBeNull()
  })
  it('browser: popup pe adresa de acum', () => {
    const open = vi.fn()
    g.window = { open }
    g.location = { href: 'https://horizontal-dyx.pages.dev/H-16' }
    newWindowOpener()!()
    expect(open).toHaveBeenCalledWith('https://horizontal-dyx.pages.dev/H-16', '_blank', 'popup,width=1200,height=850')
  })
})
