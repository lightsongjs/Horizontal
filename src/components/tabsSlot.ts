import { createContext } from 'react'

/**
 * Locul de la capătul rândului de taburi al proiectului (`ProjectDetail`).
 * Cu un singur val nu există bandă de valuri, iar Notițele și „⋯" urcă aici —
 * printr-un portal din vizualizare, fiindcă starea lor (arbore, selecție,
 * filtrul de om) e a vizualizării, nu a rândului de taburi.
 */
export const TabsSlot = createContext<HTMLElement | null>(null)
