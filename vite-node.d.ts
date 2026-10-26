// Cele două bucăți de Node pe care le folosește vite.config.ts (commitul
// buildului), declarate aici în loc de `@types/node`: proiectul nu-l are, iar
// pentru două linii nu merită o dependență nouă.
declare module 'node:child_process' {
  export function execSync(command: string, options?: { stdio?: unknown }): { toString(): string }
}
declare const process: { env: Record<string, string | undefined> }
