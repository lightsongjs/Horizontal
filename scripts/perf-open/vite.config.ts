// `npm run perf:open` (scripts/perf-open/measure.mjs) — config de măsurare: aplicația reală (build de producție) pe backendul local,
// învelit în stratul offline (IndexedDB) ca pe Supabase, cu latență injectată.
import base from '../../vite.config'
import type { Plugin } from 'vite'

const latency: Plugin = {
  name: 'perf-latency',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/data/index.ts')) return
    return code.replace(
      'return createLocalRepository()',
      `return createOfflineRepository(__withLatency(createLocalRepository()), typeof indexedDB === 'undefined' ? Promise.resolve(null) : openKv().catch(() => null), {
        userId: () => 'local', channel: createBroadcastSyncChannel(), lock: webLock('horizontal-outbox') ?? undefined, canFlush: () => true,
      })`,
    ) + `
function __withLatency(r) {
  const net = (globalThis.__NET ??= { log: [] })
  const out = {}
  for (const k of Object.keys(r)) {
    const v = r[k]
    if (typeof v !== 'function') { out[k] = v; continue }
    out[k] = async (...args) => {
      const t0 = performance.now()
      const res = await v.apply(r, args)
      const p = globalThis.__LAT
      if (p) {
        let bytes = 0
        try { bytes = JSON.stringify(res ?? '').length } catch {}
        const steps = k === 'listObstacleLinks' ? 2 : 1
        const ms = p.rtt * steps + bytes / p.bytesPerMs
        await new Promise((ok) => setTimeout(ok, ms))
      }
      net.log.push({ k, arg: typeof args[0] === 'string' ? args[0] : '', t0, t1: performance.now() })
      return res
    }
  }
  return out
}
`
  },
}

export default (env) => {
  const cfg = typeof base === 'function' ? base(env) : base
  return { ...cfg, plugins: [latency, ...cfg.plugins], build: { ...(cfg.build ?? {}), outDir: process.env.PERF_OUT, emptyOutDir: true } }
}
