// Seed data ported verbatim from data-model.json. Used for local dev and as
// the source for seeding Supabase. Keep in sync with data-model.json.

import type { Issue, Project, Theme, Wave } from './types'

export const SEED_THEMES: Theme[] = [
  { key: 'auth', name: 'Auth', color: '#6e7bff' },
  { key: 'email', name: 'Email', color: '#ffb454' },
  { key: 'db', name: 'Supabase / DB', color: '#3ecf8e' },
  { key: 'users', name: 'Utilizatori', color: '#a06eff' },
  { key: 'expense', name: 'Expense', color: '#ff6b6b' },
]

export const SEED_WAVES: Wave[] = [
  { number: 1, name: 'Val 1', label: 'MVP' },
  { number: 2, name: 'Val 2', label: 'Dashboard & users' },
  { number: 3, name: 'Val 3', label: 'Polish' },
]

export const SEED_PROJECTS: Project[] = [
  {
    id: 'tur',
    name: 'Aplicație Turism',
    description: 'Expense tracker + bilete + auth pentru călătorii',
    prefix: 'TUR',
    currentWave: 1,
    accent: '#6e7bff',
  },
]

export const SEED_ISSUES: Issue[] = [
  {
    id: 'TUR-01',
    projectId: 'tur',
    title: 'Adresă email nouă pentru proiect',
    desc: 'Punctul zero. Tot lanțul de auth depinde de el.',
    type: 'external',
    theme: 'email',
    wave: 1,
    deps: [],
    done: true,
  },
  {
    id: 'TUR-02',
    projectId: 'tur',
    title: 'Cont Supabase (DB + Auth)',
    desc: 'Bază de date + Auth. Aici trăiesc utilizatorii.',
    type: 'external',
    theme: 'db',
    wave: 1,
    deps: ['TUR-01'],
    done: false,
  },
  {
    id: 'TUR-03',
    projectId: 'tur',
    title: 'Cont Mailjet (trimitere email)',
    desc: 'Serviciul care trimite efectiv email-urile.',
    type: 'external',
    theme: 'email',
    wave: 1,
    deps: ['TUR-01'],
    done: false,
  },
  {
    id: 'TUR-04',
    projectId: 'tur',
    title: 'Webhook Supabase → Mailjet (verificare)',
    desc: 'La înregistrare, trimite email de verificare.',
    type: 'task',
    theme: 'email',
    wave: 1,
    deps: ['TUR-02', 'TUR-03'],
    done: false,
  },
  {
    id: 'TUR-05',
    projectId: 'tur',
    title: 'Deploy pe Cloudflare + domeniu',
    desc: 'Aplicația online, pe domeniul tău.',
    type: 'task',
    theme: 'db',
    wave: 1,
    deps: ['TUR-02'],
    done: false,
  },
  {
    id: 'TUR-06',
    projectId: 'tur',
    title: 'Pagină SignUp / Înregistrare',
    desc: 'Înregistrare cont nou. Epic cu sub-tichete.',
    type: 'epic',
    theme: 'auth',
    wave: 1,
    deps: ['TUR-04'],
    done: false,
    children: [
      { id: 'TUR-06.06a', title: 'Form: email + date profil' },
      { id: 'TUR-06.06b', title: 'Parolă cu reguli (validare)' },
      { id: 'TUR-06.06c', title: 'Trigger email verificare' },
      { id: 'TUR-06.06d', title: 'Ecran confirmare + redirect' },
    ],
  },
  {
    id: 'TUR-API',
    projectId: 'tur',
    title: 'API creare user (Supabase fn)',
    desc: 'Endpoint care creează utilizatori din panoul de admin.',
    type: 'task',
    theme: 'db',
    wave: 2,
    deps: ['TUR-02'],
    done: false,
  },
  {
    id: 'TUR-07',
    projectId: 'tur',
    title: 'Setări → Management utilizatori',
    desc: 'Tichetul părinte e gata doar când toate sub-tichetele sunt gata.',
    type: 'epic',
    theme: 'users',
    wave: 2,
    deps: ['TUR-06', 'TUR-API'],
    done: false,
    children: [
      { id: 'TUR-07.07a', title: 'Adaugă utilizator' },
      { id: 'TUR-07.07b', title: 'Șterge utilizator' },
      { id: 'TUR-07.07c', title: 'Resetează parola' },
      { id: 'TUR-07.07d', title: 'Trimite invite' },
    ],
  },
  {
    id: 'TUR-08',
    projectId: 'tur',
    title: 'Expense Tracker',
    desc: 'Inima aplicației de turism.',
    type: 'epic',
    theme: 'expense',
    wave: 1,
    deps: ['TUR-06'],
    done: false,
    children: [
      { id: 'TUR-08.08a', title: 'Adaugă cheltuială (ex: 200 cor.)' },
      { id: 'TUR-08.08b', title: 'Split datorii (sora: 40 cor.)' },
      { id: 'TUR-08.08c', title: 'Atașează bilete / chitanțe' },
    ],
  },
]
