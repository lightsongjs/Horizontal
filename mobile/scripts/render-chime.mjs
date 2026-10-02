// Clopoțelul Horizontal ca WAV, pentru canalul de notificări Android. Aceeași
// sinteză ca `playChime` din `src/lib/chime.ts`: E5, al doilea armonic la 0.15,
// atac LINIAR de 12 ms, apoi `exponentialRampToValueAtTime(0.0001, start + DECAY)`
// — adică o exponențială care coboară de la 1 la 1e-4 exact în DECAY, nu o
// constantă de timp — iar oscilatorul se oprește la DECAY + 30 ms. Filtrul
// trece-jos de 2400 Hz din pagină lipsește: ambele parțiale (659 și 1318 Hz)
// sunt sub tăiere, deci aici n-ar schimba nimic audibil.
// PEAK e mai mare decât în pagină (0.11): acolo sunetul se suprapune peste
// nimic, aici volumul îl dă canalul de notificări. Nivelurile se normalizează
// la suma lor, ca vârful să fie PEAK și nu PEAK * 1.15 (fără clipping).
// Folosire: node mobile/scripts/render-chime.mjs > mobile/android/app/src/main/res/raw/chime.wav
const RATE = 44100, PEAK = 0.6, DECAY = 0.55, ATTACK = 0.012, FLOOR = 0.0001
const DUR = DECAY + 0.03
const NOTES = [{ freq: 659.25, delay: 0 }]
const PARTIALS = [{ mult: 1, level: 1 }, { mult: 2, level: 0.15 }]
const n = Math.round(RATE * DUR)
const pcm = new Int16Array(n)
const norm = PARTIALS.reduce((s, p) => s + p.level, 0)
// Anvelopa Web Audio: 0 → 1 liniar în ATTACK, apoi 1 → FLOOR exponențial până la DECAY.
function env(tt) {
  if (tt < ATTACK) return tt / ATTACK
  if (tt < DECAY) return Math.pow(FLOOR, (tt - ATTACK) / (DECAY - ATTACK))
  return FLOOR
}
for (let i = 0; i < n; i++) {
  const t = i / RATE
  let v = 0
  for (const note of NOTES) {
    const tt = t - note.delay
    if (tt < 0) continue
    const e = env(tt)
    for (const p of PARTIALS) v += (p.level / norm) * e * Math.sin(2 * Math.PI * note.freq * p.mult * tt)
  }
  pcm[i] = Math.max(-1, Math.min(1, v * PEAK)) * 32767
}
const data = Buffer.from(pcm.buffer)
const h = Buffer.alloc(44)
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
h.write('data', 36); h.writeUInt32LE(data.length, 40)
process.stdout.write(Buffer.concat([h, data]))
