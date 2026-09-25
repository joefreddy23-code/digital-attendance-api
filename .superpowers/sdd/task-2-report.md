# Task 2 Report: Update `upsertEmployeeWeb` Lambda for required `empId` + `isCreated` email

## Status

**DONE_WITH_CONCERNS** — Lambda changes match the task brief. Manual end-to-end smoke (Bearer token, SMTP, updated `web_upsertEmployee` on MySQL) was not run in this session.

## Objective

Align `Web-app/upsertEmployeeWeb/index.mjs` with Task 1 stored procedure contract: require client `empId`, always pass a generated password into `CALL web_upsertEmployee`, and send the welcome email only when `Number(isCreated) === 1`.

## Work performed

### Step 1: Require `empId` validation

After existing body field checks (following `locationIds` validation), added:

- `parsedEmpId = Number(empId)`
- `400` when `!Number.isInteger(parsedEmpId) || parsedEmpId <= 0` with message `"empId is required and must be a valid positive integer"`

Covers omitted `empId`, `0`, negative values, and non-integers (e.g. `"abc"`, `1.5`).

### Step 2: Password generation and SP call

Removed:

- `isCreate = !empId || empId === 0`
- Conditional `temporaryPassword` (`null` on update path)

Replaced with:

- `const temporaryPassword = generateTemporaryPassword();` on every request
- First SP argument: `parsedEmpId` instead of `empId || null`

Update requests still generate a password in Lambda; Task 1 SP ignores password on update, so DB password behavior is unchanged.

### Step 3: Gate welcome email on `isCreated`

After reading `employeeResult` from `results[0]?.[0]`:

```javascript
const isCreated = Number(employeeResult.isCreated) === 1;
if (isCreated) { /* existing sendMail + 500 on failure */ }
```

Replaces prior `if (isCreate)` block. `sendMail` HTML and email-failure `500` response unchanged.

### Step 4: Manual smoke (local)

| Check | Result |
|-------|--------|
| `node --check index.mjs` | Pass (exit 0) |
| Start server / curl create-update-omit empId | **Deferred** — no valid Bearer token supplied; no confirmation that updated SP is applied on target MySQL |
| Import side effect | Importing `index.mjs` still runs `app.listen(3012)` (pre-existing); observed message `Upsert Employee API running on port 3012` when loading module for a quick handler call |

**Planned manual steps (human partner):** Task brief Step 4 — start from `Web-app/upsertEmployeeWeb`, POST with token to `http://localhost:3012/web/upsertemployee`, verify create email + `isCreated`, repeat empId without email, omit empId → `400`.

### Step 5: Git commit

**None** — per global constraint (do not commit unless user asks).

## Self-review

| Check | Result |
|-------|--------|
| Brief Step 1 empId validation | Yes — lines ~418–428 |
| Brief Step 2 always generate password | Yes — line ~469 |
| Brief Step 2 `parsedEmpId` in CALL | Yes — line ~481 |
| Brief Step 3 `Number(isCreated) === 1` | Yes — lines ~515–518 |
| Email block unchanged inside `if (isCreated)` | Yes |
| No remaining `isCreate` references | Yes |
| Depends on Task 1 SP + `isCreated` column in result set | Assumed applied by human |

## Code references (post-change)

- Validation: `Web-app/upsertEmployeeWeb/index.mjs` ~418–428
- SP call: ~469–492
- Email gate: ~515–565

## Concerns / follow-up

1. **Integration not verified:** Welcome email, `isCreated` from MySQL, and omit-empId `400` after auth should be re-checked once Task 1 SQL is applied and a valid token is available.
2. **Password generated on every request:** Intentional per brief; only used by SP on insert path.
3. **Module import starts Express:** Unchanged from prior file; local tests that `import('./index.mjs')` bind port 3012.

## Files touched

- `Web-app/upsertEmployeeWeb/index.mjs` — modified
- `.superpowers/sdd/task-2-report.md` — this report
