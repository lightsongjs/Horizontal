// Atingeri reale pentru testele în Chromium: `Input.dispatchTouchEvent` din
// CDP, nu `page.touchscreen` — acela știe doar `tap`, iar glisarea, apăsarea
// lungă și derularea au nevoie de mișcare între apăsare și ridicare.
// Pagina trebuie deschisă cu `hasTouch: true` (și `isMobile: true`).

export async function touchApi(page) {
  const cdp = await page.context().newCDPSession(page)
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map(([x, y]) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 })),
  })
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  /** Trage de la (x0,y0) la (x1,y1), în `steps` pași. */
  async function drag(x0, y0, x1, y1, { steps = 12, holdMs = 0, stepMs = 16 } = {}) {
    await send('touchStart', [[x0, y0]])
    if (holdMs) await wait(holdMs)
    for (let i = 1; i <= steps; i++) {
      await send('touchMove', [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]])
      await wait(stepMs)
    }
    await send('touchEnd', [])
  }

  /** Apăsare ținută pe loc. */
  async function longPress(x, y, ms = 650) {
    await send('touchStart', [[x, y]])
    await wait(ms)
    await send('touchEnd', [])
  }

  async function tap(x, y) {
    await send('touchStart', [[x, y]])
    await wait(40)
    await send('touchEnd', [])
  }

  /** Centrul unui locator. */
  async function center(locator) {
    const b = await locator.boundingBox()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
  }

  return { drag, longPress, tap, center }
}
