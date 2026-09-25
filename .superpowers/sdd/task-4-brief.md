### Task 4: Manual end-to-end verification

**Files:**
- None (manual checks only)

**Interfaces:**
- Consumes: running API from Task 3, SP from Task 1, valid web Bearer token, configured `S3_BUCKET_NAME`

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

- [ ] **Step 6: Commit design + plan docs if not already committed**

```bash
git add Web-app/docs/superpowers/specs/2026-09-24-generate-profile-img-url-web-design.md Web-app/docs/superpowers/plans/2026-09-24-generate-profile-img-url-web.md
git commit -m "$(cat <<'EOF'
Document generateProfileImgUrlWeb design and implementation plan.

EOF
)"
```

---