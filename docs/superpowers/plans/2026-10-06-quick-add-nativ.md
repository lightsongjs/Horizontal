# Quick add nativ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Butonul de quick add de pe ecranul de start deschide o fereastră nativă mică (ca TickTick), cu tot ce are bara de captură de pe Linux, care merge și offline.

**Architecture:** Logica de captură a paginii devine o funcție pură (`computeDraft`) folosită de pagină ȘI împachetată (esbuild) într-un motor JS nativ (`androidx.javascriptengine`). Fereastra (`QuickAddActivity`) e nativă; crearea trece printr-o coadă nativă separată (`creates`) trimisă de `DrainWorker`, cu ID-ul fixat înainte de POST (fără dubluri). Pagina îi dă telefonului proiectele și oamenii (`setCaptureData`, API 3).

**Tech Stack:** TS/vitest, esbuild, Kotlin/JUnit, androidx.javascriptengine, WorkManager, OkHttp REST (PostgREST + Storage).

**Spec:** `docs/superpowers/specs/2026-10-06-quick-add-nativ-design.md`

## Global Constraints

- `minSdkVersion 26`, `versionCode 5`, plugin `API = 3`; pagina cheamă `setCaptureData` doar cu `api >= 3`.
- Proiect implicit: `dailyProjectId` (după nume „daily”); fără dată → începutul zilei locale de azi, `allDay: true`; memento: `reminderAt(dueAt, defaultReminder(allDay))`.
- O singură sursă pentru regulile de captură: `computeDraft`. Nicio regulă de dată/semne scrisă în Kotlin, cu excepția modului brut.
- Nicio scriere fără ID fixat înainte de cerere; nicio retrimitere oarbă a unei creări.
- Fișierele nu trec prin coada offline: offline la Trimite → refuz, fereastra rămâne.
- Fără emoji în UI; serif pentru text, mono pentru cifre; un singur accent.
- Push pe master = producție: doar la final, cu acordul omului.

## Review Focus

1. **Moartea procesului între POST și salvarea răspunsului** → la repornire aceeași creare se retrimite cu același ID → 409 → recunoscută ca a noastră → fără dublură. Test: `CreateTest.conflict_alNostru_eGata`.
2. **Două dispozitive aleg același număr** (pagina pe laptop + telefonul) → telefonul ia alt ID, pagina reîncearcă la 23505. Teste: `CreateTest.conflict_alAltcuiva_reîncearcă`, `supabaseRepository` retry.
3. **Motorul JS indisponibil** → fereastra merge în mod brut, nu se blochează. Test: `CaptureTest.rawDraft`.
4. **Text numai-dată („azi la 8”)** → refuz vizibil (`bare`), nu sarcină fără titlu. Test: fixture `bare` în `capture.fixtures.json`.
5. **Remaparea ID-ului provizoriu** → „Gata” pus din widget pe sarcina încă netrimisă pleacă pe ID-ul real. Test: `CreateTest.remap`.

---

### Task 1: `computeDraft` — o singură funcție de captură

**Files:** Modify `src/lib/quickDraft.ts`, `src/hooks.ts`; Create `src/lib/capture.fixtures.json`; Test `src/lib/quickDraft.test.ts` (adăugiri), `src/lib/captureShared.test.ts`.

**Produces:**
```ts
export interface CaptureInput {
  text: string; desc: string; rejected: string[]; manual: ManualPick
  projects: { id: string; name: string; prefix: string; type?: string }[]
  assignees: { id: string; name: string }[]
  defaultProjectId: string | null; nowMs: number; tokens: boolean
}
export interface CaptureResult {
  live: string[]; spans: [number, number][]; title: string
  projectId: string | null; assigneeId: string | null; urgent: boolean; unknown: string[]
  schedule: DraftSchedule; issue: NewIssue | null; error: DraftError | null
}
export function computeDraft(i: CaptureInput): CaptureResult
```
Semantica = `useTitleDate` + `useQuickDraft` de azi (ctx `list`, `defaultDueAt` = începutul zilei lui `nowMs`, ISO). Proiectul: `manual.projectId ?? tokens.projectId ?? defaultProjectId`, apoi primul `type==='personal'`, apoi primul.

- [ ] Fixtures (≥8 cazuri: simplu; „mâine la 10 #daily @ana !”; refuz „la 10”; `bare` „azi la 8”; `empty`; buton de dată bate textul; „zilnic”; proiect necunoscut `#zzz` rămâne în titlu) cu `nowMs` fix, `TZ=Europe/Bucharest`.
- [ ] Test care pică → implementare → hooks refactorizate să cheme `computeDraft` (comportament neschimbat; `npm test` + `test:quick-add` verzi).
- [ ] Test `?raw`: `hooks.ts` conține `computeDraft(`.
- [ ] Commit.

### Task 2: ID-ul tichetului — fixtures comune + reîncercare la 23505 în pagină

**Files:** Modify `src/lib/issueId.ts` (mută `nextIssueId` aici, exportat), `src/data/supabaseRepository.ts`; Create `src/lib/issueId.fixtures.json`; Test `src/lib/issueId.test.ts`, `src/data/supabaseRepository.test.ts` (sau testul existent al depozitului).

- [ ] Fixtures `nextIssueId(existing, prefix)`: gol → `HZ-01`; `HZ-09` → `HZ-10`; `HZ-~abc` ignorat; `HZ-100`; un ID ciudat ignorat.
- [ ] `createIssue`: la eroare cu `code === '23505'` recalculează ID-ul și reîncearcă, max 3 încercări; altă eroare aruncă imediat. Test cu un `db` fals care întoarce 23505 o dată.
- [ ] Commit.

### Task 3: Pachetul motorului

**Files:** Create `src/capture/engine.ts`, `scripts/build-capture-engine.mjs`, `src/capture/engine.test.ts`; Modify `package.json` (`android:apk` rulează scriptul întâi), `.gitignore` (`mobile/android/app/src/main/assets/capture-engine.js`).

- [ ] `engine.ts`: `globalThis.HzCapture = { ABI: 1, captureDraft(json: string): string, shrinkPlan, attachmentFilename }` — `captureDraft` = `JSON.stringify(computeDraft(JSON.parse(json)))`.
- [ ] Script: esbuild IIFE, es2020, minify → `mobile/android/app/src/main/assets/capture-engine.js`.
- [ ] Test: construiește în memorie (esbuild `write:false`), rulează în `node:vm` cu `TZ` fixat, compară cu `computeDraft` pe `capture.fixtures.json`.
- [ ] Commit.

### Task 4: Motorul în Kotlin + modul brut

**Files:** Modify `mobile/android/variables.gradle` (minSdk 26), `app/build.gradle` (`androidx.javascriptengine:javascriptengine:1.0.0`, versionCode 5); Create `CaptureEngine.kt`, `core/Capture.kt`; Test `core/CaptureTest.kt`.

**Produces:**
```kotlin
data class CaptureProject(val id: String, val name: String, val prefix: String, val type: String?)
data class CaptureData(val projects: List<CaptureProject>, val assignees: List<Pair<String, String>>, val readAt: Long)
data class Draft(val title: String, val spans: List<IntRange>, val live: List<String>, val projectId: String?, val assigneeId: String?, val urgent: Boolean, val unknown: List<String>,
                 val dueAt: String?, val allDay: Boolean, val rrule: String?, val remindAt: String?, val error: String?, val raw: Boolean)
fun dailyProjectId(projects: List<CaptureProject>): String?
fun rawDraft(text: String, manual: Manual, data: CaptureData, nowMs: Long, zone: ZoneId): Draft   // fără parser: titlul = textul
fun parseEngineResult(json: String): Draft
data class Manual(val projectId: String? = null, val assigneeId: String? = null, val assigneeSet: Boolean = false, val urgent: Boolean? = null, val dueAt: String? = null, val allDay: Boolean = true, val dueSet: Boolean = false)
fun manualDue(date: LocalDate?, time: LocalTime?, zone: ZoneId): Pair<String?, Boolean>
fun defaultRemindAt(dueAt: String?, allDay: Boolean): String?   // oglinda lui reminderAt(defaultReminder) — fixtures din schedule.test
object CaptureEngine { fun warm(ctx: Context); fun compute(input: JSONObject, cb: (Draft?) -> Unit); fun close() }
```
- [ ] JUnit: `rawDraft` (Daily implicit, azi, gol → `empty`), `manualDue`, `defaultRemindAt` (verifică întâi regula în `schedule.ts`), `parseEngineResult`.
- [ ] `CaptureEngine`: sandbox + isolate, încarcă `capture-engine.js` din assets, secvență, timeout 500 ms → `cb(null)`; `isSupported()` false → `cb(null)`.
- [ ] `npm run android:test` + `android:apk` verzi. Commit.

### Task 5: Coada de creări (pur)

**Files:** Create `core/Create.kt`; Modify `core/Json.kt`, `PlanStore.kt` (`creates`, `capture`); Test `core/CreateTest.kt`; fixtures `src/lib/issueId.fixtures.json` citite și de JUnit.

**Produces:**
```kotlin
data class NativeFile(val path: String, val filename: String, val contentType: String, val size: Long, val attachmentId: String, val uploaded: Boolean = false)
data class NativeCreate(val uid: String, val tempId: String, val projectId: String, val title: String, val desc: String,
    val dueAt: String?, val allDay: Boolean, val remindAt: String?, val rrule: String?, val urgent: Boolean, val assigneeId: String?,
    val createdAt: Long, val attemptId: String? = null, val realId: String? = null, val drainedAt: Long? = null, val inFlight: Boolean = false,
    val tries: Int = 0, val files: List<NativeFile> = emptyList())
fun nextIssueId(existing: List<String>, prefix: String): String
fun insertBody(c: NativeCreate, id: String, wave: Int): JSONObject
enum class Conflict { OURS, TAKEN }
fun conflictOf(row: JSONObject?, owner: String, c: NativeCreate): Conflict
fun remapCreate(s: CreateRemap): ...  // rescrie id-urile acțiunilor din coadă tempId → realId
fun createsAsAgenda(creates: List<NativeCreate>, projectNames: Map<String, String>): List<AgendaItem>
```
- [ ] Teste: fixtures `nextIssueId`; corpul insertului (aceleași coloane ca pagina, fără `created_by`); `conflictOf` (al nostru / al altcuiva / rând lipsă); remapare acțiuni; `visibleAgenda` cu creările încă necitite de o agendă mai nouă; Json dus-întors.
- [ ] Commit.

### Task 6: Datele de captură (API 3)

**Files:** Modify `HorizontalAndroidPlugin.kt` (`API = 3`, `setCaptureData`), `src/lib/androidBridge.ts` (`ANDROID_API_CAPTURE = 3`, tip, `captureKey`), `src/components/NativeBridge.tsx` (împinge `useWritableProjects()` + `assignees`).
- [ ] Test vitest `captureKey`; compilare Kotlin. Commit.

### Task 7: `DrainWorker` trimite creările

**Files:** Modify `DrainWorker.kt`, `Notifier.kt` (notificare de eșec), `Engine.kt` (mementourile creărilor în plan), `core/Plan.kt` dacă e nevoie, `NativeQueue.nextToDrain` (sare doar ID-urile provizorii pe care nu le deține o creare nativă).
- [ ] Ordinea: creările întâi; `attemptId` salvat sub lacăt înainte de POST; 409 → GET rândul → `conflictOf`; refuz → drop + notificare; succes → remap + `realId`, `notifyChanged`, `SyncWorker.now`. Apoi fișierele (Task 9).
- [ ] Teste JUnit pentru deciziile pure (deja în Task 5) + `nextToDrain` cu creări. Compilare. Commit.

### Task 8: `QuickAddActivity`

**Files:** Create `QuickAddActivity.kt`, `res/layout/activity_quick.xml`, stil `Hz.Quick`; Modify manifest, `Widgets.quick()`.
- [ ] Fereastra: titlu (EditText multi-linie), descriere, rând de jetoane (dată, proiect, persoană, urgent, agrafă), Trimite. Tastatura în `onWindowFocusChanged`. Evidențiere span-uri, atingere → refuz. Jetonul de dată arată rezultatul (`dueLabel`-like: „Azi”, „Mâine 10:00”). Fără date de captură → mesaj „Deschide aplicația o dată”.
- [ ] Trimite: computeDraft final (≤500 ms) sau brut → `NativeCreate` în `PlanStore.creates` → `Widgets.refresh` → `DrainWorker.enqueue` → închide.
- [ ] Compilare + build. Commit.

### Task 9: Atașamente

**Files:** Modify `QuickAddActivity.kt`, `DrainWorker.kt`; Create `NativeFiles.kt`.
- [ ] Cameră (`ACTION_IMAGE_CAPTURE` + FileProvider `cacheDir/capture/`), alegere (`ACTION_OPEN_DOCUMENT`, copiat imediat), micșorare după `shrinkPlan` din motor (fallback: originalul).
- [ ] Offline la Trimite cu fișiere → refuz, fereastra rămâne.
- [ ] Urcare după creare: `POST storage/v1/object/attachments/<pid>/<id>/<uuid>` (duplicat = succes), apoi rândul `attachments` cu `id` fix (23505 = succes); peste 1 h → renunță + notificare.
- [ ] Verifică întâi forma exactă a căii și coloanele în `src/data/attachments.ts` (`buildAttachmentPath`, insertul). Commit.

### Task 10: Livrare

- [ ] `CLAUDE.md`: paragraf scurt pentru agent. `npm test`, `typecheck`, `test:quick-add`, `test:nav`, `android:test`, `android:apk`.
- [ ] Revizie finală (agent). Push + instalare doar cu acordul omului; probe pe telefon din spec.
