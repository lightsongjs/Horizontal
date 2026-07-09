// Tiny example used ONLY for credential-free local dev (the localStorage
// fallback). It never touches Supabase — the real app starts empty. Kept
// minimal on purpose so it doubles as a smoke-test fixture.

import type { Issue, Project, Theme, Wave } from './types'

export const SEED_PROJECTS: Project[] = [
  {
    id: 'demo',
    name: 'Exemplu',
    description: 'Proiect demo pentru dezvoltare locală',
    prefix: 'EX',
    currentWave: 1,
    accent: '#0EA5E9',
    type: 'personal',
  },
]

export const SEED_WAVES: Wave[] = [
  { projectId: 'demo', number: 1, name: 'Val 1', label: 'MVP', position: 0 },
  { projectId: 'demo', number: 2, name: 'Val 2', label: 'Next', position: 1 },
]

export const SEED_THEMES: Theme[] = [
  { projectId: 'demo', key: 'auth', name: 'Auth', color: '#6e7bff' },
  { projectId: 'demo', key: 'email', name: 'Email', color: '#ffb454' },
  { projectId: 'demo', key: 'db', name: 'DB', color: '#3ecf8e' },
]

export const SEED_ISSUES: Issue[] = [
  { id: 'EX-01', projectId: 'demo', title: 'Adresă email proiect', desc: '', theme: 'email', wave: 1, deps: [], done: true, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false },
  { id: 'EX-02', projectId: 'demo', title: 'Cont bază de date', desc: '', theme: 'db', wave: 1, deps: ['EX-01'], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false },
  { id: 'EX-03', projectId: 'demo', title: 'Cont server mail', desc: '', theme: 'email', wave: 1, deps: ['EX-01'], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false },
  { id: 'EX-04', projectId: 'demo', title: 'Pagina de înregistrare', desc: '', theme: 'auth', wave: 1, deps: ['EX-02', 'EX-03'], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: true },
  { id: 'EX-05', projectId: 'demo', title: 'Administrare utilizatori', desc: '', theme: 'auth', wave: 2, deps: ['EX-04'], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false },
]
