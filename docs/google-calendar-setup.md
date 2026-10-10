# Google Calendar — pașii pe care îi faci tu (o singură dată)

Restul e deja făcut: tabelele, funcțiile `google-oauth` și `calendar-sync`,
cronul de 15 minute, mementourile, interfața. Până nu termini pașii de mai jos,
**Setări → Integrări** spune „Google Calendar nu e configurat încă pe server".

Durează ~10 minute. Ai nevoie de contul Google personal (proiectul GCP trebuie
să fie al tău, nu al firmei — vezi pasul 2).

---

## 1. Proiectul Google Cloud

1. Deschide <https://console.cloud.google.com/projectcreate>
2. **Project name:** `Horizontal` · **Location:** *No organization* → **Create**.
3. Sus, în selectorul de proiect, asigură-te că e ales `Horizontal`.

## 2. Activează Google Calendar API

1. <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>
2. **Enable**.

## 3. Ecranul de consimțământ (Google Auth Platform)

1. <https://console.cloud.google.com/auth/overview> → **Get started**.
2. **App information:** App name `Horizontal`, User support email = emailul tău → **Next**.
3. **Audience:** **External** → **Next**.
   *Internal* nu merge: ar accepta doar conturile din organizația proiectului,
   iar tu vrei și contul de serviciu, și pe cel personal.
4. **Contact information:** emailul tău → **Next** → bifează acordul → **Create**.
5. <https://console.cloud.google.com/auth/scopes> (**Data Access**) →
   **Add or remove scopes** → bifează:
   - `.../auth/userinfo.email`
   - `openid`
   - `.../auth/calendar.readonly` (caută „calendar.readonly" în filtru)

   → **Update** → **Save**.
6. <https://console.cloud.google.com/auth/audience> (**Audience**) →
   **Publish app** → **Confirm**. Starea devine **In production**.

   De ce contează: în *Testing*, Google omoară refresh token-ul după **7 zile**,
   iar calendarul ar cere reconectare în fiecare săptămână. *In production*
   fără verificare înseamnă doar că la conectare apare „Google hasn't verified
   this app" — apeși **Advanced → Go to Horizontal (unsafe)**. E aplicația ta,
   pentru cel mult 100 de conturi; verificarea Google nu e necesară.

## 4. Clientul OAuth

1. <https://console.cloud.google.com/auth/clients> → **Create client**.
2. **Application type:** *Web application* · **Name:** `Horizontal`.
3. **Authorized JavaScript origins:** lasă gol.
4. **Authorized redirect URIs** → **Add URI**, exact (fără `/` la final):

   ```
   https://jqhinigcprwsvirhmtsv.supabase.co/functions/v1/google-oauth
   ```

5. **Create**. Copiază **Client ID** și **Client secret** din fereastra care apare
   (secretul nu se mai arată întreg după ce o închizi — dacă l-ai pierdut,
   **Add secret** pe client și folosește-l pe cel nou).

## 5. Secretele în Supabase

Din directorul proiectului:

```bash
supabase secrets set --project-ref jqhinigcprwsvirhmtsv \
  GOOGLE_CLIENT_ID='<Client ID>' \
  GOOGLE_CLIENT_SECRET='<Client secret>'
```

Nu e nevoie de niciun deploy după: funcțiile citesc secretele la fiecare cerere.
(`CALENDAR_TOKEN_KEY` și `CALENDAR_STATE_SECRET` sunt deja setate.)

## 6. Conectează contul

1. În aplicație: rotița ⚙ → **Integrări** → **Conectează Google Calendar**.
2. Alege contul, **Advanced → Go to Horizontal**, lasă bifat accesul la
   calendar → **Continue**.
3. Te întorci în aplicație, cu Setări deschise și calendarele listate.
   Sărbătorile și zilele de naștere pornesc oprite.
4. Pentru al doilea cont (serviciu / personal): **Conectează alt cont Google**.

**Contul de serviciu (Workspace):** dacă la autorizare apare „Access blocked:
Horizontal has not completed the Google verification process" sau „admin
policy", administratorul Workspace al firmei a restrâns aplicațiile terțe. Îi
poți cere să permită clientul OAuth de mai sus (Admin console → Security →
API controls → App access control → *Configure new app* → după Client ID →
*Trusted*). Fără asta, contul de serviciu nu se poate lega.

## Verificare

```sql
select email, status, last_synced_at, last_error from calendar_accounts;
select count(*) from calendar_events;
-- răspunsul ultimei rulări a cronului de sincronizare:
select status_code, content from net._http_response
where content like '%results%' order by created desc limit 3;
```

`status = 'reconnect'` → Google a refuzat tokenul (revocat din
<https://myaccount.google.com/permissions>, parolă schimbată, sau aplicația a
rămas în *Testing*). În Integrări: **Deconectează**, apoi conectează din nou.
