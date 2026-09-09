// Accentul unui layer, indexat după poziția lui în vederea ordonată (nu după
// adâncime). Împărtășit de board (Cards) și de vederea Listă, ca amândouă să
// coloreze capetele de layer identic.
//
// Nu întoarce hex-uri, ci `var(--layer-N)`: rampa e definită o dată per temă în
// `src/styles.css`, fiindcă o culoare care se citește pe #0B0B0E nu se citește
// pe #F7F9FC. Aici rămâne doar lungimea ciclului.
//
// Rampa e SECVENȚIALĂ (indigo → verdigris), nu un set de culori categorice:
// adâncimea dependențelor e o secvență, iar desenul o spune.
const LAYER_RAMP_LENGTH = 5

/** `var(--layer-N)` pentru al i-lea layer din vedere; ciclează. */
export function layerVar(i: number): string {
  return `var(--layer-${((i % LAYER_RAMP_LENGTH) + LAYER_RAMP_LENGTH) % LAYER_RAMP_LENGTH})`
}
