// Sunetul mementoului, când aplicația e în față.
//
// GENERAT, nu un fișier audio. Un mp3 de jumătate de secundă ar fi intrat în
// manifestul de precache al service worker-ului — adică în contractul acoperit
// de `npm run test:upgrade` — pentru douăzeci de linii de sinusoide. Și un
// asset se poate încărca pe jumătate; oscilatorul nu.
//
// Web Audio și nu `new Audio(dataUri)`: al doilea nu poate desena o anvelopă,
// iar un sunet care începe brusc e exact ce înseamnă „strident". Atacul de 12ms
// și stingerea exponențială sunt toată diferența dintre un clopoțel și un bip.

/** Vârful amplitudinii. Sub 0.15, altfel devine notificare de bancă. */
const PEAK = 0.11

/**
 * O singură notă, E5. Ales dintre patru variante ascultate una după alta
 * (două note urcând, două coborând, una singură): un interval de două note
 * spune ceva — „atenție", „cineva te cheamă" — iar un memento care sună de mai
 * multe ori pe zi n-are nevoie să spună nimic. Trebuie doar să se audă.
 *
 * Structura rămâne o listă fiindcă restul codului n-are de ce să știe câte note
 * sunt; o a doua se adaugă aici, fără să se atingă `playChime`.
 */
const NOTES: { freq: number; delay: number }[] = [
  { freq: 659.25, delay: 0 },
]

/** Cât ține nota. Stingere lungă: partea care se aude ca „frumos", nu ca „bip". */
const DECAY = 0.55

/**
 * Al doilea armonic, foarte discret. Îi dă corp de clopoțel; peste ~0.25 începe
 * să sune metalic.
 */
const PARTIALS: { mult: number; level: number }[] = [
  { mult: 1, level: 1 },
  { mult: 2, level: 0.15 },
]

type Ctor = new () => AudioContext

function ctor(): Ctor | null {
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/**
 * Un singur context, refolosit. Browserele limitează numărul de contexte audio,
 * iar unul per notificare le-ar epuiza într-o zi de lucru.
 */
let ctx: AudioContext | null = null
let broken = false

function context(): AudioContext | null {
  if (ctx || broken) return ctx
  const C = ctor()
  if (!C) { broken = true; return null }
  try {
    ctx = new C()
  } catch {
    // Fără audio se poate trăi: notificarea se vede oricum. Nu mai încercăm.
    broken = true
  }
  return ctx
}

/**
 * Deblochează contextul audio.
 *
 * TREBUIE chemată din gestul utilizatorului. Politica de autoplay pornește
 * fiecare `AudioContext` în starea `suspended`, iar un `resume()` cerut din
 * mesajul unui service worker — adică fără gest — e refuzat în silență. De asta
 * sunetul se pregătește la prima atingere a paginii, nu la prima notificare:
 * când vine mementoul, e prea târziu să ceri permisiunea.
 */
export function unlockChime(): void {
  const c = context()
  if (c && c.state === 'suspended') void c.resume()
}

/** Cântă clopoțelul. Nu aruncă niciodată — un memento mut e mai bun decât o eroare. */
export function playChime(): void {
  const c = context()
  if (!c || c.state !== 'running') return
  try {
    // Un filtru trece-jos peste tot: taie orice ascuțime rămasă din armonic.
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2400
    // Explicit 0.707 (Butterworth). Implicitul Web Audio e 1, care ridică un
    // mic vârf chiar în jurul frecvenței de tăiere — exact accentul pe care
    // încercăm să-l scoatem.
    lp.Q.value = 0.707
    lp.connect(c.destination)

    const t0 = c.currentTime + 0.01
    for (const note of NOTES) {
      for (const p of PARTIALS) {
        const osc = c.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = note.freq * p.mult

        const g = c.createGain()
        const start = t0 + note.delay
        g.gain.setValueAtTime(0, start)
        g.gain.linearRampToValueAtTime(PEAK * p.level, start + 0.012)
        // Exponențial, nu liniar: urechea aude intensitatea logaritmic, iar o
        // stingere liniară se aude ca o tăietură la final.
        g.gain.exponentialRampToValueAtTime(0.0001, start + DECAY)

        osc.connect(g)
        g.connect(lp)
        osc.start(start)
        osc.stop(start + DECAY + 0.03)
      }
    }
  } catch {
    // idem
  }
}
