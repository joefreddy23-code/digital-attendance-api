# Task 1 Report: Apply updated `web_upsertEmployee` SQL

## Status

**DONE** — `Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql` matches the approved design spec “Full replacement script” byte-for-byte (normalized line endings). No file edits were required. MySQL apply and smoke tests are deferred to the human partner (no live DB / no `mysql` CLI required for this task).

## Objective

Ensure the SQL artifact for `web_upsertEmployee` implements client-provided `empId` upsert behavior: require `p_empId`, insert with `id = p_empId` when missing, update when present (password not updated on update path), location sync unchanged, final result set includes `isCreated`.

## Work performed

### Step 1: Compare artifact to approved spec

- **Spec:** `Web-app/docs/superpowers/specs/2026-09-24-upsert-employee-client-empid-design.md` (section **Full replacement script**)
- **Artifact:** `Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql`
- **Method:** Extracted the fenced SQL block from the spec and compared to the artifact with Node (normalize `\r\n` → `\n`, trim trailing whitespace).
- **Result:** `MATCH` — no drift; no overwrite needed.

### Step 2: Apply in MySQL

- **Status:** **Deferred** (per task instructions: user owns DB apply).
- **Intended command:**

  ```bash
  mysql -u root -p employee_attendance < Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql
  ```

### Step 3: Smoke-check signature and `isCreated`

- **Status:** **Deferred** (depends on Step 2).
- **Planned verification:**
  - `SHOW CREATE PROCEDURE web_upsertEmployee\G` — expect required `p_empId`, INSERT with `id` first, final `SELECT` with `v_isCreated AS isCreated`.
  - Optional `CALL web_upsertEmployee(...)` create/update pair from task brief (expect `isCreated = 1` then `0`; password unchanged on update).

### Step 4: Git commit

- **Commits created:** None — commit deferred (global constraint: only commit when user asks).

## Self-review

| Check | Result |
|-------|--------|
| Path matches plan | Yes — `Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql` |
| Matches spec full replacement script | Yes (automated compare) |
| `DROP PROCEDURE IF EXISTS` + `DELIMITER` wrapper | Present |
| Rejects NULL/0 `p_empId` | `SIGNAL` `'Employee ID is required'` |
| Insert path uses client `id` | `INSERT ... (id, ...) VALUES (p_empId, ...)` |
| Create requires password | `SIGNAL` if null/empty; `MD5(p_password)` on insert |
| Update path | Updates profile fields; does not touch `password` |
| `v_isCreated` | `1` on insert, `0` on update |
| Location sync | `DELETE` / `INSERT` via `JSON_TABLE` on `p_locationIds` |
| Result set | `empId`, `'Employee saved successfully'`, `isCreated` |
| Applied to MySQL | Not run (user-owned) |
| Smoke test | Not run |

## Behavioral summary (for apply verification)

1. **Missing employee id:** `p_empId IS NULL OR p_empId = 0` → rollback + signal.
2. **New employee:** row not found for `id = p_empId` → insert with explicit `id`, set `v_isCreated = 1`.
3. **Existing employee:** update non-password columns, set `v_isCreated = 0`.
4. **Locations:** sync `employeelocation` for `v_empId`, then commit and return result set.

## Concerns / follow-up

1. **DB apply not executed here:** Partner should run the SQL file against `employee_attendance` and run brief smoke checks before Lambda Task 2+ relies on `isCreated`.
2. **Assumption from spec:** `employee.id` must accept explicit inserts; client-chosen ids must not collide with existing rows (handled by existence check before insert).

## Files touched (this task)

- `Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql` — verified only; unchanged
- `.superpowers/sdd/task-1-report.md` — this report
