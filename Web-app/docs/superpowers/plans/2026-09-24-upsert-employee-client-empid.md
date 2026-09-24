# Upsert Employee Client `empId` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require client-provided `empId` for both create and update in `upsertEmployeeWeb`, store it as `employee.id` on insert, and send welcome email only when the SP reports `isCreated = 1`.

**Architecture:** Single SP `web_upsertEmployee` branches on existence of `employee.id = p_empId` (insert with explicit `id` vs update). Lambda always generates a temporary password and passes it; SP hashes it only on insert. Lambda sends welcome email only when result `isCreated` is 1. No separate lookup SP.

**Tech Stack:** Node.js (ESM) Express Lambda handler, `mysql2/promise`, nodemailer, MySQL stored procedures.

**Spec:** `Web-app/docs/superpowers/specs/2026-09-24-upsert-employee-client-empid-design.md`

## Global Constraints

- Client `empId` maps to `employee.id` only (not a separate `empId` column).
- Approach B: no separate existence SP; SP returns `isCreated`.
- Password always generated in Lambda; used only on insert inside SP.
- Do not update password on existing employees.
- Location assignment logic stays unchanged.
- Do not commit unless the user explicitly asks.

---

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

- [ ] **Step 4: Stop — user applies SP; do not commit unless asked**

---

### Task 2: Update `upsertEmployeeWeb` Lambda for required `empId` + `isCreated` email

**Files:**
- Modify: `Web-app/upsertEmployeeWeb/index.mjs`

**Interfaces:**
- Consumes: `CALL web_upsertEmployee(..., p_password, p_profileImgPath)` returning `{ empId, message, isCreated }`
- Produces: HTTP create/update with welcome email only when `Number(isCreated) === 1`

- [ ] **Step 1: Require `empId` validation after destructuring body**

After reading `empId` from body (near other field checks), add:

```javascript
        const parsedEmpId = Number(empId);

        if (!Number.isInteger(parsedEmpId) || parsedEmpId <= 0) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "empId is required and must be a valid positive integer"
                })
            };
        }
```

- [ ] **Step 2: Replace create detection and always generate password**

Remove:

```javascript
        const isCreate = !empId || empId === 0;

        const temporaryPassword = isCreate
            ? generateTemporaryPassword()
            : null;
```

Replace with:

```javascript
        const temporaryPassword = generateTemporaryPassword();
```

In the `CALL web_upsertEmployee` parameter list, pass `parsedEmpId` instead of `empId || null`:

```javascript
            [
                parsedEmpId,
                fullName,
                joiningDate,
                email,
                mobileNumber,
                roleId,
                designationId,
                clientId,
                locationIdsString,
                temporaryPassword,
                profileImgPath
            ]
```

- [ ] **Step 3: Gate welcome email on `isCreated`**

Replace `if (isCreate) {` (email block) with:

```javascript
        const isCreated =
            Number(employeeResult.isCreated) === 1;

        if (isCreated) {
```

Keep the existing `sendMail` HTML and email-failure `500` response unchanged inside that block.

- [ ] **Step 4: Manual smoke (local)**

From `Web-app/upsertEmployeeWeb`:

```bash
node index.mjs
```

Expected: `Upsert Employee API running on port 3012`

Then (with a valid Bearer token and unused empId):

```bash
curl -s -X POST http://localhost:3012/web/upsertemployee ^
  -H "Authorization: Bearer <token>" ^
  -H "Content-Type: application/json" ^
  -d "{\"empId\":999002,\"fullName\":\"API Smoke\",\"joiningDate\":\"2026-09-24\",\"email\":\"api.smoke@example.com\",\"mobileNumber\":\"9999990002\",\"roleId\":1,\"designationId\":1,\"clientId\":1,\"locationIds\":[1],\"profileImgPath\":\"https://example.com/p.png\"}"
```

Expected create: `success: true`, email sent (check SMTP / inbox), DB row `id = 999002`.

Repeat same `empId` with a changed `fullName`: `success: true`, no welcome email, password unchanged.

Omit `empId`: `400` with empId required message.

- [ ] **Step 5: Stop — do not commit unless user asks**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Require client `empId` → `employee.id` on insert | Task 1 + 2 |
| Existence-based insert vs update in SP | Task 1 |
| Return `isCreated` | Task 1 |
| Always generate password in Lambda | Task 2 |
| Email only when `isCreated === 1` | Task 2 |
| No separate lookup SP | (none created) |
| Locations unchanged | Task 1 (script preserves block) |
