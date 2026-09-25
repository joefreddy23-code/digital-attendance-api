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

- [ ] **Step 5: Stop â€” do not commit unless user asks**

---
