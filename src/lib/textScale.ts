/**
 * Mărimea textului din rotița de setări — pentru cine nu vede de aproape.
 *
 * Trepte fixe, nu un glisor: o treaptă se poate numi („Mare"), iar un om care
 * n-a nimerit-o o dată o găsește a doua oară. Se ține pe DISPOZITIV, ca tema:
 * mărimea potrivită depinde de ecran, nu de cont.
 */
export const TEXT_SCALES = [
  { value: 1, label: 'Normal' },
  { value: 1.15, label: 'Mare' },
  { value: 1.3, label: 'Foarte mare' },
  { value: 1.5, label: 'Maxim' },
] as const

export type TextScale = (typeof TEXT_SCALES)[number]['value']

export const TEXT_SCALE_KEY = 'horizontal-text-scale'

/** O valoare citită din `localStorage`; orice nu e o treaptă cunoscută → 1. */
export function parseTextScale(raw: string | null): TextScale {
  const n = Number(raw)
  return TEXT_SCALES.find((s) => s.value === n)?.value ?? 1
}
