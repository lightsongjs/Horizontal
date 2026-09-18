// Etichetele scurte de pe carduri. Pure, ca engine.ts — fără DOM, fără store.

/** Câte litere are voie o pastilă înainte să nu mai fie o pastilă. */
const MAX = 3

/** Fără spații, majuscule: „Ana Popescu" → „ANAPOPESCU". Diacriticele rămân. */
const compact = (name: string) => name.replace(/\s+/g, '').toLocaleUpperCase('ro-RO')

/**
 * Cea mai scurtă etichetă care distinge fiecare nume de CEILALȚI din listă.
 *
 * Miron și Mihai se ciocnesc pe „M", deci primesc amândoi trei litere (MIR,
 * MIH) — dar Ana și Bogdan de lângă ei rămân cu una. Creșterea e per nume, nu
 * pe toată lista: altfel un singur omonim ar lăți toate pastilele din proiect.
 *
 * Peste trei litere nu se trece: „MIHAI" și „MIHAITA" rămân amândoi „MIH".
 * O pastilă de cinci litere nu mai e o iconiță, iar numele întreg oricum stă
 * în `title` și în foaia tichetului — ambiguitatea are unde să se rezolve.
 */
export function shortLabels(names: readonly string[]): string[] {
  const keys = names.map(compact)
  return keys.map((key, i) => {
    if (!key) return '?'
    for (let len = 1; len < MAX; len++) {
      const mine = key.slice(0, len)
      const taken = keys.some((other, j) => j !== i && other.slice(0, len) === mine)
      if (!taken) return mine
    }
    return key.slice(0, MAX)
  })
}
