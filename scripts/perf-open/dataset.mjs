// Date sintetice cu mărimile din producție (MS 241 tichete / 725 KB, D 178, KATA 117).
const today = new Date(); today.setHours(0, 0, 0, 0)
const iso = (d) => d.toISOString()
const para = (n) => Array.from({ length: n }, (_, i) => `Rândul ${i} cu ceva text despre sarcină, ca o descriere reală — [link](https://example.com/${i}) și **bold**.`).join('\n')
const descOf = (k) => `## Context\n${para(6)}\n\n- [ ] pas unu ${k}\n- [x] pas doi\n- [ ] pas trei\n\n\`\`\`js\nconst x = ${k}\nconsole.log(x)\n\`\`\`\n\n${para(10)}`
const projects = [
  { id: 'd', name: 'Inbox', description: '', prefix: 'D', currentWave: 1, accent: '#64748B', type: 'personal' },
  { id: 'ms', name: 'Mate cu Sens', description: '', prefix: 'MS', currentWave: 1, accent: '#0EA5E9', type: 'personal' },
  { id: 'kata', name: 'Katalist', description: '', prefix: 'KATA', currentWave: 1, accent: '#F97316', type: 'work' },
  { id: 'routin', name: 'Rutine', description: '', prefix: 'ROUTIN', currentWave: 1, accent: '#22C55E', type: 'personal' },
]
const sizes = { d: 178, ms: 241, kata: 117, routin: 12 }
const waves = [], themes = [], issues = [], events = []
for (const p of projects) {
  for (let w = 1; w <= 4; w++) waves.push({ projectId: p.id, number: w, name: `Val ${w}`, label: '', position: w - 1 })
  themes.push({ projectId: p.id, key: 'gen', name: 'General', color: '#6e7bff' })
  for (let n = 1; n <= sizes[p.id]; n++) {
    const id = `${p.prefix}-${String(n).padStart(2, '0')}`
    // Primele 6 din fiecare proiect: scadente azi (lista „Azi"), la ore diferite.
    const due = n <= 6 ? new Date(today.getTime() + (9 + n) * 3600e3) : null
    issues.push({
      id, projectId: p.id, title: `${p.name} — sarcina ${n}`, desc: descOf(n) + "\n" + para(5), theme: 'gen', wave: 1 + (n % 4),
      deps: n > 3 && n % 5 === 0 ? [`${p.prefix}-${String(n - 3).padStart(2, '0')}`] : [], done: n > 6 && n % 3 === 0,
      selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-10-01T08:00:00.000Z', urgent: false,
      dueAt: due ? iso(due) : null, allDay: !due, remindAt: null, rrule: null, pingEvery: null, pinnedAt: null,
    })
    if (n <= 6) for (let c = 0; c < 3; c++) events.push({ id: `${id}-e${c}`, issueId: id, projectId: p.id, handoffFrom: null, handoffTo: null, editedAt: null, kind: 'comment', body: `Comentariul ${c} la ${id}`, authorId: null, createdAt: '2026-11-01T10:00:00.000Z' })
  }
}
export const DB = { projects, waves, themes, issues, assignees: [], obstacles: [], obstacleLinks: [], events, seen: {}, pins: [], filters: [], trash: [] }
