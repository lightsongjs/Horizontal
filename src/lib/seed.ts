// Tiny example used ONLY for credential-free local dev (the localStorage
// fallback). It never touches Supabase — the real app starts empty. Kept
// minimal on purpose so it doubles as a smoke-test fixture.

import type { Issue, Project, Wave } from './types'

export const SEED_PROJECTS: Project[] = [
  {
    id: 'demo',
    name: 'Exemplu',
    description: 'Proiect demo pentru dezvoltare locală',
    prefix: 'EX',
    currentWave: 1,
    accent: '#6e7bff',
  },
]

export const SEED_WAVES: Wave[] = [
  { projectId: 'demo', number: 1, name: 'Val 1', label: 'MVP', position: 0 },
  { projectId: 'demo', number: 2, name: 'Val 2', label: 'Next', position: 1 },
]

export const SEED_ISSUES: Issue[] = [
  { id: 'EX-01', projectId: 'demo', title: 'Adresă email proiect', desc: '', wave: 1, deps: [], done: true },
  { id: 'EX-02', projectId: 'demo', title: 'Cont bază de date', desc: '', wave: 1, deps: ['EX-01'], done: false },
  { id: 'EX-03', projectId: 'demo', title: 'Cont server mail', desc: '', wave: 1, deps: ['EX-01'], done: false },
  { id: 'EX-04', projectId: 'demo', title: 'Pagina de înregistrare', desc: '', wave: 1, deps: ['EX-02', 'EX-03'], done: false },
  { id: 'EX-05', projectId: 'demo', title: 'Administrare utilizatori', desc: '', wave: 2, deps: ['EX-04'], done: false },
]
