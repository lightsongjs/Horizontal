-- Seed data for DepFlow (the "Aplicație Turism" example). Run after schema.sql.
-- Idempotent: re-running upserts the same rows.

insert into themes (key, name, color) values
  ('auth',    'Auth',          '#6e7bff'),
  ('email',   'Email',         '#ffb454'),
  ('db',      'Supabase / DB', '#3ecf8e'),
  ('users',   'Utilizatori',   '#a06eff'),
  ('expense', 'Expense',       '#ff6b6b')
on conflict (key) do update set name = excluded.name, color = excluded.color;

insert into waves (number, name, label) values
  (1, 'Val 1', 'MVP'),
  (2, 'Val 2', 'Dashboard & users'),
  (3, 'Val 3', 'Polish')
on conflict (number) do update set name = excluded.name, label = excluded.label;

insert into projects (id, name, description, prefix, current_wave, accent) values
  ('tur', 'Aplicație Turism', 'Expense tracker + bilete + auth pentru călătorii', 'TUR', 1, '#6e7bff')
on conflict (id) do update set
  name = excluded.name, description = excluded.description,
  prefix = excluded.prefix, current_wave = excluded.current_wave, accent = excluded.accent;

insert into issues (id, project_id, title, "desc", type, theme, wave, done, children) values
  ('TUR-01', 'tur', 'Adresă email nouă pentru proiect', 'Punctul zero. Tot lanțul de auth depinde de el.', 'external', 'email', 1, true, '[]'),
  ('TUR-02', 'tur', 'Cont Supabase (DB + Auth)', 'Bază de date + Auth. Aici trăiesc utilizatorii.', 'external', 'db', 1, false, '[]'),
  ('TUR-03', 'tur', 'Cont Mailjet (trimitere email)', 'Serviciul care trimite efectiv email-urile.', 'external', 'email', 1, false, '[]'),
  ('TUR-04', 'tur', 'Webhook Supabase → Mailjet (verificare)', 'La înregistrare, trimite email de verificare.', 'task', 'email', 1, false, '[]'),
  ('TUR-05', 'tur', 'Deploy pe Cloudflare + domeniu', 'Aplicația online, pe domeniul tău.', 'task', 'db', 1, false, '[]'),
  ('TUR-06', 'tur', 'Pagină SignUp / Înregistrare', 'Înregistrare cont nou. Epic cu sub-tichete.', 'epic', 'auth', 1, false,
    '[{"id":"TUR-06.06a","title":"Form: email + date profil"},{"id":"TUR-06.06b","title":"Parolă cu reguli (validare)"},{"id":"TUR-06.06c","title":"Trigger email verificare"},{"id":"TUR-06.06d","title":"Ecran confirmare + redirect"}]'),
  ('TUR-API', 'tur', 'API creare user (Supabase fn)', 'Endpoint care creează utilizatori din panoul de admin.', 'task', 'db', 2, false, '[]'),
  ('TUR-07', 'tur', 'Setări → Management utilizatori', 'Tichetul părinte e gata doar când toate sub-tichetele sunt gata.', 'epic', 'users', 2, false,
    '[{"id":"TUR-07.07a","title":"Adaugă utilizator"},{"id":"TUR-07.07b","title":"Șterge utilizator"},{"id":"TUR-07.07c","title":"Resetează parola"},{"id":"TUR-07.07d","title":"Trimite invite"}]'),
  ('TUR-08', 'tur', 'Expense Tracker', 'Inima aplicației de turism.', 'epic', 'expense', 1, false,
    '[{"id":"TUR-08.08a","title":"Adaugă cheltuială (ex: 200 cor.)"},{"id":"TUR-08.08b","title":"Split datorii (sora: 40 cor.)"},{"id":"TUR-08.08c","title":"Atașează bilete / chitanțe"}]')
on conflict (id) do update set
  title = excluded.title, "desc" = excluded."desc", type = excluded.type,
  theme = excluded.theme, wave = excluded.wave, done = excluded.done, children = excluded.children;

insert into dependencies (issue_id, depends_on_id) values
  ('TUR-02', 'TUR-01'),
  ('TUR-03', 'TUR-01'),
  ('TUR-04', 'TUR-02'),
  ('TUR-04', 'TUR-03'),
  ('TUR-05', 'TUR-02'),
  ('TUR-06', 'TUR-04'),
  ('TUR-API', 'TUR-02'),
  ('TUR-07', 'TUR-06'),
  ('TUR-07', 'TUR-API'),
  ('TUR-08', 'TUR-06')
on conflict do nothing;
