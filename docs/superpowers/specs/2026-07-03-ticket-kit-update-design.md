# ticket-kit --update: Design Spec

**Date:** 2026-07-03  
**Scope:** Add `--update` command to `ai-client.mjs` and `PATCH /api/tickets/:id` to the Cloudflare Pages function.

---

## Summary

Extend ticket-kit with the ability to partially update an existing ticket. Only fields explicitly passed as flags are sent and updated — absent flags leave the corresponding DB columns untouched. Dependencies (`deps`) and QA arrays (`selectors`, `scenarios`) use replace-total semantics.

---

## Server — `functions/api/tickets/[id].ts`

Add `onRequestPatch` to the existing file (alongside `onRequestGet`).

### Accepted body fields (all optional)

| Body key     | DB column       | Type             |
|--------------|-----------------|------------------|
| `title`      | `title`         | string           |
| `desc`       | `details`       | string           |
| `theme`      | `theme`         | string \| null   |
| `wave`       | `wave`          | number           |
| `done`       | `done`          | boolean          |
| `notes`      | `notes`         | string           |
| `selectors`  | `selectors`     | any[] (JSON)     |
| `scenarios`  | `scenarios`     | any[] (JSON)     |
| `deps`       | `dependencies`  | string[] (relation) |

### Handler flow

1. Parse JSON body. If body contains no known updatable fields → `400 { error: "no_updatable_fields" }`.
2. If `title` is present:
   - Fetch current `wave` from DB (needed if `wave` not in body).
   - Dup-check: `ilike` match on `title` + same `wave` + different `id` → `409 { error: "duplicate_title", existing_id }`.
3. If `deps` is present and non-empty: validate all IDs exist → `422 { error: "invalid_deps", unknown: [...] }`.
4. Build `issueUpdate` object from body fields (excluding `deps`). If non-empty → `PATCH /rest/v1/issues?id=eq.:id`.
5. If `deps` is present:
   - `DELETE /rest/v1/dependencies?issue_id=eq.:id`
   - If `deps.length > 0`: `POST /rest/v1/dependencies` with new rows.
6. Return `200 { id, updated: [list of changed field keys] }`.

### Error table

| Condition                            | Status | Body                                        |
|--------------------------------------|--------|---------------------------------------------|
| No updatable fields in body          | 400    | `{ error: "no_updatable_fields" }`          |
| Ticket not found                     | 404    | `{ error: "not_found" }`                    |
| Rename → duplicate title in wave     | 409    | `{ error: "duplicate_title", existing_id }` |
| `deps` contains unknown IDs         | 422    | `{ error: "invalid_deps", unknown: [...] }` |
| DB error                             | 502    | `{ error: "db_error" }`                     |

### Atomicity note

PATCH on `issues` and the DELETE+INSERT on `dependencies` are two separate Supabase REST calls (no transaction). If INSERT fails after DELETE, deps are left empty. Acceptable for a CLI tool — caller can re-run `--update --deps ...` to recover.

---

## Client — `ticket-kit/ai-client.mjs`

Add `update()` function and `--update` branch in the dispatch block.

### Usage

```bash
# Rename
node ticket-kit/ai-client.mjs --update --id KATA-03 --title "New title"

# Change wave and mark done
node ticket-kit/ai-client.mjs --update --id KATA-03 --wave 2 --done true

# Replace deps (comma-separated)
node ticket-kit/ai-client.mjs --update --id KATA-03 --deps KATA-01,KATA-02

# Clear all deps
node ticket-kit/ai-client.mjs --update --id KATA-03 --deps ""

# Update QA fields
node ticket-kit/ai-client.mjs --update --id KATA-03 \
  --selectors '["mobile","desktop"]' \
  --scenarios '[{"given":"user is logged in","when":"visits /dashboard","then":"sees projects"}]'
```

### Flag → body mapping

| Flag           | Body key    | Parsing                          |
|----------------|-------------|----------------------------------|
| `--title`      | `title`     | string as-is                     |
| `--desc`       | `desc`      | string as-is                     |
| `--theme`      | `theme`     | string as-is                     |
| `--wave`       | `wave`      | `Number()`                       |
| `--done`       | `done`      | `=== "true"` → boolean           |
| `--notes`      | `notes`     | string as-is                     |
| `--deps`       | `deps`      | split on `,`, trim, filter empty |
| `--selectors`  | `selectors` | `JSON.parse()` — exit 1 if invalid |
| `--scenarios`  | `scenarios` | `JSON.parse()` — exit 1 if invalid |

Only flags present in `process.argv` are included in the body.

### Output

```
updated: KATA-03    # 200 success
duplicate: KATA-07  # 409 rename conflict
not_found           # 404
Error 422: {...}    # invalid deps
Error 400: {...}    # no updatable fields / bad request
```

### Validation (local, before fetch)

- `--id` missing → print usage, exit 1.
- No updatable flag present → print usage, exit 1.
- `--selectors` / `--scenarios` not valid JSON → print parse error, exit 1.

---

## Files changed

| File | Change |
|------|--------|
| `functions/api/tickets/[id].ts` | Add `onRequestPatch` |
| `ticket-kit/ai-client.mjs` | Add `update()` function + dispatch branch |
| `ticket-kit/README.md` | Document `--update` command and examples |
