# Widget-uri Android — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Două widget-uri pe ecranul de start al telefonului — quick add 1×1 și agenda sarcinilor (restanțe + 7 zile) cu bifă directă.

**Architecture:** Regula de grupare există deja în pagină (`buildSmartLists`); se rescrie în Kotlin pur (`core/Agenda.kt`), cu fixtures comune. Lista vine din două surse — pagina o împinge (`setAgenda`), `SyncWorker` o citește nativ — și câștigă cea mai proaspătă, ca la mementouri. Bifa trece prin coada nativă existentă (`Actions.dispatch` → `DrainWorker`). Atingerea pe rând și quick add-ul pornesc `MainActivity` cu un extra; pagina deschide tichetul/foaia și, la ieșire, cere `leave()` (ecranul de start).

**Tech Stack:** Kotlin, `RemoteViews` + `RemoteCollectionItems` (Android 12+), WorkManager existent, Capacitor plugin existent (`HorizontalAndroid`), React/TS în pagină, vitest + JUnit.

**Spec:** `docs/superpowers/specs/2026-10-06-widget-android-design.md` · mockup: `prototype-widget.html`

## Global Constraints

- Plugin `API` urcă de la 1 la 2; pagina cheamă `setAgenda`/`leave`/`showKeyboard` și ascultă `widget` NUMAI dacă `getInfo().api >= 2` (Capacitor nu respinge o metodă lipsă — apelul atârnă).
- `versionCode` 3 → 4 în `mobile/android/app/build.gradle`.
- Widget-ul de listă doar pe Android 12+ (`minSdk` rămâne 24); quick add pe orice versiune.
- Fereastra agendei: restanțe (oricât de vechi) + zilele locale 0..6. `AGENDA_DAYS = 7`, `AGENDA_LIMIT = 200`.
- Restanță = nebifat și trecut: cu oră → ora a trecut; toată ziua → zi anterioară. O restanță NU apare și în ziua ei.
- Bifa scoate rândul imediat, fără fereastră de anulare.
- Fără emoji; iconițe vector. Fără chenare pe widget. Fonturi: `serif` / `monospace` de sistem (vezi nota din Task 4).
- Nicio dependență nouă (nici Glance, nici Compose).
- Push pe `master` = producție: partea de pagină (Task 5) se publică ÎNAINTE de instalarea APK-ului; e inofensivă pe APK-ul vechi (verifică `api`).
- Contractul pluginului e scris de două ori: `src/lib/androidBridge.ts` și `HorizontalAndroidPlugin.kt` — se schimbă împreună.

## Review Focus

1. **Bifă pe o recurentă** — rândul dispare, apoi reapare la data nouă după drain + sync; nu sare de două ori (garda `prevDueAt` din `buildPatch`). Test: Task 2 `visibleAgenda` ascunde id-ul cât e acțiunea `DONE` în coadă, oricare ar fi `drainedAt`.
2. **Miezul nopții fără date noi** — „Mâine" devine „Azi", restanțele „de azi" fără oră devin restanțe. Test: Task 2 fixture `trecerea zilei` (același set, `now` diferit).
3. **Nicio listă încă (instalare proaspătă, nelogat)** — widget-ul spune „Deschide aplicația o dată", nu „Nimic restant" (care ar minți). Test: Task 2 `agendaState(null, null, …)` = `NoData`.
4. **Bifă fără sesiune nativă** — deschide aplicația pe tichet în loc să pună în coadă o acțiune care nu va pleca niciodată. Verificat pe telefon (Task 6), ramura e în `WidgetTapActivity`.
5. **Restanță veche de peste o săptămână** — metadatele arată „2 oct", nu „vin 2" (ar fi ambiguu). Test: Task 2 `rowMeta`.

---

### Task 1: Regula agendei în pagină + fixtures comune

**Files:**
- Create: `src/lib/agenda.ts`
- Create: `src/lib/agenda.fixtures.json`
- Test: `src/lib/agenda.test.ts`

**Interfaces:**
- Consumes: `buildSmartLists`, `isOverdue`, `dayOffset`, `compareDue`, `SMART_LIST_DAYS`, `NO_SCHEDULE` din `src/lib/schedule.ts`; `Issue`, `Project` din `src/lib/types.ts`.
- Produces:
  ```ts
  export interface AgendaItem { id: string; title: string; project: string | null; dueAt: string; allDay: boolean; hasReminder: boolean; recurring: boolean; urgent: boolean }
  export const AGENDA_LIMIT = 200
  export function agendaItems(issues: Issue[], projects: Pick<Project, 'id' | 'name'>[], now: Date): AgendaItem[]
  ```
  Fixtures JSON (citite și de Kotlin în Task 2), format:
  `[{ "name", "now", "items": [{ "id", "dueAt", "allDay", "urgent" }], "want": [{ "section": "overdue" } | { "section": "day", "offset": n }, + "ids": [...] ] }]`

- [ ] **Step 1: Scrie fixtures** — `src/lib/agenda.fixtures.json`. Fus: Europe/Bucharest (UTC+3 până pe 25 oct 2026, apoi UTC+2). „Toată ziua" = miezul nopții local.

```json
[
  {
    "name": "restanțe sus, azi fără oră înaintea celor cu oră, ziua a 7-a afară",
    "now": "2026-10-06T08:00:00.000Z",
    "items": [
      { "id": "HZ-1", "dueAt": "2026-10-04T21:00:00.000Z", "allDay": true,  "urgent": false },
      { "id": "HZ-2", "dueAt": "2026-10-06T07:00:00.000Z", "allDay": false, "urgent": false },
      { "id": "HZ-3", "dueAt": "2026-10-05T21:00:00.000Z", "allDay": true,  "urgent": false },
      { "id": "HZ-4", "dueAt": "2026-10-06T11:30:00.000Z", "allDay": false, "urgent": false },
      { "id": "HZ-5", "dueAt": "2026-10-07T14:30:00.000Z", "allDay": false, "urgent": false },
      { "id": "HZ-6", "dueAt": "2026-10-12T21:00:00.000Z", "allDay": true,  "urgent": false },
      { "id": "HZ-7", "dueAt": "2026-10-11T21:00:00.000Z", "allDay": true,  "urgent": false }
    ],
    "want": [
      { "section": "overdue", "ids": ["HZ-1", "HZ-2"] },
      { "section": "day", "offset": 0, "ids": ["HZ-3", "HZ-4"] },
      { "section": "day", "offset": 1, "ids": ["HZ-5"] },
      { "section": "day", "offset": 6, "ids": ["HZ-7"] }
    ]
  },
  {
    "name": "urgentul întâi între cele fără oră, apoi id",
    "now": "2026-10-06T08:00:00.000Z",
    "items": [
      { "id": "HZ-B", "dueAt": "2026-10-05T21:00:00.000Z", "allDay": true, "urgent": false },
      { "id": "HZ-Z", "dueAt": "2026-10-05T21:00:00.000Z", "allDay": true, "urgent": true },
      { "id": "HZ-A", "dueAt": "2026-10-05T21:00:00.000Z", "allDay": true, "urgent": false }
    ],
    "want": [{ "section": "day", "offset": 0, "ids": ["HZ-Z", "HZ-A", "HZ-B"] }]
  },
  {
    "name": "trecerea zilei: aceleași sarcini, la 00:30 a doua zi",
    "now": "2026-10-06T21:30:00.000Z",
    "items": [
      { "id": "HZ-3", "dueAt": "2026-10-05T21:00:00.000Z", "allDay": true,  "urgent": false },
      { "id": "HZ-5", "dueAt": "2026-10-07T14:30:00.000Z", "allDay": false, "urgent": false }
    ],
    "want": [
      { "section": "overdue", "ids": ["HZ-3"] },
      { "section": "day", "offset": 0, "ids": ["HZ-5"] }
    ]
  },
  {
    "name": "ora de iarnă (25 oct): zilele locale rămân întregi",
    "now": "2026-10-24T09:00:00.000Z",
    "items": [
      { "id": "HZ-8", "dueAt": "2026-10-25T22:00:00.000Z", "allDay": true, "urgent": false },
      { "id": "HZ-9", "dueAt": "2026-10-24T21:00:00.000Z", "allDay": true, "urgent": false }
    ],
    "want": [
      { "section": "day", "offset": 1, "ids": ["HZ-9"] },
      { "section": "day", "offset": 2, "ids": ["HZ-8"] }
    ]
  },
  {
    "name": "nimic",
    "now": "2026-10-06T08:00:00.000Z",
    "items": [],
    "want": []
  }
]
```

- [ ] **Step 2: Scrie testul care eșuează** — `src/lib/agenda.test.ts`

```ts
// Fusul ÎNAINTE de orice Date: regula e pe zile locale, iar fixtures-urile sunt
// scrise pentru București (le citește și JUnit, cu același fus).
process.env.TZ = 'Europe/Bucharest'

import { describe, expect, it } from 'vitest'
import fixtures from './agenda.fixtures.json'
import { buildSmartLists, NO_SCHEDULE } from './schedule'
import { agendaItems, AGENDA_LIMIT } from './agenda'
import type { Issue } from './types'

const issue = (p: Partial<Issue> & { id: string }): Issue =>
  ({ ...NO_SCHEDULE, projectId: 'p1', title: p.id, done: false, urgent: false, ...p }) as Issue

describe('agenda — fixtures comune cu Kotlin', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const lists = buildSmartLists(f.items.map((i) => issue(i)), new Date(f.now))
      const got: unknown[] = []
      if (lists.overdue.length) got.push({ section: 'overdue', ids: lists.overdue.map((i) => i.id) })
      lists.week.forEach((d, offset) => { if (d.issues.length) got.push({ section: 'day', offset, ids: d.issues.map((i) => i.id) }) })
      expect(got).toEqual(f.want)
    })
  }
})

describe('agendaItems', () => {
  const now = new Date('2026-10-06T08:00:00.000Z')
  const projects = [{ id: 'p1', name: 'Daily' }]

  it('ia doar nebifatele cu scadență din fereastră, o dată fiecare, cu proiectul și semnele', () => {
    const a = issue({ id: 'HZ-1', dueAt: '2026-10-06T11:30:00.000Z', allDay: false, remindAt: '2026-10-06T11:20:00.000Z', rrule: 'FREQ=DAILY' })
    const got = agendaItems([
      a, a,                                                                     // dublură (dueIssues + issues)
      issue({ id: 'HZ-2', dueAt: '2026-10-06T11:30:00.000Z', done: true }),     // bifată
      issue({ id: 'HZ-3' }),                                                    // fără scadență
      issue({ id: 'HZ-4', dueAt: '2026-10-12T21:00:00.000Z' }),                 // ziua a 7-a
      issue({ id: 'HZ-5', dueAt: '2026-09-01T21:00:00.000Z', projectId: 'px' }),// restanță veche, proiect necunoscut
    ], projects, now)
    expect(got).toEqual([
      { id: 'HZ-5', title: 'HZ-5', project: null, dueAt: '2026-09-01T21:00:00.000Z', allDay: true, hasReminder: false, recurring: false, urgent: false },
      { id: 'HZ-1', title: 'HZ-1', project: 'Daily', dueAt: '2026-10-06T11:30:00.000Z', allDay: false, hasReminder: true, recurring: true, urgent: false },
    ])
  })

  it(`se oprește la ${AGENDA_LIMIT}`, () => {
    const many = Array.from({ length: AGENDA_LIMIT + 5 }, (_, i) => issue({ id: `HZ-${i}`, dueAt: '2026-10-05T21:00:00.000Z' }))
    expect(agendaItems(many, projects, now)).toHaveLength(AGENDA_LIMIT)
  })
})
```

- [ ] **Step 3: Rulează, verifică că pică**

Run: `npx vitest run src/lib/agenda.test.ts`
Expected: FAIL — `Cannot find module './agenda'`. (Testele de fixtures trebuie să TREACĂ deja după ce există modulul — ele verifică regula existentă; dacă una pică, fixture-ul e greșit, nu `schedule.ts`: recalculează orele, nu schimba regula.)

- [ ] **Step 4: Implementează** — `src/lib/agenda.ts`

```ts
// Ce vede widget-ul de pe ecranul de start: restanțele și zilele 0..6, ca
// listele „Azi" / „7 zile". Pagina trimite rândurile NEGRUPATE: gruparea o face
// cutia (`core/Agenda.kt`), fiindcă la miezul nopții se schimbă fără date noi.
// Regula e `buildSmartLists`; fixtures comune în `agenda.fixtures.json`.

import { compareDue, dayOffset, isOverdue, SMART_LIST_DAYS } from './schedule'
import type { Issue, Project } from './types'

export interface AgendaItem {
  id: string
  title: string
  project: string | null
  dueAt: string
  allDay: boolean
  hasReminder: boolean
  recurring: boolean
  urgent: boolean
}

/** Același plafon ca citirea nativă (`AGENDA_LIMIT` din `core/Agenda.kt`). */
export const AGENDA_LIMIT = 200

export function agendaItems(issues: Issue[], projects: Pick<Project, 'id' | 'name'>[], now: Date): AgendaItem[] {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const byId = new Map<string, Issue>()
  for (const it of issues) {
    if (it.done || !it.dueAt || byId.has(it.id)) continue
    if (!isOverdue(it, now) && dayOffset(it.dueAt, now) >= SMART_LIST_DAYS) continue
    byId.set(it.id, it)
  }
  return [...byId.values()].sort(compareDue).slice(0, AGENDA_LIMIT).map((it) => ({
    id: it.id,
    title: it.title,
    project: names.get(it.projectId) ?? null,
    dueAt: it.dueAt!,
    allDay: it.allDay,
    hasReminder: !!it.remindAt,
    recurring: !!it.rrule,
    urgent: it.urgent,
  }))
}
```

Notă: `dayOffset < 0` fără să fie restanță nu există (toată ziua de ieri E restanță), deci condiția de mai sus e completă.

- [ ] **Step 5: Rulează, verifică că trece**

Run: `npx vitest run src/lib/agenda.test.ts && npm run typecheck`
Expected: PASS (7 teste), typecheck curat. Dacă `import fixtures from './agenda.fixtures.json'` cere `resolveJsonModule`, uită-te cum importă `pushPayload.test.ts` fixtures-urile lui și fă la fel.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agenda.ts src/lib/agenda.test.ts src/lib/agenda.fixtures.json
git commit -m "feat(widget): regula agendei în pagină + fixtures comune"
```

---

### Task 2: Agenda în Kotlin pur (`core/`)

**Files:**
- Create: `mobile/android/app/src/main/java/ro/horizontal/app/core/Agenda.kt`
- Modify: `mobile/android/app/src/main/java/ro/horizontal/app/core/Json.kt` (agenda pe disc/punte)
- Modify: `mobile/android/app/src/test/java/ro/horizontal/app/core/FixturesTest.kt` (fixtures agendă)
- Test: `mobile/android/app/src/test/java/ro/horizontal/app/core/AgendaTest.kt`

**Interfaces:**
- Consumes: `parseIso`, `isoJs` (`core/Time.kt`); `NativeAction` (`core/Plan.kt`); fixtures din Task 1.
- Produces:
  ```kotlin
  data class AgendaItem(val id: String, val title: String, val project: String?, val dueAt: String, val allDay: Boolean, val hasReminder: Boolean, val recurring: Boolean, val urgent: Boolean)
  data class AgendaList(val items: List<AgendaItem>, val readAt: Long)
  data class AgendaSection(val overdue: Boolean, val offset: Int, val date: LocalDate?, val items: List<AgendaItem>)
  sealed interface AgendaState { object NoData : AgendaState; data class Ready(val sections: List<AgendaSection>, val count: Int) : AgendaState }
  const val AGENDA_DAYS = 7; const val AGENDA_LIMIT = 200
  fun buildAgenda(items: List<AgendaItem>, now: Long, zone: ZoneId): List<AgendaSection>
  fun visibleAgenda(page: AgendaList?, native: AgendaList?, queue: List<NativeAction>): List<AgendaItem>?
  fun agendaState(page: AgendaList?, native: AgendaList?, queue: List<NativeAction>, now: Long, zone: ZoneId): AgendaState
  fun sectionLabel(s: AgendaSection): String
  fun rowMeta(item: AgendaItem, overdue: Boolean, now: Long, zone: ZoneId): String
  fun agendaQuery(now: Long, zone: ZoneId): String
  fun parseAgenda(json: String): List<AgendaItem>
  // Json: agendaToJson(AgendaList): JSONObject, agendaFromJson(JSONObject): AgendaList?, agendaItemFromJson(JSONObject): AgendaItem?
  ```

- [ ] **Step 1: Testul de fixtures care pică** — adaugă în `FixturesTest.kt`:

```kotlin
    @Test fun agenda() {
        val all = load("agenda.fixtures.json")
        for (i in 0 until all.length()) {
            val f = all.getJSONObject(i)
            val items = f.getJSONArray("items").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
                AgendaItem(o.getString("id"), o.getString("id"), null, o.getString("dueAt"), o.getBoolean("allDay"), false, false, o.getBoolean("urgent"))
            } }
            val got = buildAgenda(items, parseIso(f.getString("now"))!!, zone).map { s ->
                if (s.overdue) "overdue:${s.items.joinToString(",") { it.id }}" else "day${s.offset}:${s.items.joinToString(",") { it.id }}"
            }
            val want = f.getJSONArray("want").let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { w ->
                val ids = w.getJSONArray("ids").let { x -> (0 until x.length()).joinToString(",") { x.getString(it) } }
                if (w.getString("section") == "overdue") "overdue:$ids" else "day${w.getInt("offset")}:$ids"
            } }
            assertEquals(f.getString("name"), want, got)
        }
    }
```

- [ ] **Step 2: Testele unitare care pică** — `AgendaTest.kt`

```kotlin
package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class AgendaTest {
    private val zone = ZoneId.of("Europe/Bucharest")
    private val now = parseIso("2026-10-06T08:00:00.000Z")!!   // marți, 11:00
    private fun item(id: String, dueAt: String, allDay: Boolean = true) = AgendaItem(id, id, null, dueAt, allDay, false, false, false)
    private fun done(id: String, drainedAt: Long? = null) = NativeAction(uid = "u-$id", kind = NativeAction.Kind.DONE, id = id, title = "", body = "", createdAt = 1, drainedAt = drainedAt)

    @Test fun câștigăListaMaiProaspătă_șiBifeleDinCoadăSuntAscunse() {
        val page = AgendaList(listOf(item("A", "2026-10-05T21:00:00.000Z")), readAt = 10)
        val native = AgendaList(listOf(item("A", "2026-10-05T21:00:00.000Z"), item("B", "2026-10-05T21:00:00.000Z")), readAt = 20)
        assertEquals(listOf("A", "B"), visibleAgenda(page, native, emptyList())!!.map { it.id })
        assertEquals(listOf("A"), visibleAgenda(page.copy(readAt = 30), native, emptyList())!!.map { it.id })
        // Ascunsă și după trimitere: rămâne ascunsă până o listă nouă (fără ea) prunează coada.
        assertEquals(listOf("B"), visibleAgenda(null, native, listOf(done("A", drainedAt = 25)))!!.map { it.id })
    }

    @Test fun fărăNicioListă_eNoData_nuGol() {
        assertEquals(AgendaState.NoData, agendaState(null, null, emptyList(), now, zone))
        val empty = agendaState(null, AgendaList(emptyList(), 1), emptyList(), now, zone)
        assertEquals(AgendaState.Ready(emptyList(), 0), empty)
    }

    @Test fun etichete() {
        val today = LocalDate.of(2026, 10, 6)
        assertEquals("RESTANȚE", sectionLabel(AgendaSection(true, 0, null, emptyList())))
        assertEquals("AZI · MAR 6 OCT", sectionLabel(AgendaSection(false, 0, today, emptyList())))
        assertEquals("MÂINE · MIE 7 OCT", sectionLabel(AgendaSection(false, 1, today.plusDays(1), emptyList())))
        assertEquals("JOI 8 OCT", sectionLabel(AgendaSection(false, 2, today.plusDays(2), emptyList())))
        assertEquals("SÂMBĂTĂ 10 OCT", sectionLabel(AgendaSection(false, 4, today.plusDays(4), emptyList())))
    }

    @Test fun metadateleRândului() {
        assertEquals("14:30", rowMeta(item("A", "2026-10-06T11:30:00.000Z", allDay = false), false, now, zone))
        assertEquals("", rowMeta(item("A", "2026-10-05T21:00:00.000Z"), false, now, zone))
        assertEquals("10:00", rowMeta(item("A", "2026-10-06T07:00:00.000Z", allDay = false), true, now, zone))   // restanță de azi: ora
        assertEquals("ieri", rowMeta(item("A", "2026-10-04T21:00:00.000Z"), true, now, zone))
        assertEquals("vin 2", rowMeta(item("A", "2026-10-01T21:00:00.000Z"), true, now, zone))
        assertEquals("29 sep", rowMeta(item("A", "2026-09-28T21:00:00.000Z"), true, now, zone))           // ≥ 7 zile: data, nu ziua
    }

    @Test fun interogareaÎncepeDeLaOriceRestanțăȘiSeOpreșteLaZiua7() {
        val q = agendaQuery(now, zone)
        assertTrue(q, q.contains("done=is.false"))
        assertTrue(q, q.contains("due_at=lt.2026-10-12T21%3A00%3A00.000Z"))
        assertTrue(q, q.contains("limit=$AGENDA_LIMIT"))
        assertTrue(q, !q.contains("due_at=gte"))
    }

    @Test fun parsareaSareRândurileStricate() {
        val json = """[
          {"id":"HZ-1","title":"Raport","due_at":"2026-10-06T07:00:00+00:00","all_day":false,"remind_at":"2026-10-06T06:50:00+00:00","rrule":null,"urgent":true,"projects":{"name":"Daily"}},
          {"id":null,"title":"x","due_at":"2026-10-06T07:00:00+00:00"},
          {"id":"HZ-2","title":null,"due_at":null},
          {"id":"HZ-3","title":null,"due_at":"2026-10-06T07:00:00+00:00","all_day":true,"remind_at":null,"rrule":"FREQ=DAILY","urgent":null,"projects":null}
        ]"""
        assertEquals(listOf(
            AgendaItem("HZ-1", "Raport", "Daily", "2026-10-06T07:00:00.000Z", false, true, false, true),
            AgendaItem("HZ-3", "(fără titlu)", null, "2026-10-06T07:00:00.000Z", true, false, true, false),
        ), parseAgenda(json))
    }

    @Test fun jsonDusÎntors() {
        val l = AgendaList(listOf(AgendaItem("HZ-1", "R", null, "2026-10-06T07:00:00.000Z", false, true, true, false)), 42)
        assertEquals(l, Json.agendaFromJson(Json.agendaToJson(l)))
    }
}
```

- [ ] **Step 3: Rulează, verifică că pică**

Run: `npm run android:test`
Expected: FAIL la compilare — `Unresolved reference: AgendaItem`.

- [ ] **Step 4: Implementează** — `core/Agenda.kt`

```kotlin
package ro.horizontal.app.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Widget-ul de agendă: restanțele și zilele 0..6. Regula e `buildSmartLists`
 * din `src/lib/schedule.ts`, scrisă a doua oară; fixtures comune în
 * `src/lib/agenda.fixtures.json`. Un caz nou se adaugă acolo.
 */
data class AgendaItem(
    val id: String, val title: String, val project: String?, val dueAt: String, val allDay: Boolean,
    val hasReminder: Boolean, val recurring: Boolean, val urgent: Boolean,
)
/** `readAt` = PORNIREA citirii (ca `NativeList`); al paginii, 0 offline. */
data class AgendaList(val items: List<AgendaItem>, val readAt: Long)
data class AgendaSection(val overdue: Boolean, val offset: Int, val date: LocalDate?, val items: List<AgendaItem>)

sealed interface AgendaState {
    /** Nicio listă încă (instalare proaspătă, nelogat): „gol" ar minți. */
    object NoData : AgendaState
    data class Ready(val sections: List<AgendaSection>, val count: Int) : AgendaState
}

const val AGENDA_DAYS = 7
const val AGENDA_LIMIT = 200

private fun localDate(ms: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
private fun offset(ms: Long, now: Long, zone: ZoneId) = ChronoUnit.DAYS.between(localDate(now, zone), localDate(ms, zone)).toInt()

private fun overdue(it: AgendaItem, due: Long, now: Long, zone: ZoneId) =
    if (it.allDay) offset(due, now, zone) < 0 else due < now

/** `compareDue`: ziua, apoi fără oră înaintea celor cu oră, ora, urgentul, id. */
private fun order(zone: ZoneId) = compareBy<Pair<AgendaItem, Long>>(
    { localDate(it.second, zone) }, { !it.first.allDay }, { it.second }, { !it.first.urgent }, { it.first.id },
)

fun buildAgenda(items: List<AgendaItem>, now: Long, zone: ZoneId): List<AgendaSection> {
    val timed = items.mapNotNull { i -> parseIso(i.dueAt)?.let { i to it } }.sortedWith(order(zone))
    val late = timed.filter { (i, at) -> overdue(i, at, now, zone) }
    val out = mutableListOf<AgendaSection>()
    if (late.isNotEmpty()) out += AgendaSection(true, 0, null, late.map { it.first })
    val today = localDate(now, zone)
    for (d in 0 until AGENDA_DAYS) {
        val rows = timed.filter { (i, at) -> !overdue(i, at, now, zone) && offset(at, now, zone) == d }
        if (rows.isNotEmpty()) out += AgendaSection(false, d, today.plusDays(d.toLong()), rows.map { it.first })
    }
    return out
}

/**
 * Lista citită mai recent (la egalitate, a paginii); fără niciuna, `null`.
 * Un id cu „Gata" în coadă nu se arată, trimis sau nu: rămâne ascuns până
 * o listă citită după trimitere prunează coada (`NativeQueue.prune`) — o
 * recurentă reapare atunci la data nouă.
 */
fun visibleAgenda(page: AgendaList?, native: AgendaList?, queue: List<NativeAction>): List<AgendaItem>? {
    val src = listOfNotNull(page, native).maxByOrNull { it.readAt } ?: return null
    val done = queue.filter { it.kind == NativeAction.Kind.DONE }.map { it.id }.toSet()
    return src.items.filter { it.id !in done }
}

fun agendaState(page: AgendaList?, native: AgendaList?, queue: List<NativeAction>, now: Long, zone: ZoneId): AgendaState {
    val items = visibleAgenda(page, native, queue) ?: return AgendaState.NoData
    val sections = buildAgenda(items, now, zone)
    return AgendaState.Ready(sections, sections.sumOf { it.items.size })
}

private val ZILE = listOf("lun", "mar", "mie", "joi", "vin", "sâm", "dum")
private val ZILE_LUNGI = listOf("luni", "marți", "miercuri", "joi", "vineri", "sâmbătă", "duminică")
private val LUNI = listOf("ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "nov", "dec")
private val RO = Locale.forLanguageTag("ro")
private fun short(d: LocalDate) = "${ZILE[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${LUNI[d.monthValue - 1]}"

fun sectionLabel(s: AgendaSection): String {
    if (s.overdue) return "RESTANȚE"
    val d = s.date!!
    val text = when (s.offset) {
        0 -> "azi · ${short(d)}"
        1 -> "mâine · ${short(d)}"
        else -> "${ZILE_LUNGI[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${LUNI[d.monthValue - 1]}"
    }
    return text.uppercase(RO)
}

private val HM = DateTimeFormatter.ofPattern("HH:mm")

/** Dreapta rândului. Restanțe: cât de veche e; altfel ora, DOAR dacă are una (`DueChip`). */
fun rowMeta(item: AgendaItem, overdue: Boolean, now: Long, zone: ZoneId): String {
    val at = parseIso(item.dueAt) ?: return ""
    val time = if (item.allDay) "" else ZonedDateTime.ofInstant(Instant.ofEpochMilli(at), zone).format(HM)
    if (!overdue) return time
    val off = offset(at, now, zone)
    val d = localDate(at, zone)
    return when {
        off == 0 -> time
        off == -1 -> "ieri"
        off > -7 -> "${ZILE[d.dayOfWeek.value - 1]} ${d.dayOfMonth}"
        else -> "${d.dayOfMonth} ${LUNI[d.monthValue - 1]}"
    }
}

/**
 * Fără limită inferioară: o restanță de luna trecută e tot restanță. Ordonat
 * crescător, deci plafonul taie din viitor, nu din restanțe.
 */
fun agendaQuery(now: Long, zone: ZoneId): String {
    val e = { s: String -> URLEncoder.encode(s, "UTF-8") }
    val end = localDate(now, zone).plusDays(AGENDA_DAYS.toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
    return "issues?select=id,title,due_at,all_day,remind_at,rrule,urgent,projects(name)" +
        "&done=is.false&due_at=lt.${e(isoJs(end))}&order=due_at.asc&limit=$AGENDA_LIMIT"
}

/** Un rând stricat e sărit, nu aruncă (ca `parseIssues`). `isNull` înainte de `optString`: vezi acolo. */
fun parseAgenda(json: String): List<AgendaItem> {
    val a = JSONArray(json)
    fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k)
    return (0 until a.length()).mapNotNull { i ->
        val o = a.optJSONObject(i) ?: return@mapNotNull null
        val id = o.str("id")?.ifEmpty { null } ?: return@mapNotNull null
        val due = parseIso(o.str("due_at")) ?: return@mapNotNull null
        AgendaItem(
            id, o.str("title")?.ifBlank { null } ?: "(fără titlu)", o.optJSONObject("projects")?.str("name"),
            isoJs(due), if (o.isNull("all_day")) false else o.optBoolean("all_day", false),
            o.str("remind_at") != null, o.str("rrule") != null, if (o.isNull("urgent")) false else o.optBoolean("urgent", false),
        )
    }
}
```

Verifică întâi cum tratează pagina un titlu gol (caută `fără titlu` în `src/`); dacă textul e altul, folosește-l pe acela, în test și în cod.

- [ ] **Step 5: Json** — adaugă în `object Json` din `core/Json.kt`:

```kotlin
    fun agendaItemToJson(i: AgendaItem) = JSONObject().put("id", i.id).put("title", i.title).put("project", i.project ?: JSONObject.NULL)
        .put("dueAt", i.dueAt).put("allDay", i.allDay).put("hasReminder", i.hasReminder).put("recurring", i.recurring).put("urgent", i.urgent)
    /** Și forma de pe punte (`AgendaItem` din `src/lib/agenda.ts`). */
    fun agendaItemFromJson(o: JSONObject): AgendaItem? {
        val id = o.str("id") ?: return null
        val due = parseIso(o.str("dueAt")) ?: return null
        return AgendaItem(id, o.str("title") ?: return null, o.str("project"), isoJs(due), o.optBoolean("allDay", false),
            o.optBoolean("hasReminder", false), o.optBoolean("recurring", false), o.optBoolean("urgent", false))
    }
    fun agendaToJson(l: AgendaList) = JSONObject().put("readAt", l.readAt)
        .put("items", org.json.JSONArray().also { a -> l.items.forEach { a.put(agendaItemToJson(it)) } })
    fun agendaFromJson(o: JSONObject): AgendaList? = try {
        val a = o.getJSONArray("items")
        AgendaList((0 until a.length()).mapNotNull { agendaItemFromJson(a.getJSONObject(it)) }, o.getLong("readAt"))
    } catch (e: Exception) { null }
```

`isoJs(parseIso(…))` normalizează `+00:00` la `.000Z`, deci cheile comparate între pagină și cutie au aceeași formă.

- [ ] **Step 6: Rulează, verifică că trece**

Run: `npm run android:test`
Expected: PASS (toate, inclusiv cele vechi).

- [ ] **Step 7: Commit**

```bash
git add mobile/android/app/src/main/java/ro/horizontal/app/core/Agenda.kt mobile/android/app/src/main/java/ro/horizontal/app/core/Json.kt mobile/android/app/src/test/java/ro/horizontal/app/core/AgendaTest.kt mobile/android/app/src/test/java/ro/horizontal/app/core/FixturesTest.kt
git commit -m "feat(widget): agenda în core/ — grupare, etichete, interogare, parsare"
```

---

### Task 3: Datele agendei în cutie — stare, citire nativă, plugin (API 2)

**Files:**
- Modify: `mobile/android/app/src/main/java/ro/horizontal/app/PlanStore.kt` (câmpuri `agendaPage`, `agendaNative`)
- Modify: `mobile/android/app/src/main/java/ro/horizontal/app/SyncWorker.kt` (a doua citire)
- Modify: `mobile/android/app/src/main/java/ro/horizontal/app/HorizontalAndroidPlugin.kt` (`API = 2`, `setAgenda`, `leave`, `showKeyboard`, evenimentul `widget`)
- Modify: `mobile/android/app/src/main/java/ro/horizontal/app/Engine.kt` (cheamă `Widgets.refresh`)
- Create: `mobile/android/app/src/main/java/ro/horizontal/app/Widgets.kt` (deocamdată doar constante + `refresh` gol; corpul vine în Task 4)

**Interfaces:**
- Consumes: Task 2 (`AgendaList`, `agendaQuery`, `parseAgenda`, `Json.agenda*`).
- Produces:
  - `PlanStore.State.agendaPage: AgendaList?`, `agendaNative: AgendaList?`
  - `object Widgets { const val EXTRA_OPEN = "hz-widget-open"; const val EXTRA_QUICK = "hz-widget-quick"; fun refresh(ctx: Context) }`
  - Plugin: `setAgenda({ items: AgendaItem[], readAt: number })`, `leave()`, `showKeyboard()`, eveniment `widget` cu `{ kind: 'open', id }` sau `{ kind: 'quick' }` (reținut, `retain = true`).

- [ ] **Step 1: `Widgets.kt` schelet**

```kotlin
package ro.horizontal.app

import android.content.Context

/** Widget-urile de pe ecranul de start. Corpul lui `refresh` vine cu desenul (Task 4). */
object Widgets {
    /** Atingere pe un rând: MainActivity deschide tichetul. Altul decât `Notifier.EXTRA_OPEN`: pagina știe că vine din widget. */
    const val EXTRA_OPEN = "hz-widget-open"
    const val EXTRA_QUICK = "hz-widget-quick"

    fun refresh(ctx: Context) {}
}
```

- [ ] **Step 2: `PlanStore`** — adaugă în `State`, după `deferred`:

```kotlin
        /** Agenda widget-ului, din cele două surse; câștigă `readAt` mai mare (`visibleAgenda`). */
        val agendaPage: AgendaList? = null,
        val agendaNative: AgendaList? = null,
```

În `loadOrThrow`, înainte de `return`, citește:

```kotlin
        val agendaPage = p.getString("agendaPage", null)?.let { Json.agendaFromJson(JSONObject(it)) }
        val agendaNative = p.getString("agendaNative", null)?.let { Json.agendaFromJson(JSONObject(it)) }
```

și adaugă `agendaPage, agendaNative` ca ultime argumente ale constructorului `State(...)`. În `save`, adaugă:

```kotlin
            .putString("agendaPage", s.agendaPage?.let { Json.agendaToJson(it).toString() })
            .putString("agendaNative", s.agendaNative?.let { Json.agendaToJson(it).toString() })
```

- [ ] **Step 3: `SyncWorker`** — după ce `list` e parsat și înainte de `if (isStopped)`, adaugă a doua citire. Eșecul ei NU strică mementourile: agenda veche rămâne.

```kotlin
        // A doua citire, pentru widget: pe `due_at`, nu pe `remind_at` (o sarcină de azi fără
        // memento, o restanță veche). Orice eșec păstrează agenda veche, nu o golește.
        val agenda = try {
            SupabaseApi.rest(ctx, "GET", agendaQuery(startedAt, ZoneId.systemDefault()), asUser = owner)
                ?.takeIf { it.status in 200..299 }?.let { parseAgenda(it.body) }
        } catch (e: AccountChanged) { return Result.success() }
          catch (e: IOException) { null }
          catch (e: JSONException) { Log.w("hz-sync", "agendă ilizibilă", e); null }
```

Și în `PlanStore.edit` schimbă `s.copy(native = …, lastSyncAt = …)` în:

```kotlin
            s.copy(native = NativeList(list, startedAt), lastSyncAt = System.currentTimeMillis(),
                agendaNative = agenda?.let { AgendaList(it, startedAt) } ?: s.agendaNative) to true
```

Importuri: `ro.horizontal.app.core.AgendaList`, `agendaQuery`, `parseAgenda`.

- [ ] **Step 4: `Engine.reschedule`** — orice schimbare de listă, coadă sau acțiune trece deja pe aici; widget-ul se redesenează în același loc:

```kotlin
    fun reschedule(ctx: Context, now: Long = System.currentTimeMillis(), hold: Boolean = false): List<Reminder> {
        Notifier.ensureChannels(ctx)
        val out = PlanStore.locked { effects(ctx, now, hold) }
        // În afara lacătului: desenul citește starea, nu o scrie.
        Widgets.refresh(ctx)
        return out
    }
```

- [ ] **Step 5: Plugin** — în `HorizontalAndroidPlugin.kt`:

`API = 2`, cu comentariu: `// 2: setAgenda, leave, showKeyboard, evenimentul „widget" (widget-urile).`

Înlocuiește `handleOpen` cu:

```kotlin
    /** Atingere pe notificare sau pe widget. `retain`: la pornire la rece pagina încă n-a pus listenerul. */
    private fun handleOpen(intent: Intent?) {
        // Relansată din Recente, activitatea primește intentul ORIGINAL al sarcinii —
        // `removeExtra` de mai jos nu supraviețuiește morții procesului, deci după o
        // repornire tichetul atins cândva pe notificare s-ar redeschide singur.
        if (intent == null || (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        intent.getStringExtra(Notifier.EXTRA_OPEN)?.let { id ->
            intent.removeExtra(Notifier.EXTRA_OPEN)
            notifyListeners("reminderAction", JSObject().put("action", "open").put("id", id), true)
            return
        }
        intent.getStringExtra(Widgets.EXTRA_OPEN)?.let { id ->
            intent.removeExtra(Widgets.EXTRA_OPEN)
            notifyListeners("widget", JSObject().put("kind", "open").put("id", id), true)
            return
        }
        if (intent.getBooleanExtra(Widgets.EXTRA_QUICK, false)) {
            intent.removeExtra(Widgets.EXTRA_QUICK)
            notifyListeners("widget", JSObject().put("kind", "quick"), true)
        }
    }
```

Metode noi:

```kotlin
    @PluginMethod fun setAgenda(call: PluginCall) {
        val items = call.getArray("items", JSArray())!!
        val readAt = call.data.optLong("readAt", 0L)   // `optLong`: vezi `setReminders`
        val list = AgendaList((0 until items.length()).mapNotNull { Json.agendaItemFromJson(items.getJSONObject(it)) }, readAt)
        PlanStore.edit(context) { s -> s.copy(agendaPage = list) to Unit }
        Widgets.refresh(context)
        call.resolve()
    }

    /** Pagina a închis ce deschisese widget-ul: omul se întoarce pe ecranul de start, nu pe alt ecran al aplicației. */
    @PluginMethod fun leave(call: PluginCall) {
        activity?.runOnUiThread { activity?.moveTaskToBack(true) }
        call.resolve()
    }

    /**
     * Tastatura pentru foaia rapidă deschisă din widget: focusul din pagină nu
     * vine dintr-un gest în pagină, iar WebView-ul poate refuza să o ridice.
     */
    @PluginMethod fun showKeyboard(call: PluginCall) {
        activity?.runOnUiThread {
            val web = bridge?.webView ?: return@runOnUiThread
            web.requestFocus()
            (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(web, InputMethodManager.SHOW_IMPLICIT)
        }
        call.resolve()
    }
```

Importuri: `android.view.inputmethod.InputMethodManager`, `android.content.Context` (dacă lipsește), `ro.horizontal.app.core.AgendaList`.

În `signOut` (deja golește planul prin `PlanStore.clear`), adaugă `Widgets.refresh(context)` după golire, ca widget-ul să treacă pe „Deschide aplicația".

- [ ] **Step 6: Compilează și rulează testele**

Run: `npm run android:test && (source mobile/scripts/env.sh && cd mobile/android && ./gradlew --quiet compileReleaseKotlin)`
Expected: PASS, compilare curată.

- [ ] **Step 7: Commit**

```bash
git add mobile/android/app/src/main/java/ro/horizontal/app/
git commit -m "feat(widget): agenda în stare, citire nativă pe due_at, plugin API 2"
```

---

### Task 4: Desenul — cele două widget-uri

**Files:**
- Modify: `mobile/android/app/src/main/java/ro/horizontal/app/Widgets.kt` (corpul `refresh` + alarma de la miezul nopții)
- Create: `mobile/android/app/src/main/java/ro/horizontal/app/AgendaWidget.kt` (provider + randare)
- Create: `mobile/android/app/src/main/java/ro/horizontal/app/QuickWidget.kt`
- Create: `mobile/android/app/src/main/java/ro/horizontal/app/WidgetTapActivity.kt`
- Create: `mobile/android/app/src/main/res/layout/widget_agenda.xml`, `widget_agenda_section.xml`, `widget_agenda_row.xml`, `widget_quick.xml`
- Create: `mobile/android/app/src/main/res/drawable/widget_bg.xml`, `widget_quick_bg.xml`, `ic_widget_plus.xml`, `ic_widget_refresh.xml`, `ic_widget_repeat.xml`, `ic_widget_bell.xml`
- Create: `mobile/android/app/src/main/res/values/widget.xml`, `values-night/widget.xml`, `values-v31/widget_bools.xml`, `values/widget_bools.xml`
- Create: `mobile/android/app/src/main/res/xml/widget_agenda_info.xml`, `widget_quick_info.xml`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Modify: `mobile/android/app/build.gradle` (`versionCode 4`)

**Interfaces:**
- Consumes: Task 2 (`agendaState`, `sectionLabel`, `rowMeta`), Task 3 (`PlanStore.State.agenda*`, `Widgets.EXTRA_*`), `Actions.dispatch`, `NativeSession.isSignedIn`, `SyncWorker.now`.
- Produces: widget-urile instalabile; `Widgets.refresh(ctx)` desenează toate instanțele.

Nota despre fonturi: `RemoteViews` se umflă în procesul launcher-ului; fonturile din `res/font` nu sunt garantate acolo pe toate launcher-ele (HyperOS e unul nestandard). v1 folosește `serif` (Noto Serif) pe titluri și `monospace` pe etichete/ore — se citesc la fel ca în aplicație (regula „serif pentru limbă, mono pentru cifre"). Literata din resurse poate fi o probă ulterioară.

- [ ] **Step 1: Culori și bool-uri**

`res/values/widget.xml` (tema deschisă = jetoanele `[data-theme='light']`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Jetoanele aplicației (src/styles.css), tema deschisă. Tema închisă: values-night. -->
<resources>
    <color name="w_surface">#FFFFFF</color>
    <color name="w_surface2">#F0F4F8</color>
    <color name="w_txt">#29343A</color>
    <color name="w_txt_dim">#566168</color>
    <color name="w_txt_faint">#717C84</color>
    <color name="w_accent">#1A237E</color>
    <color name="w_on_accent">#F7F9FC</color>
    <color name="w_blocked">#A0333F</color>
    <color name="w_sep">#1429343A</color>
</resources>
```

`res/values-night/widget.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="w_surface">#16161A</color>
    <color name="w_surface2">#1E1E23</color>
    <color name="w_txt">#FAFAF9</color>
    <color name="w_txt_dim">#9C9CA2</color>
    <color name="w_txt_faint">#6B6B70</color>
    <color name="w_accent">#818CF8</color>
    <color name="w_on_accent">#0B0B0E</color>
    <color name="w_blocked">#DF8B84</color>
    <color name="w_sep">#0FFFFFFF</color>
</resources>
```

`res/values/widget_bools.xml`: `<resources><bool name="widget_agenda_enabled">false</bool></resources>`
`res/values-v31/widget_bools.xml`: `<resources><bool name="widget_agenda_enabled">true</bool></resources>`

- [ ] **Step 2: Drawables**

`drawable/widget_bg.xml`:

```xml
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/w_surface" />
    <corners android:radius="16dp" />
</shape>
```

`drawable/widget_quick_bg.xml` — la fel, cu `@color/w_accent`.

Iconițe (lucide, 24×24, `stroke` → `strokeColor`, `strokeWidth="2"`, `strokeLineCap="round"`, `strokeLineJoin="round"`, `fillColor="#00000000"`, `android:tint` pus din layout):

```xml
<!-- ic_widget_plus.xml -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:pathData="M12,5v14M5,12h14" android:strokeColor="#FFFFFFFF" android:strokeWidth="2.2" android:strokeLineCap="round" android:fillColor="#00000000" />
</vector>
```

`ic_widget_refresh.xml`: căile `M21,12a9,9 0,1 1,-2.64 -6.36` și `M21,3v6h-6`.
`ic_widget_repeat.xml`: `M17,2l4,4 -4,4`, `M3,11v-1a4,4 0,0 1,4 -4h14`, `M7,22l-4,-4 4,-4`, `M21,13v1a4,4 0,0 1,-4 4H3`.
`ic_widget_bell.xml`: `M6,8a6,6 0,0 1,12 0c0,7 3,9 3,9H3s3,-2 3,-9`, `M10.3,21a1.94,1.94 0,0 0,3.4 0`.
(Aceleași căi ca în `prototype-widget.html`; fiecare `path` cu atributele de stroke de mai sus.)

- [ ] **Step 3: Layout-uri**

`layout/widget_agenda.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@android:id/background"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:background="@drawable/widget_bg" android:clipToOutline="true">

    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content"
        android:orientation="horizontal" android:gravity="center_vertical"
        android:paddingStart="16dp" android:paddingEnd="8dp" android:paddingTop="10dp" android:paddingBottom="4dp">
        <TextView android:id="@+id/w_brand" android:layout_width="0dp" android:layout_weight="1" android:layout_height="wrap_content"
            android:fontFamily="serif" android:textStyle="bold" android:textSize="16sp" android:textColor="@color/w_txt" android:text="Horizontal" />
        <TextView android:id="@+id/w_count" android:layout_width="wrap_content" android:layout_height="wrap_content"
            android:fontFamily="monospace" android:textSize="11sp" android:textColor="@color/w_txt_faint" android:layout_marginEnd="8dp" />
        <ImageView android:id="@+id/w_refresh" android:layout_width="36dp" android:layout_height="36dp" android:padding="9dp"
            android:src="@drawable/ic_widget_refresh" android:tint="@color/w_txt_dim" android:contentDescription="Reîmprospătează" />
        <ImageView android:id="@+id/w_add" android:layout_width="36dp" android:layout_height="36dp" android:padding="9dp" android:layout_marginStart="4dp"
            android:background="@drawable/widget_quick_bg" android:src="@drawable/ic_widget_plus" android:tint="@color/w_on_accent" android:contentDescription="Adaugă" />
    </LinearLayout>

    <ListView android:id="@+id/w_list" android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1"
        android:divider="@null" android:scrollbars="none" android:paddingBottom="8dp" />

    <TextView android:id="@+id/w_empty" android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1"
        android:gravity="center" android:padding="16dp" android:fontFamily="serif" android:textSize="15sp"
        android:textColor="@color/w_txt_dim" android:visibility="gone" />
</LinearLayout>
```

`layout/widget_agenda_section.xml`:

```xml
<TextView xmlns:android="http://schemas.android.com/apk/res/android" android:id="@+id/s_label"
    android:layout_width="match_parent" android:layout_height="wrap_content"
    android:paddingStart="16dp" android:paddingEnd="16dp" android:paddingTop="14dp" android:paddingBottom="6dp"
    android:fontFamily="monospace" android:textStyle="bold" android:textSize="11sp" android:letterSpacing="0.08"
    android:textColor="@color/w_txt_dim" />
```

`layout/widget_agenda_row.xml`:

```xml
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:id="@+id/r_root"
    android:layout_width="match_parent" android:layout_height="wrap_content" android:minHeight="52dp"
    android:orientation="horizontal" android:gravity="center_vertical"
    android:paddingStart="8dp" android:paddingEnd="16dp" android:paddingTop="6dp" android:paddingBottom="6dp">
    <CheckBox android:id="@+id/r_check" android:layout_width="40dp" android:layout_height="40dp" android:checked="false"
        android:buttonTint="@color/w_txt_faint" android:contentDescription="Gata" />
    <LinearLayout android:layout_width="0dp" android:layout_weight="1" android:layout_height="wrap_content"
        android:orientation="vertical" android:layout_marginStart="4dp">
        <TextView android:id="@+id/r_title" android:layout_width="match_parent" android:layout_height="wrap_content"
            android:fontFamily="serif" android:textSize="15sp" android:textColor="@color/w_txt" android:maxLines="1" android:ellipsize="end" />
        <TextView android:id="@+id/r_project" android:layout_width="match_parent" android:layout_height="wrap_content"
            android:fontFamily="monospace" android:textSize="11sp" android:textColor="@color/w_txt_faint" android:maxLines="1" android:ellipsize="end" />
    </LinearLayout>
    <TextView android:id="@+id/r_meta" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:fontFamily="monospace" android:textSize="12sp" android:textColor="@color/w_txt_dim" android:layout_marginStart="8dp" />
    <ImageView android:id="@+id/r_repeat" android:layout_width="14dp" android:layout_height="14dp" android:layout_marginStart="4dp"
        android:src="@drawable/ic_widget_repeat" android:tint="@color/w_txt_dim" android:visibility="gone" />
    <ImageView android:id="@+id/r_bell" android:layout_width="14dp" android:layout_height="14dp" android:layout_marginStart="4dp"
        android:src="@drawable/ic_widget_bell" android:tint="@color/w_txt_dim" android:visibility="gone" />
</LinearLayout>
```

`layout/widget_quick.xml`:

```xml
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android" android:id="@+id/q_root"
    android:layout_width="match_parent" android:layout_height="match_parent">
    <ImageView android:layout_width="56dp" android:layout_height="56dp" android:layout_gravity="center" android:padding="15dp"
        android:background="@drawable/widget_quick_bg" android:src="@drawable/ic_widget_plus" android:tint="@color/w_on_accent"
        android:contentDescription="Adaugă o sarcină" />
</FrameLayout>
```

- [ ] **Step 4: Metadate widget** — `xml/widget_agenda_info.xml`:

```xml
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp" android:minHeight="110dp"
    android:targetCellWidth="4" android:targetCellHeight="4"
    android:minResizeWidth="180dp" android:minResizeHeight="110dp"
    android:resizeMode="horizontal|vertical" android:updatePeriodMillis="0"
    android:initialLayout="@layout/widget_agenda" android:previewLayout="@layout/widget_agenda"
    android:widgetCategory="home_screen" android:description="@string/widget_agenda_desc" />
```

`xml/widget_quick_info.xml`: același tipar, `minWidth/minHeight="40dp"`, `targetCellWidth/Height="1"`, `resizeMode="none"`, `initialLayout="@layout/widget_quick"`, `description="@string/widget_quick_desc"`.

În `res/values/strings.xml` adaugă:
`<string name="widget_agenda_desc">Restanțele și următoarele 7 zile, cu bifă</string>`
`<string name="widget_quick_desc">Adaugă o sarcină</string>`

- [ ] **Step 5: `WidgetTapActivity.kt`** — ținta comună a rândurilor din listă (o colecție are un SINGUR șablon de `PendingIntent`, deci bifa și deschiderea trec prin același loc; o activitate, nu un receiver, fiindcă un receiver n-are voie să pornească `MainActivity` din fundal pe Android 12+):

```kotlin
package ro.horizontal.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import ro.horizontal.app.core.NativeAction
import java.util.UUID

/**
 * Atingere pe un rând al agendei: fără interfață, se închide imediat. „Gata" pune
 * acțiunea în coada nativă (aceeași ca butonul din notificare, cu garda pe
 * `prevDueAt`); fără sesiune nativă n-ar pleca niciodată, deci deschide tichetul.
 */
class WidgetTapActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra(EXTRA_ID)
        if (id != null) when {
            intent.getStringExtra(EXTRA_KIND) == KIND_DONE && NativeSession.isSignedIn(this) ->
                Actions.dispatch(this, NativeAction(
                    uid = UUID.randomUUID().toString(), kind = NativeAction.Kind.DONE, id = id,
                    prevDueAt = intent.getStringExtra(EXTRA_DUE), title = intent.getStringExtra(EXTRA_TITLE) ?: "", body = "",
                    allDay = intent.getBooleanExtra(EXTRA_ALL_DAY, false), createdAt = System.currentTimeMillis(),
                ))
            else -> startActivity(Intent(this, MainActivity::class.java).putExtra(Widgets.EXTRA_OPEN, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }

    companion object {
        const val EXTRA_KIND = "kind"; const val EXTRA_ID = "id"; const val EXTRA_DUE = "dueAt"
        const val EXTRA_TITLE = "title"; const val EXTRA_ALL_DAY = "allDay"
        const val KIND_DONE = "done"; const val KIND_OPEN = "open"
    }
}
```

Verifică semnătura `NativeAction` în `core/Plan.kt` (parametri numiți ca mai sus) și că `Actions.dispatch` nu cere altceva.

- [ ] **Step 6: `AgendaWidget.kt`**

```kotlin
package ro.horizontal.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import ro.horizontal.app.core.*
import java.time.ZoneId

/** Agenda: restanțe + 7 zile. Desenul e o funcție de `PlanStore` — nicio stare proprie. */
class AgendaWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) { Widgets.refresh(ctx) }

    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            ACTION_REFRESH -> { SyncWorker.now(ctx); Widgets.refresh(ctx) }
            ACTION_MIDNIGHT -> Widgets.refresh(ctx)
            else -> super.onReceive(ctx, intent)
        }
    }

    companion object {
        const val ACTION_REFRESH = "ro.horizontal.app.WIDGET_REFRESH"
        const val ACTION_MIDNIGHT = "ro.horizontal.app.WIDGET_MIDNIGHT"

        fun render(ctx: Context, s: PlanStore.State, now: Long = System.currentTimeMillis()): RemoteViews {
            val zone = ZoneId.systemDefault()
            val v = RemoteViews(ctx.packageName, R.layout.widget_agenda)
            v.setOnClickPendingIntent(R.id.w_brand, Widgets.openApp(ctx))
            v.setOnClickPendingIntent(R.id.w_add, Widgets.quick(ctx))
            v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 1,
                Intent(ctx, AgendaWidget::class.java).setAction(ACTION_REFRESH), PendingIntent.FLAG_IMMUTABLE))

            val state = agendaState(s.agendaPage, s.agendaNative, s.queue, now, zone)
            val empty = when {
                state is AgendaState.NoData -> "Deschide aplicația o dată, ca să apară sarcinile."
                state is AgendaState.Ready && state.count == 0 -> "Nimic restant, nimic azi."
                else -> null
            }
            v.setViewVisibility(R.id.w_list, if (empty == null) View.VISIBLE else View.GONE)
            v.setViewVisibility(R.id.w_empty, if (empty == null) View.GONE else View.VISIBLE)
            v.setTextViewText(R.id.w_empty, empty ?: "")
            v.setTextViewText(R.id.w_count, (state as? AgendaState.Ready)?.count?.takeIf { it > 0 }?.let { "· $it" } ?: "")
            if (state !is AgendaState.Ready || Build.VERSION.SDK_INT < 31) return v

            v.setPendingIntentTemplate(R.id.w_list, PendingIntent.getActivity(ctx, 2,
                Intent(ctx, WidgetTapActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_HISTORY),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            val items = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(2)
            val red = ContextCompat.getColor(ctx, R.color.w_blocked)
            state.sections.forEachIndexed { i, sec ->
                val head = RemoteViews(ctx.packageName, R.layout.widget_agenda_section)
                head.setTextViewText(R.id.s_label, sectionLabel(sec))
                if (sec.overdue) head.setTextColor(R.id.s_label, red)
                else if (sec.offset == 0) head.setTextColor(R.id.s_label, ContextCompat.getColor(ctx, R.color.w_accent))
                items.addItem(-(i + 1).toLong(), head)
                for (it in sec.items) items.addItem(it.id.hashCode().toLong() shl 8, row(ctx, it, sec.overdue, now, zone, red))
            }
            v.setRemoteAdapter(R.id.w_list, items.build())
            return v
        }

        private fun row(ctx: Context, it: AgendaItem, overdue: Boolean, now: Long, zone: ZoneId, red: Int): RemoteViews {
            val r = RemoteViews(ctx.packageName, R.layout.widget_agenda_row)
            r.setTextViewText(R.id.r_title, it.title)
            r.setTextViewText(R.id.r_project, it.project ?: "")
            r.setViewVisibility(R.id.r_project, if (it.project == null) View.GONE else View.VISIBLE)
            r.setTextViewText(R.id.r_meta, rowMeta(it, overdue, now, zone))
            r.setViewVisibility(R.id.r_repeat, if (it.recurring) View.VISIBLE else View.GONE)
            r.setViewVisibility(R.id.r_bell, if (it.hasReminder) View.VISIBLE else View.GONE)
            if (overdue) {
                r.setTextColor(R.id.r_meta, red)
                r.setColorStateList(R.id.r_check, "setButtonTintList", android.content.res.ColorStateList.valueOf(red))
            }
            r.setCompoundButtonChecked(R.id.r_check, false)
            val base = Intent().putExtra(WidgetTapActivity.EXTRA_ID, it.id)
            r.setOnClickFillInIntent(R.id.r_root, Intent(base).putExtra(WidgetTapActivity.EXTRA_KIND, WidgetTapActivity.KIND_OPEN))
            r.setOnCheckedChangeResponse(R.id.r_check, RemoteViews.RemoteResponse.fromFillInIntent(Intent(base)
                .putExtra(WidgetTapActivity.EXTRA_KIND, WidgetTapActivity.KIND_DONE)
                .putExtra(WidgetTapActivity.EXTRA_DUE, it.dueAt).putExtra(WidgetTapActivity.EXTRA_TITLE, it.title)
                .putExtra(WidgetTapActivity.EXTRA_ALL_DAY, it.allDay)))
            return r
        }

        fun ids(ctx: Context): IntArray = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, AgendaWidget::class.java))
    }
}
```

(`shl 8` ține id-urile rândurilor departe de cele negative ale antetelor. `RemoteCollectionItems` și `setOnCheckedChangeResponse` cer API 31 — garda `SDK_INT < 31` și `@bool/widget_agenda_enabled` țin restul; adaugă `@androidx.annotation.RequiresApi(31)` pe `row` dacă lint-ul o cere.)

- [ ] **Step 7: `QuickWidget.kt`**

```kotlin
package ro.horizontal.app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** Butonul 1×1: deschide foaia rapidă. Nu citește nicio stare. */
class QuickWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val v = RemoteViews(ctx.packageName, R.layout.widget_quick)
        v.setOnClickPendingIntent(R.id.q_root, Widgets.quick(ctx))
        mgr.updateAppWidget(ids, v)
    }
}
```

- [ ] **Step 8: `Widgets.kt` complet**

```kotlin
package ro.horizontal.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import java.time.LocalDate
import java.time.ZoneId

/** Widget-urile de pe ecranul de start. `refresh` e chemat din `Engine.reschedule` și din `setAgenda`. */
object Widgets {
    const val EXTRA_OPEN = "hz-widget-open"
    const val EXTRA_QUICK = "hz-widget-quick"

    fun refresh(ctx: Context) {
        val ids = AgendaWidget.ids(ctx)
        if (ids.isEmpty()) return
        val views = AgendaWidget.render(ctx, PlanStore.read(ctx))
        AppWidgetManager.getInstance(ctx).updateAppWidget(ids, views)
        armMidnight(ctx)
    }

    /**
     * La miezul nopții gruparea se schimbă fără date noi („mâine" devine „azi").
     * Inexactă: câteva minute de întârziere în Doze sunt acceptabile, iar alarma
     * exactă e rezervată mementourilor. Același `PendingIntent` → se suprascrie.
     */
    private fun armMidnight(ctx: Context) {
        val zone = ZoneId.systemDefault()
        val at = LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() + 60_000
        val pi = PendingIntent.getBroadcast(ctx, 3, Intent(ctx, AgendaWidget::class.java).setAction(AgendaWidget.ACTION_MIDNIGHT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).set(AlarmManager.RTC, at, pi)
    }

    fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(ctx, 4,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)

    fun quick(ctx: Context): PendingIntent = PendingIntent.getActivity(ctx, 5,
        Intent(ctx, MainActivity::class.java).putExtra(EXTRA_QUICK, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}
```

- [ ] **Step 9: Manifest** — în `<application>`, după `BootReceiver`:

```xml
        <!-- Widget-urile. Agenda doar pe 12+ (bifa din widget = CompoundButton în RemoteViews, API 31). -->
        <receiver android:name=".AgendaWidget" android:exported="true" android:enabled="@bool/widget_agenda_enabled">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_agenda_info" />
        </receiver>
        <receiver android:name=".QuickWidget" android:exported="true">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_quick_info" />
        </receiver>
        <!-- Ținta rândurilor din agendă: fără interfață, nu rămâne în Recente, nu se lipește de sarcina aplicației. -->
        <activity android:name=".WidgetTapActivity" android:exported="false" android:theme="@android:style/Theme.Translucent.NoTitleBar"
            android:excludeFromRecents="true" android:taskAffinity="" android:noHistory="true" android:launchMode="singleInstance" />
```

`ACTION_REFRESH`/`ACTION_MIDNIGHT` vin prin `PendingIntent` explicit (componenta numită), deci nu trebuie în `intent-filter`.

- [ ] **Step 10: `versionCode 4`** în `mobile/android/app/build.gradle`.

- [ ] **Step 11: Build**

Run: `npm run android:test && npm run android:apk`
Expected: PASS + APK construit fără erori.

- [ ] **Step 12: Commit**

```bash
git add mobile/android/app/
git commit -m "feat(widget): widget-urile agendă și quick add (APK v4)"
```

---

### Task 5: Pagina — trimite agenda, primește atingerile, pleacă înapoi

**Files:**
- Modify: `src/lib/androidBridge.ts` (contractul API 2)
- Modify: `src/lib/androidBridge.test.ts` (cheia agendei)
- Modify: `src/components/NativeBridge.tsx`
- Modify: `src/App.tsx` (`openQuick` acceptă un context; ascultă `hz:widget-quick`)

**Interfaces:**
- Consumes: Task 1 (`agendaItems`, `AgendaItem`), Task 3 (metodele pluginului și evenimentul `widget`), `parseTicketPath` (`src/lib/deepLink.ts`), `smartListDueAt` (`src/components/SmartListView.tsx`).
- Produces:
  ```ts
  export const ANDROID_API_WIDGETS = 2
  export type WidgetEvent = { kind: 'open'; id: string } | { kind: 'quick' }
  export function agendaKey(items: AgendaItem[], readAt: number): string
  // HorizontalAndroidPlugin += setAgenda, leave, showKeyboard, addListener('widget', …)
  // window event 'hz:widget-quick'
  ```

- [ ] **Step 1: Testul care pică** — în `src/lib/androidBridge.test.ts`:

```ts
import { agendaKey } from './androidBridge'

describe('agendaKey', () => {
  const item = { id: 'HZ-1', title: 'R', project: null, dueAt: '2026-10-06T07:00:00.000Z', allDay: false, hasReminder: false, recurring: false, urgent: false }
  it('se schimbă cu lista și cu vârsta datelor, nu altfel', () => {
    expect(agendaKey([item], 5)).toBe(agendaKey([{ ...item }], 5))
    expect(agendaKey([item], 5)).not.toBe(agendaKey([item], 6))
    expect(agendaKey([item], 5)).not.toBe(agendaKey([{ ...item, title: 'S' }], 5))
  })
})
```

Run: `npx vitest run src/lib/androidBridge.test.ts` → FAIL (`agendaKey` nu există).

- [ ] **Step 2: Contractul** — în `src/lib/androidBridge.ts`:

```ts
import type { AgendaItem } from './agenda'

/** API 2: widget-urile (`setAgenda`, `leave`, `showKeyboard`, evenimentul `widget`). */
export const ANDROID_API_WIDGETS = 2

/** Atingere pe widget, reținută de cutie până pune pagina ascultătorul. */
export type WidgetEvent = { kind: 'open'; id: string } | { kind: 'quick' }

export function agendaKey(items: AgendaItem[], readAt: number): string {
  return JSON.stringify([readAt, items])
}
```

În `interface HorizontalAndroidPlugin`:

```ts
  setAgenda(o: { items: AgendaItem[]; readAt: number }): Promise<void>
  /** Pagina a închis ce deschisese widget-ul: înapoi pe ecranul de start. */
  leave(): Promise<void>
  showKeyboard(): Promise<void>
  addListener(event: 'widget', fn: (e: WidgetEvent) => void): Promise<Listener>
```

În `buildBridge`: `setAgenda: call('setAgenda'), leave: call('leave'), showKeyboard: call('showKeyboard'),`.

Run: `npx vitest run src/lib/androidBridge.test.ts` → PASS.

- [ ] **Step 3: `App.tsx`** — `openQuick` primește opțional contextul (widget-ul cere „Azi", oricare ar fi ecranul de sub el), și ascultă evenimentul:

```tsx
  const openQuick = (forced?: QuickCtx) => {
    const ctx: QuickCtx | null = forced ?? (smartList
      ? { mode: 'list', defaultDueAt: smartListDueAt(smartList) }
      : project ? { mode: 'project', projectId: project.id, wave: activeWave } : null)
    if (!ctx) return
    flushSync(() => pushSheet({ kind: 'quick-add', ctx }))
    document.querySelector<HTMLInputElement>('.quick-sheet .qa-input')?.focus()
  }
  const openQuickRef = useRef(openQuick); openQuickRef.current = openQuick
  // Widget-ul de pe ecranul de start (NativeBridge): foaia rapidă pe „Azi", ca bara de captură de pe Linux.
  useEffect(() => {
    const on = () => openQuickRef.current({ mode: 'list', defaultDueAt: smartListDueAt('today') })
    window.addEventListener('hz:widget-quick', on)
    return () => window.removeEventListener('hz:widget-quick', on)
  }, [])
```

Verifică apelurile existente `openQuick` (`onClick={… openQuick …}` primește evenimentul de click ca argument!) — schimbă-le în `() => openQuick()`, altfel evenimentul ar fi luat drept context. Verifică valoarea exactă a `SmartListKind` pentru „Azi" (`'today'` sau alta) în `SmartListView.tsx`.

- [ ] **Step 4: `NativeBridge.tsx`** — trei adăugiri.

(a) Versiunea cutiei, o dată:

```tsx
  const [androidApi, setAndroidApi] = useState(0)
  useEffect(() => { if (android) void android.getInfo().then((i) => setAndroidApi(i.api), () => {}) }, [android])
  const widgets = !!android && androidApi >= ANDROID_API_WIDGETS
  const lastAgenda = useRef('')
```

(b) În `send()` din efectul existent, după blocul `if (android) { … setReminders … }`, și adaugă `widgets` în dependențele efectului:

```tsx
      if (android && widgets) {
        const items = agendaItems(all, projects, now)
        const readAt = pageReadAt(syncStatus, repository.sync, now)
        const key = agendaKey(items, readAt)
        if (key !== lastAgenda.current) { lastAgenda.current = key; await android.setAgenda({ items, readAt }).catch(() => { lastAgenda.current = '' }) }
      }
```

(c) Atingerile din widget și întoarcerea pe ecranul de start:

```tsx
  // Ce s-a deschis din widget. Când omul iese de acolo (Back, X, trimite), istoricul
  // face un `popstate` pe un ecran care nu mai e tichet sau foaie: atunci cutia se
  // duce în fundal, ca Back să ducă pe ecranul de start, nu pe ecranul de sub foaie.
  const fromWidget = useRef(false)
  useEffect(() => {
    if (!android || !widgets || !dueLoaded) return
    const sub = android.addListener('widget', (e) => {
      if (e.kind === 'open') {
        run.current({ action: 'open', id: e.id })
      } else {
        window.dispatchEvent(new Event('hz:widget-quick'))
        void android.showKeyboard().catch(() => {})
      }
      fromWidget.current = true
    })
    const onPop = () => {
      if (!fromWidget.current) return
      const st = history.state as { hzSheet?: unknown } | null
      if (parseTicketPath(location.pathname) || st?.hzSheet) return
      fromWidget.current = false
      void android.leave().catch(() => {})
    }
    const onVis = () => { if (document.visibilityState === 'hidden') fromWidget.current = false }
    window.addEventListener('popstate', onPop)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      void sub.then((l) => l.remove()).catch(() => {})
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [android, widgets, dueLoaded])
```

Importuri: `useState`; `agendaItems` din `../lib/agenda`; `ANDROID_API_WIDGETS`, `agendaKey` din `../lib/androidBridge`; `parseTicketPath` din `../lib/deepLink`.

Verifică două lucruri citind codul, nu presupunând: (1) că `run.current({ action: 'open' })` produce un `popstate` pe `/HZ-…` (deci `onPop` îl lasă în pace) — e drumul `open` din `runNativeAction`; (2) ce cheie pune foaia rapidă în `history.state` (`hzSheet: 'quick'` după CLAUDE.md) — `onPop` trebuie să ignore intrarea ei și să plece abia după ce a fost scoasă.

- [ ] **Step 5: Verificare**

Run: `npm test && npm run typecheck && npm run test:nav`
Expected: tot verde. `test:nav` păzește istoricul și foile; în browser `android` e `null`, deci comportamentul nu se schimbă — dacă pică, ai stricat `openQuick` (Step 3).

- [ ] **Step 6: Commit (fără push)**

```bash
git add src/lib/androidBridge.ts src/lib/androidBridge.test.ts src/components/NativeBridge.tsx src/App.tsx
git commit -m "feat(widget): pagina trimite agenda și răspunde la atingerile din widget"
```

---

### Task 6: Livrare și proba pe telefon

**Files:**
- Modify: `CLAUDE.md` (secțiune scurtă în „Aplicația de Android")
- Modify: `docs/superpowers/specs/2026-10-06-widget-android-design.md` (două abateri: fonturi de sistem; întoarcerea decisă de pagină prin `leave()`)

- [ ] **Step 1: Toate testele**

Run: `npm test && npm run typecheck && npm run android:test && npm run test:nav`
Expected: tot verde. Nu s-a atins `src/sw.ts`/`src/pwa.ts`/VitePWA → `test:upgrade` nu e necesar.

- [ ] **Step 2: Documentație pentru agent** — în `CLAUDE.md`, la finalul secțiunii „Aplicația de Android", un paragraf de ~10 rânduri: două widget-uri (`AgendaWidget`, `QuickWidget`); regula în `core/Agenda.kt` = `buildSmartLists`, fixtures `src/lib/agenda.fixtures.json`; două surse (`setAgenda` + citirea din `SyncWorker` pe `due_at`), câștigă `readAt`; bifa = `Actions.dispatch` prin `WidgetTapActivity` (un singur șablon de `PendingIntent` pe colecție, activitate nu receiver); `Widgets.refresh` din `Engine.reschedule`; alarma de la miezul nopții; `leave()` din `NativeBridge` la primul `popstate` care nu e tichet/foaie; agenda doar pe 12+. Actualizează și spec-ul cu cele două abateri.

- [ ] **Step 3: Commit + push (publicare pagină)**

Pagina e inofensivă pe APK-ul vechi (verifică `api >= 2`). Cere confirmarea omului înainte de push.

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-06-widget-android-design.md
git commit -m "docs(widget): note pentru agent"
git push origin master
```

- [ ] **Step 4: Anunță proba ÎNAINTE** (memorie: probe pe dispozitive) — spune-i omului: se instalează un APK nou (confirmare pe telefon, „Instalare prin USB"); aplicația se repornește; nu se pierde login-ul; apoi el adaugă cele două widget-uri din meniul de widget-uri al ecranului de start.

- [ ] **Step 5: Instalează**

Run: `npm run android:apk && npm run android:install`

- [ ] **Step 6: Lista de probă pe telefon** (cu omul; bifează fiecare):

1. Widget-ul de agendă apare în lista de widget-uri; arată restanțele în roșu sus, „AZI · …" în accent, apoi zilele.
2. Bifă pe o sarcină simplă → dispare imediat; în aplicație e bifată după câteva secunde.
3. Bifă în modul avion → dispare; la revenirea rețelei se trimite (verifică în aplicație).
4. Bifă pe o recurentă → dispare, reapare la data următoare după sincronizare; în aplicație a sărit O SINGURĂ dată.
5. Atingere pe rând → se deschide tichetul; Back → ecranul de start (cu aplicația deja deschisă pe alt ecran, și cu aplicația închisă).
6. Butonul 1×1 și [+] → foaia rapidă cu **tastatura sus**. Dacă nu urcă: `node mobile/scripts/cdp.mjs 'document.activeElement.className'` — focusul e în câmp? Raportează, nu ghici.
7. Trimite din foaia rapidă → înapoi pe ecranul de start; sarcina apare în widget.
8. ⟳ → se rotește/actualizează.
9. Temă închisă și deschisă (schimbă tema telefonului) — nimic invizibil.
10. Sarcină creată pe laptop → apare în widget la ⟳.
11. A doua zi dimineață: „Mâine" de ieri e acum „Azi" (sau forțează: schimbă ora telefonului peste miezul nopții, apoi înapoi).

- [ ] **Step 7: Raportează** — ce a mers, ce nu, cu dovezi (capturi, ieșirea `cdp.mjs`). Orice punct picat = buclă de debugging, nu „aproape gata".
