### Task 1: Apply updated `web_upsertEmployee` SQL

**Files:**
- Create/overwrite: `Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql`
- Apply manually in MySQL Workbench / CLI against `employee_attendance`

**Interfaces:**
- Consumes: existing `employee`, `employeelocation` tables
- Produces: `CALL web_upsertEmployee(p_empId, p_fullName, p_joiningDate, p_email, p_mobileNumber, p_roleId, p_designationId, p_clientId, p_locationIds, p_password, p_profileImgPath)` returning `{ empId, message, isCreated }`

- [ ] **Step 1: Ensure SQL file matches the approved spec script**

File must contain the full DROP + CREATE from the spec (require `p_empId`, insert with `id = p_empId` when missing, update when present, final `SELECT` includes `v_isCreated AS isCreated`). Path:

`Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql`

- [ ] **Step 2: Apply in MySQL**

In Workbench: open the SQL file and execute against `employee_attendance`.

Or CLI:

```bash
mysql -u root -p employee_attendance < Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql
```

Expected: procedure recreated; no errors.

- [ ] **Step 3: Smoke-check signature and `isCreated`**

```sql
SHOW CREATE PROCEDURE web_upsertEmployee\G
```

Expected: body requires employee ID; INSERT lists `id` as first column; final SELECT includes `isCreated`.

Optional existence check:

```sql
-- Use an unused id in your DB; adjust other args to valid FKs
CALL web_upsertEmployee(
  999001, 'SP Smoke Create', '2026-09-24', 'sp.smoke.create@example.com',
  '9999990001', 1, 1, 1, '1', 'TempPass12!@', 'https://example.com/p.png'
);
-- Expect isCreated = 1

CALL web_upsertEmployee(
  999001, 'SP Smoke Update', '2026-09-24', 'sp.smoke.create@example.com',
  '9999990001', 1, 1, 1, '1', 'IgnoredPass!!', 'https://example.com/p2.png'
);
-- Expect isCreated = 0; password column unchanged from first call
```

- [ ] **Step 4: Stop â€” user applies SP; do not commit unless asked**

---
