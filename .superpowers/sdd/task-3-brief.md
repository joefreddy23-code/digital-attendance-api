### Task 3: Manual end-to-end verification

**Files:**
- None (manual checks only)

**Interfaces:**
- Consumes: running API from Task 2, SP from Task 1, valid web Bearer token, configured `S3_BUCKET_NAME`

- [ ] **Step 1: Start the local server**

```bash
cd Web-app/generateProfileImgUrlWeb
# Ensure .env (or process env) has DB_*, S3_BUCKET_NAME, AWS_REGION, and AWS credentials
node index.mjs
```

Expected console: `Profile Image URL API running on http://localhost:3020/web/profile-img-url`

- [ ] **Step 2: Auth failure**

```bash
curl -s -X POST http://localhost:3020/web/profile-img-url \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"new@example.com\",\"imageBase64\":\"aGVsbG8=\"}"
```

Expected JSON: `success: false`, status 401, message about Authorization token.

- [ ] **Step 3: Validation failure (with valid token)**

Replace `TOKEN` with a real web token:

```bash
curl -s -X POST http://localhost:3020/web/profile-img-url \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"new@example.com\"}"
```

Expected: 400, `imageBase64 is required`.

- [ ] **Step 4: Create-path upload (email only)**

```bash
curl -s -X POST http://localhost:3020/web/profile-img-url \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"newuser@example.com\",\"imageBase64\":\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==\"}"
```

Expected: 200, `data.s3Key` starts with `profileImages/newuser@example.com/`, `data.profileImgPath` is a full HTTPS URL, `data.empId` is `null`. Object exists in S3.

- [ ] **Step 5: Edit-path upload (empId + email with existing profileImgPath)**

1. Ensure an employee row has `profileImgPath` set to the URL from Step 4 (or any existing key URL).
2. Call again with that employee's `empId` + `email` and a new base64 image.
3. Confirm old S3 object is gone (or best-effort logged) and response returns a **new** `s3Key` / `profileImgPath`.
4. Confirm `employee.profileImgPath` in DB is **unchanged** until `upsertEmployeeWeb` is called.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `POST /web/profile-img-url` + Bearer / `web_validateToken` | Task 2 |
| Body: `email` (always), optional `empId`, `imageBase64` | Task 2 |
| S3 key `profileImages/{email}/{timestamp}.png` | Task 2 |
| SP lookup + delete old object | Tasks 1â€“2 |
| Return `s3Key` + `profileImgPath`; no DB update | Task 2 |
| Best-effort delete | Task 2 |
| Single-file (no helpers.mjs) | Task 2 |
| Error statuses 401/400/500/404 | Task 2 |
| Manual create/edit/auth/validation tests | Task 3 |

**Placeholder scan:** none.  
**Type consistency:** inline helper names match usage inside `uploadProfileImage`.
