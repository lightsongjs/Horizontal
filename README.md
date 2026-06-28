# DepFlow

Mobile-first project-planning tool for developers. Manages projects → issues →
dependencies, computes build order automatically (**layers**), and organizes
delivery into **waves** (sprints).

- **Layer** — computed, read-only: the topological depth of an issue ("what can
  I start now"). Recomputed per wave, using only that wave's issues.
- **Wave** — a manual delivery sprint ("what am I shipping now").

An issue's detail sheet shows **all** its dependencies across **all** waves,
each tagged by wave; cross-wave deps are visible but never block the
wave-filtered Ordine view.

See `REQUIREMENTS.md` for the full spec and `data-model.json` for the data
shapes and the layer/wave algorithm.

## Stack

React + Vite + TypeScript. Supabase (Postgres) for persistence, with a seeded
localStorage fallback for credential-free local dev. Pure engine in
`src/lib/engine.ts`, unit-tested against the fixtures in `data-model.json`.

## Run locally

```bash
npm install
cp .env.example .env      # then fill in the values below
npm run dev               # http://localhost:5173
```

### Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/schema.sql`, then `supabase/seed.sql`.
3. In `.env` (Project Settings → API):
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
   VITE_DATA_SOURCE=supabase
   ```

Leave `VITE_DATA_SOURCE=local` (or unset) to run against seed data in
localStorage — no credentials needed.

> The RLS policies in `schema.sql` are permissive (anon full access) for the
> single-tenant demo. Tighten them before any real multi-user deployment.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check + production build |
| `npm run test` | Run the engine unit tests |
| `npm run typecheck` | Type-check only |
