# Generate Profile Image URL Web API — Design

**Date:** 2026-09-24  
**Scope:** New `generateProfileImgUrlWeb` Lambda that uploads an employee profile image to S3 and returns the public URL + S3 key for use by `upsertEmployeeWeb`.

## Goal

`POST /web/profile-img-url` accepts a profile image (base64), uploads it to S3 under a per-email folder, and returns `profileImgPath` + `s3Key`. On edit (existing employee), the previous S3 object referenced by `employee.profileImgPath` is deleted first so only one profile image is kept. This API does **not** update MySQL; `upsertEmployeeWeb` persists `profileImgPath`.

## Approach

Mirror `generateSelfieUrlMob` / `generateSignatureUrlMob` (base64 → buffer → `PutObject` → public URL), adapted for Web:

- Auth via `web_validateToken` (not mobile token SP)
- `email` and optional `empId` from the request body (not from the token), because admins upload images for add/edit employee flows
- S3 key always `profileImages/{email}/{timestamp}.png`
- New SP `web_getEmployeeProfileImgPath` to fetch the existing `profileImgPath` before delete
- No DB write from this API

## API Contract

### Endpoint

- Method: `POST`
- Path: `/web/profile-img-url`
- Header: `Authorization: Bearer <token>`

### Request body

```json
{
  "email": "user@example.com",
  "empId": 12,
  "imageBase64": "data:image/png;base64,..."
}
```

| Field | Required | Notes |
|--------|----------|--------|
| `email` | Yes | Used in S3 path; passed to SP |
| `empId` | No | Present on edit; omit, `null`, or `0` on create |
| `imageBase64` | Yes | Data-URI prefix optional (same as mobile upload APIs) |

### Success (200)

```json
{
  "success": true,
  "message": "Profile image uploaded successfully",
  "data": {
    "email": "user@example.com",
    "empId": 12,
    "s3Key": "profileImages/user@example.com/1727160000000.png",
    "profileImgPath": "https://{bucket}.s3.{region}.amazonaws.com/profileImages/user@example.com/1727160000000.png"
  }
}
```

On create, `empId` in the response may be `null` when not provided.

Client passes `data.profileImgPath` into `upsertEmployeeWeb` as `profileImgPath`.

## Data flow

1. Parse `Authorization`; require `Bearer <token>`.
2. Call `web_validateToken(?)`; on failure return 401.
3. Parse body; require `email` and `imageBase64`. Normalize `empId`: missing / `0` / non-positive → `null`.
4. Call `web_getEmployeeProfileImgPath(p_empId, p_email)`.
5. If a non-empty `profileImgPath` is returned:
   - Derive S3 object key from the stored value:
     - If it is a full `https://{bucket}.s3.{region}.amazonaws.com/{key}` URL, strip the host prefix to get `{key}`
     - If it is already a key (e.g. starts with `profileImages/`), use as-is
   - Send `DeleteObject` for that key (best-effort: log errors / missing object and continue)
6. Strip data-URI prefix if present; decode base64 to a buffer; reject empty/invalid image (400).
7. Build key `profileImages/{email}/{Date.now()}.png`.
8. `PutObject` with `ContentType: image/png`.
9. Build public URL and return `{ email, empId, s3Key, profileImgPath }`.
10. Do **not** `UPDATE employee`.

### Create vs edit

| Scenario | SP result | Behavior |
|----------|-----------|----------|
| Create (no matching employee) | Empty | Skip delete → upload → return URL |
| Edit (employee found) | Existing `profileImgPath` | Delete old object → upload → return new URL |

## Stored procedure

**Name:** `web_getEmployeeProfileImgPath`  
**SQL artifact:** `Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql`

```sql
CALL web_getEmployeeProfileImgPath(p_empId, p_email);
```

Logic (prefer `empId` match when both are provided):

```sql
SELECT profileImgPath
FROM employee
WHERE (p_empId IS NOT NULL AND empId = p_empId)
   OR (
        p_empId IS NULL
        AND p_email IS NOT NULL
        AND email = p_email
      )
LIMIT 1;
```

When `p_empId` is set, look up by `empId` only. When `p_empId` is null (create / email-only), look up by `email`. Returns at most one row with `profileImgPath` (may be `NULL` if the column is empty).

## Components

Single-file layout (same style as `generateSelfieUrlMob`) — no separate `helpers.mjs`.

| Piece | Location |
|--------|----------|
| Lambda + local Express | `Web-app/generateProfileImgUrlWeb/index.mjs` |
| Package | `Web-app/generateProfileImgUrlWeb/package.json` |
| SP SQL | `Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql` |

**Dependencies:** `express`, `mysql2`, `dotenv`, `@aws-sdk/client-s3`  
**Env:** `S3_BUCKET_NAME`, `AWS_REGION` (default `ap-south-1`), `DB_*`, `PORT` (default `3020` local)  
**Local server:** Express JSON body limit `10mb` wrapping the Lambda `handler`

## Error handling

| Case | Status | Notes |
|------|--------|--------|
| Missing / invalid Bearer token | 401 | |
| Invalid or expired token | 401 | From `web_validateToken` |
| Missing `email` or `imageBase64` | 400 | |
| Invalid base64 / empty image | 400 | |
| `S3_BUCKET_NAME` not configured | 500 | |
| S3 upload failure | 500 | |
| Old-object delete failure | — | Log and continue; still upload new image |
| Unknown path | 404 | |

## Out of scope

- Updating `employee.profileImgPath` (owned by `upsertEmployeeWeb`)
- Multipart / form-data upload
- Image resizing or format conversion beyond storing as PNG content-type
- Listing/wiping the entire `profileImages/{email}/` prefix (only the SP-returned path is deleted)

## Manual test plan

1. **Create:** `email` + `imageBase64`, no `empId` → 200, object at `profileImages/{email}/{ts}.png`, returned URL usable by upsert.
2. **Edit:** existing employee with prior `profileImgPath` → old S3 object removed, new key/URL returned.
3. **Auth:** missing/invalid token → 401.
4. **Validation:** missing `email` or `imageBase64` → 400.
5. **Idempotent delete:** SP returns path for a missing S3 object → upload still succeeds.
