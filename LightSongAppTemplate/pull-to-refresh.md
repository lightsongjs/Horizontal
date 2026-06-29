# Pull-to-Refresh cu Touch Events

## Ce face

Utilizatorul poate trage în jos cu degetul (din vârful listei) pentru a declanșa un refresh al datelor. Apare un indicator vizual care arată cât de mult a tras, iar când depășește pragul, refresh-ul se execută automat la eliberare.

## De ce a fost complicat

Browserele mobile tratează `touchmove` ca **passive** by default — adică nu poți apela `preventDefault()` pe el. Fără `preventDefault()`, browserul face scroll normal în loc să permită gestul de pull. Soluția: trebuie să înregistrezi listeneri manual cu `{ passive: false }` pe elementul `<main>`.

**Nu merge cu `onTouchMove` din JSX** — React înregistrează event listeneri globali ca passive. Trebuie `addEventListener` direct pe DOM element.

## Implementare

### State & refs

```tsx
const mainRef = useRef<HTMLElement>(null)
const [pullY, setPullY] = useState(0)       // pentru animația vizuală
const pullStart = useRef<number | null>(null) // Y la touchstart
const pullYRef = useRef(0)                   // valoarea curentă (fără re-render)
const THRESHOLD = 72                         // px până se declanșează refresh
```

`pullYRef` există în paralel cu `pullY` (state) pentru că `onEnd` are nevoie de valoarea curentă fără să fie într-un closure vechi.

### Event listeners în useEffect

```tsx
useEffect(() => {
  const el = mainRef.current
  if (!el) return

  const onStart = (e: TouchEvent) => {
    // Pornim gestul doar dacă suntem la top (scrollTop === 0)
    if (el.scrollTop === 0) pullStart.current = e.touches[0].clientY
  }

  const onMove = (e: TouchEvent) => {
    if (pullStart.current === null) return
    const dy = e.touches[0].clientY - pullStart.current
    if (dy > 0) {
      e.preventDefault()  // blochează scroll-ul nativ
      pullYRef.current = Math.min(dy, THRESHOLD * 1.5)  // cap la 108px
      setPullY(pullYRef.current)
    }
  }

  const onEnd = async () => {
    if (pullYRef.current >= THRESHOLD) await refresh()
    pullStart.current = null
    pullYRef.current = 0
    setPullY(0)
  }

  // touchstart și touchend pot fi passive — nu apelăm preventDefault pe ele
  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchmove', onMove, { passive: false })  // ← cheia
  el.addEventListener('touchend', onEnd, { passive: true })

  return () => {
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
  }
}, [refresh])
```

### Feedback vizual

```tsx
{pullY > 0 && (
  <div style={{ textAlign: 'center', padding: '8px', opacity: pullY / THRESHOLD, fontSize: '13px' }}>
    {pullY >= THRESHOLD ? '↑ Eliberează' : '↓ Trage pentru refresh'}
  </div>
)}
```

Opacitatea crește proporțional cu `pullY / THRESHOLD` — apare treptat pe măsură ce tragi.

## Fișiere relevante

- `src/App.tsx` — liniile 108–142 (logica) și ~205–209 (UI feedback)

## Rezumat pattern

1. `ref` pe elementul scrollabil
2. `addEventListener` manual cu `{ passive: false }` pe `touchmove`
3. `preventDefault()` doar când `dy > 0` (tragi în jos, nu în sus)
4. Ref separat pentru valoarea curentă (evită closure stale în `onEnd`)
5. Feedback vizual bazat pe `pullY` state
