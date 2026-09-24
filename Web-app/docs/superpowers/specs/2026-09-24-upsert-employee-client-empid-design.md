# Upsert Employee — Client-Provided `empId` Design

**Date:** 2026-09-24  
**Scope:** Update `web_upsertEmployee` and `upsertEmployeeWeb` so create and update both require a client-provided `empId` (`employee.id`). Existence in DB decides insert vs update. Welcome email + temp password only on create.  
**Approach:** B — single upsert SP returns `isCreated`; no separate lookup SP.

---

## Problem

Today create vs update is inferred from an empty/`0` `empId`:

- Lambda: `isCreate = !empId || empId === 0`
- SP: `IF p_empId IS NULL OR p_empId = 0 THEN INSERT … LAST_INSERT_ID() ELSE UPDATE`

New requirement: the client **always** sends `empId` (including for new employees). That value must be stored as **`employee.id`** on insert. Create vs update is “row exists for this id?” not “was empId omitted?”.

---

## Goals

1. Require `empId` on every upsert request.
2. Insert new rows with `id = p_empId` when no row exists.
3. Update existing rows when `id = p_empId` exists (password never updated).
4. Generate a temporary password and send welcome email **only** when a new employee was inserted.
5. Keep location assignment behavior unchanged.
6. No new lookup stored procedure.

## Non-goals

- Separate existence / get-userDetails SP.
- Changing other Web APIs (`generateProfileImgUrlWeb`, `getOneemployeeWeb`, etc.).
- Changing password hashing (`MD5`) or SMTP setup.
- Client/UI work to generate `empId` values.

---

## Architecture

```
Client (always sends empId)
    → upsertEmployeeWeb
        → validate empId + other fields
        → always generate temporaryPassword
        → CALL web_upsertEmployee(..., password, ...)
        → if isCreated = 1 → send welcome email
        → return { empId, message }
```

**Create vs update ownership**

| Concern | Owner |
|---------|--------|
| Insert vs update in MySQL | `web_upsertEmployee` (existence of `employee.id`) |
| Whether to email / treat as create in API | Lambda uses SP result `isCreated` |
| Password generation | Lambda always generates; SP uses password **only on insert** |

---

## Stored procedure: `web_upsertEmployee`

**SQL artifact:** `Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql`  
(Create or overwrite; apply manually to `employee_attendance`.)

**Signature (unchanged params):**

```text
web_upsertEmployee(
  p_empId, p_fullName, p_joiningDate, p_email, p_mobileNumber,
  p_roleId, p_designationId, p_clientId, p_locationIds,
  p_password, p_profileImgPath
)
```

**Behavior**

1. If `p_empId IS NULL OR p_empId = 0` → `ROLLBACK` + `SIGNAL` `'Employee ID is required'`.
2. If no row `employee.id = p_empId`:
   - Require non-empty `p_password` else `SIGNAL` `'Password is required for new employees'`.
   - `INSERT` including column `id = p_empId` (plus existing create columns: name, joiningDate, email, mobileNumber, roleId, designationId, clientId, `MD5(p_password)`, active=1, profileImgPath).
   - Set `v_empId = p_empId`, `v_isCreated = 1`.
3. Else:
   - `UPDATE` name, joiningDate, email, mobileNumber, roleId, designationId, clientId, profileImgPath `WHERE id = p_empId`.
   - Do **not** update password.
   - Set `v_empId = p_empId`, `v_isCreated = 0`.
4. Location sync (`DELETE` missing / `INSERT` new `employeelocation` rows) unchanged, using `v_empId`.
5. `COMMIT`.
6. Result set:

```sql
SELECT
    v_empId AS empId,
    'Employee saved successfully' AS message,
    v_isCreated AS isCreated;
```

`isCreated` is `1` (insert) or `0` (update).

**Full replacement script** (apply in MySQL Workbench / CLI):

```sql
DROP PROCEDURE IF EXISTS `web_upsertEmployee`;

DELIMITER $$

CREATE DEFINER=`root`@`localhost` PROCEDURE `web_upsertEmployee`(
    IN p_empId INT,
    IN p_fullName VARCHAR(100),
    IN p_joiningDate DATE,
    IN p_email VARCHAR(150),
    IN p_mobileNumber VARCHAR(20),
    IN p_roleId INT,
    IN p_designationId INT,
    IN p_clientId INT,
    IN p_locationIds VARCHAR(1000),
    IN p_password VARCHAR(100),
    IN p_profileImgPath TEXT
)
BEGIN

    DECLARE v_empId INT;
    DECLARE v_isCreated TINYINT DEFAULT 0;

    START TRANSACTION;

    IF p_empId IS NULL OR p_empId = 0 THEN

        ROLLBACK;

        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Employee ID is required';

    END IF;


    -- ============================================================
    -- INSERT EMPLOYEE (id comes from client)
    -- ============================================================

    IF NOT EXISTS (
        SELECT 1
        FROM employee
        WHERE id = p_empId
    ) THEN

        IF p_password IS NULL OR p_password = '' THEN

            ROLLBACK;

            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Password is required for new employees';

        END IF;

        INSERT INTO employee
        (
            id,
            name,
            joiningDate,
            email,
            mobileNumber,
            roleId,
            designationId,
            clientId,
            password,
            active,
            profileImgPath
        )
        VALUES
        (
            p_empId,
            p_fullName,
            p_joiningDate,
            p_email,
            p_mobileNumber,
            p_roleId,
            p_designationId,
            p_clientId,
            MD5(p_password),
            1,
            p_profileImgPath
        );

        SET v_empId = p_empId;
        SET v_isCreated = 1;


    -- ============================================================
    -- UPDATE EMPLOYEE (password is never updated here)
    -- ============================================================

    ELSE

        UPDATE employee
        SET
            name = p_fullName,
            joiningDate = p_joiningDate,
            email = p_email,
            mobileNumber = p_mobileNumber,
            roleId = p_roleId,
            designationId = p_designationId,
            clientId = p_clientId,
            profileImgPath = p_profileImgPath
        WHERE id = p_empId;

        SET v_empId = p_empId;
        SET v_isCreated = 0;

    END IF;


    -- ============================================================
    -- LOCATION ASSIGNMENTS
    -- ============================================================

    DELETE FROM employeelocation
    WHERE empId = v_empId
      AND locationId NOT IN (
          SELECT CAST(j.locationId AS UNSIGNED)
          FROM JSON_TABLE(
              CONCAT('[', p_locationIds, ']'),
              '$[*]' COLUMNS (
                  locationId VARCHAR(50) PATH '$'
              )
          ) j
      );


    INSERT INTO employeelocation
    (
        empId,
        locationId
    )
    SELECT
        v_empId,
        CAST(j.locationId AS UNSIGNED)
    FROM JSON_TABLE(
        CONCAT('[', p_locationIds, ']'),
        '$[*]' COLUMNS (
            locationId VARCHAR(50) PATH '$'
        )
    ) j
    WHERE NOT EXISTS (
        SELECT 1
        FROM employeelocation el
        WHERE el.empId = v_empId
          AND el.locationId = CAST(j.locationId AS UNSIGNED)
    );


    COMMIT;


    SELECT
        v_empId AS empId,
        'Employee saved successfully' AS message,
        v_isCreated AS isCreated;

END$$

DELIMITER ;
```

**Assumption:** `employee.id` accepts explicit inserts (AUTO_INCREMENT still fine for other paths; client-supplied ids must not collide). Duplicate id is handled by existence check before insert.

---

## Lambda: `upsertEmployeeWeb/index.mjs`

**Validation**

- Require `empId` as a positive integer (same style as other Web APIs). Missing/invalid → `400`.

**Upsert call**

- Always call `generateTemporaryPassword()` and pass it as `p_password` (SP ignores it on update).
- Pass `empId` through (never coerce to `null` for create).

**Post-success**

- Read `employeeResult.isCreated`.
- If `Number(employeeResult.isCreated) === 1`: send existing welcome email; on email failure keep current behavior (`500`, employee created but email failed, include `empId`).
- If `Number(employeeResult.isCreated) === 0`: skip email; return success as today.

**Remove**

- `const isCreate = !empId || empId === 0;`

---

## API contract (request)

| Field | Create | Update |
|-------|--------|--------|
| `empId` | **Required** (new `employee.id`) | **Required** (existing id) |
| Other fields | Unchanged required set | Unchanged |

Success body shape unchanged (`success`, `data.empId`, `data.message`). `isCreated` is internal to Lambda (not required in HTTP response unless useful later).

---

## Error handling

| Case | Behavior |
|------|----------|
| Missing/invalid `empId` | HTTP 400 from Lambda |
| SP `Employee ID is required` | HTTP 500 with SP message (existing catch path) |
| Create without password (should not happen if Lambda always generates) | SP SIGNAL |
| Welcome email fails after create | HTTP 500, `empId` returned, message as today |

---

## Testing

1. Apply updated SP; `SHOW CREATE PROCEDURE web_upsertEmployee` shows insert-by-id + `isCreated` in final `SELECT`.
2. Call upsert with unused `empId` → row inserted with that `id`; password MD5 set; email sent (`isCreated = 1`).
3. Call upsert again with same `empId` (changed name) → row updated; password unchanged; no email (`isCreated = 0`).
4. Call without `empId` → Lambda 400.
5. Location assignments still sync for both create and update.

---

## Files

| Path | Action |
|------|--------|
| `Web-app/docs/superpowers/plans/sql/web_upsertEmployee.sql` | Create/overwrite with script above |
| `Web-app/upsertEmployeeWeb/index.mjs` | Require `empId`; always generate password; email on `isCreated` |
| This spec | Design record |

---

## Decisions locked

- Client `empId` → `employee.id` only.
- Approach **B**: no separate existence SP; SP returns `isCreated`.
- Password always generated in Lambda; used only on insert inside SP.
)
