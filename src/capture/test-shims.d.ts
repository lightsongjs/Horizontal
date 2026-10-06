// Proiectul n-are @types/node (vezi `src/lib/engine.test.ts`). Doar cât îi
// trebuie testului pachetului: `vm` și scriptul de împachetare.
declare module 'node:vm' {
  const vm: { runInNewContext(code: string, sandbox: object): unknown }
  export default vm
}
declare module '*/scripts/build-capture-engine.mjs' {
  export function buildCaptureEngine(o?: { write?: boolean }): Promise<string>
}
