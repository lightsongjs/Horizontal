import { describe, it, expect } from 'vitest'
import taskRowSrc from './TaskRow.tsx?raw'

// Fără jsdom în acest repo (vezi CLAUDE.md — testele pe componente merg pe
// funcțiile pure exportate, nu pe randare), deci nu putem monta `TaskRow` și
// `DueChip` și compara arborele DOM direct. Testul de mai jos „prinde" totuși
// exact regresia care a scăpat o dată: importă sursa ca text (`?raw`, tipat de
// `vite/client`, nu de un pachet nou) și verifică că cele două moduri — modul
// proiecte (`DueChip`) și listele inteligente (`TaskRow`) — desenează
// „se repetă" din același loc, `Recur`, nu dintr-o reimplementare proprie a
// predicatului. Dacă cineva adaugă un al treilea mod de afișare care
// recalculează `describeRrule` pe cont propriu în loc să randeze `<Recur>`,
// testul ăsta pică și pentru el.
describe('TaskRow — „se repetă" vine din același loc ca „are memento"', () => {
  it('importă Recur din DueChip, alături de Bell', () => {
    expect(taskRowSrc).toMatch(
      /import\s*\{[^}]*\bBell\b[^}]*\bRecur\b[^}]*\}\s*from '\.\/DueChip'|import\s*\{[^}]*\bRecur\b[^}]*\bBell\b[^}]*\}\s*from '\.\/DueChip'/,
    )
  })

  it('randează <Recur rrule={issue.rrule} /> — nu recalculează predicatul local', () => {
    expect(taskRowSrc).toMatch(/<Recur\s+rrule=\{issue\.rrule\}/)
    // Dacă apare `describeRrule` aici, înseamnă că cineva a scris o a doua
    // cale spre același răspuns — exact divergența pe care `Recur` o previne.
    expect(taskRowSrc).not.toContain('describeRrule')
  })
})
