# Task 3 Report: Manual end-to-end verification

## Status

**DONE_WITH_CONCERNS** — Local server start and auth-path checks passed; upload/create/edit paths and S3 verification deferred (no web Bearer token or `S3_BUCKET_NAME` in environment).

## Environment

| Item | Finding |
|------|---------|
| Branch | `feature/generate-profile-img-url-web` @ `a41d76e` |
| Package dir | `Web-app/generateProfileImgUrlWeb` |
| `.env` in package | **Missing** (`dotenv` reported `injected env (0) from .env`) |
| Process env (shell) | `S3_BUCKET_NAME`, AWS credentials, `TOKEN` — **not set** |
| DB at runtime | Server uses code defaults: `localhost:3306`, DB `employee_attendance`, user `root` (password from brief default in source) |
| SP SQL file | Present at `Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql`; DB apply not re-run in this task |

## Pre-check: syntax

```bash
node --check Web-app/generateProfileImgUrlWeb/index.mjs
```

**Result:** Exit code 0 (no output).

## Step 1: Start local server

**Command:**

```bash
cd Web-app/generateProfileImgUrlWeb
node index.mjs
```

**Result:** **PASS**

**Console:**

```text
◇ injected env (0) from .env
Profile Image URL API running on http://localhost:3020/web/profile-img-url
```

No startup failure from missing env; `S3_BUCKET_NAME` is only enforced on upload, not at listen time.

## Step 2: Auth failure (no Bearer token)

**Command (Windows):** JSON body written to `%TEMP%\profile-img-payload.json` to avoid PowerShell/curl escaping issues (initial attempt with inline `-d "{\"email\":...}"` returned Express **400** JSON parse error, not API 401).

```bash
curl.exe -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:3020/web/profile-img-url \
  -H "Content-Type: application/json" \
  --data-binary "@%TEMP%\profile-img-payload.json"
```

Body: `{"email":"new@example.com","imageBase64":"aGVsbG8="}`

**Response:**

```json
{"success":false,"message":"Authorization token is required"}
```

**HTTP status:** 401

**Expected:** `success: false`, 401, message about Authorization token — **matches**.

### Extra auth check (not in brief)

Bearer header present but malformed:

```json
{"success":false,"message":"Invalid authorization format"}
```

HTTP 401 — **matches** handler behavior.

## Step 3: Validation failure (`imageBase64` missing, valid token)

**Blocked — no valid web Bearer token available** in repo, `.env`, or agent shell (`TOKEN` not set). Credentials were not invented.

**Proxy attempt (invalid token):**

Body: `{"email":"new@example.com"}` with `Authorization: Bearer PLACEHOLDER_NOT_REAL`

**Response:**

```json
{"success":false,"message":"Invalid or expired token"}
```

HTTP 401 — confirms `web_validateToken` is reachable against local MySQL (not 500); does **not** satisfy Step 3 (expected 400 after auth).

**Static expectation (code review):** After successful token validation, `uploadProfileImage` returns 400 with `imageBase64 is required` when `imageBase64` is absent (`index.mjs` ~227–235).

## Step 4: Create-path upload (email only)

**Deferred — blocked by:**

1. No valid **TOKEN** for authenticated POST.
2. **`S3_BUCKET_NAME` not configured** in environment; handler would return 500 `S3_BUCKET_NAME is not configured` before S3 put even with a valid token.

**Not run:** S3 object existence check, response field assertions (`s3Key` prefix, HTTPS `profileImgPath`, `empId: null`).

## Step 5: Edit-path upload (empId + existing `profileImgPath`)

**Deferred — depends on Step 4** and:

- Employee row with existing `profileImgPath`
- S3 delete/put verification
- DB assertion that `employee.profileImgPath` remains unchanged until `upsertEmployeeWeb`

None of these were executed in this session.

## Summary table

| Step | Description | Result |
|------|-------------|--------|
| Pre | `node --check` | Pass |
| 1 | Start server | Pass |
| 2 | Auth failure (no token) | Pass (401) |
| 3 | Validation 400 (missing `imageBase64`) | **Deferred** (no TOKEN) |
| 4 | Create upload + S3 | **Deferred** (no TOKEN, no S3 bucket env) |
| 5 | Edit upload + old object + DB unchanged | **Deferred** |

## Concerns / follow-up for integrator

1. Add `Web-app/generateProfileImgUrlWeb/.env` (or export env) with `S3_BUCKET_NAME`, `AWS_REGION`, AWS credentials, and DB overrides as needed — **do not commit secrets**.
2. Obtain a real web session token and re-run Steps 3–5 using the brief curl bodies; on Windows prefer `--data-binary @file.json` for JSON bodies.
3. Confirm `web_getEmployeeProfileImgPath` is applied if edit-path lookup fails (Task 1 noted `mysql` CLI absent; token SP appears to work locally).
4. After Step 4, verify object in S3 console/CLI and that DB `profileImgPath` is unchanged until upsert (per spec).

## Commit

**None** — brief has no documentation commit step; only manual verification and this report.

## Artifacts

- Report: `.superpowers/sdd/task-3-report.md`
- API: `Web-app/generateProfileImgUrlWeb/index.mjs`
