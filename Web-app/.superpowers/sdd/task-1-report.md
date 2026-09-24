# Task 1 Report: MySQL stored procedure `web_upsertEmployee`

## Status

**DONE**

## Commits

None (per plan; no git repo).

## Deliverable

Created `docs/superpowers/plans/sql/web_upsertEmployee.sql` with SQL copied verbatim from `.superpowers/sdd/task-1-brief.md` (DROP + DELIMITER-wrapped CREATE with 9 IN parameters).

## Apply to database

- **Target:** `employee_attendance` on `localhost:3306` (credentials from `forgetPassWeb/.env` via dotenv).
- **mysql CLI:** Not available on PATH (Windows).
- **Applied via:** Node.js `mysql2` from `upsertEmployeeWeb` (DROP + CREATE body without DELIMITER wrappers).

## Smoke-check results

| Check | Result |
|-------|--------|
| Connection | OK |
| Procedure exists | OK (`SHOW CREATE PROCEDURE web_upsertEmployee`) |
| Parameter count | 9 |
| Last parameter | `p_password` |
| INSERT uses `MD5(p_password)` | Yes (verified in `Create Procedure` text) |

## Self-review

1. **Create-only password:** INSERT sets `password = MD5(p_password)`; UPDATE branch does not include `password` column. ✓
2. **Validation:** New employee (NULL/0 `p_empId`) requires non-empty `p_password`; otherwise `SIGNAL` with rollback. ✓
3. **Update path:** Employee must exist; otherwise `Employee not found`. ✓
4. **Location logic:** Unchanged from brief (`DELETE` + `INSERT` with `JSON_TABLE` on `p_locationIds`). ✓
5. **No extra columns or invented behavior.** ✓
6. **SQL file:** Matches brief exactly (including DELIMITER blocks for Workbench/CLI apply). ✓

## Concerns

- Local apply used `mysql2` because `mysql` CLI was not installed. For other environments, run:
  `mysql -u root -p employee_attendance < docs/superpowers/plans/sql/web_upsertEmployee.sql`

## Test summary

Applied procedure to live DB; `information_schema.PARAMETERS` shows 9 params ending in `p_password`; procedure definition contains `MD5(p_password)`.

## Files touched

- `docs/superpowers/plans/sql/web_upsertEmployee.sql` (created)
- `.superpowers/sdd/task-1-report.md` (this file)
