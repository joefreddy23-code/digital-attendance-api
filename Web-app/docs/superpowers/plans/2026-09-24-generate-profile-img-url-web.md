# Generate Profile Image URL Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /web/profile-img-url` that uploads a profile image to S3 under `profileImages/{email}/{timestamp}.png`, deletes any prior object looked up via SP, and returns `s3Key` + `profileImgPath` for `upsertEmployeeWeb` (no DB write).

**Architecture:** Single-file Web Lambda `generateProfileImgUrlWeb/index.mjs` mirroring `generateSelfieUrlMob` (base64 → buffer → S3 PutObject → public URL), with `web_validateToken` auth and SP `web_getEmployeeProfileImgPath` to fetch the old path before best-effort DeleteObject. Pure helpers live inline in `index.mjs` (no `helpers.mjs`).

**Tech Stack:** Node.js ESM (`index.mjs`), Express 5 (local), mysql2, dotenv, `@aws-sdk/client-s3`, MySQL stored procedure.

**Spec:** `Web-app/docs/superpowers/specs/2026-09-24-generate-profile-img-url-web-design.md`

## Global Constraints

- Auth: Bearer token → `CALL web_validateToken(?)` (never mobile token SP)
- `empId` and `email` come from the **request body**, not the token
- `email` is always required (used in S3 key on create and update)
- S3 key always: `profileImages/{email}/{Date.now()}.png`
- ContentType: `image/png`
- Do **not** `UPDATE employee.profileImgPath` (owned by upsertEmployeeWeb)
- Old S3 delete is best-effort (log + continue on failure)
- Single-file layout only — no separate `helpers.mjs`
- Follow existing Web-app Lambda + local Express handler pattern
- Response field for the public URL is `profileImgPath` (not `imgSrcPath`)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql` | SP DDL for looking up existing `profileImgPath` |
| `Web-app/generateProfileImgUrlWeb/package.json` | Dependencies + start script |
| `Web-app/generateProfileImgUrlWeb/index.mjs` | Inline helpers, token validation, SP call, S3 delete/upload, Lambda + Express |

---

### Task 1: Ensure stored procedure SQL is present and applied

**Files:**
- Create/verify: `Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql`

**Interfaces:**
- Consumes: `employee` table columns `empId`, `email`, `profileImgPath`
- Produces: SP `web_getEmployeeProfileImgPath(p_empId INT, p_email VARCHAR(255))` returning one result set with column `profileImgPath`

- [ ] **Step 1: Write/restore the SP SQL file**

Create or overwrite `Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql` with:

```sql
DROP PROCEDURE IF EXISTS web_getEmployeeProfileImgPath;

DELIMITER $$

CREATE PROCEDURE web_getEmployeeProfileImgPath(
    IN p_empId INT,
    IN p_email VARCHAR(255)
)
BEGIN
    SELECT profileImgPath
    FROM employee
    WHERE (p_empId IS NOT NULL AND empId = p_empId)
       OR (
            p_empId IS NULL
            AND p_email IS NOT NULL
            AND email = p_email
          )
    LIMIT 1;
END$$

DELIMITER ;
```

- [ ] **Step 2: Apply the SP to the local/dev database**

Run (adjust credentials to match env):

```bash
mysql -u root -p employee_attendance < Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql
```

Expected: no errors; `SHOW PROCEDURE STATUS WHERE Name = 'web_getEmployeeProfileImgPath';` shows one row.

- [ ] **Step 3: Smoke-test the SP**

```sql
CALL web_getEmployeeProfileImgPath(NULL, 'someone@example.com');
CALL web_getEmployeeProfileImgPath(1, NULL);
```

Expected: empty result or one `profileImgPath` row; no SQL error.

- [ ] **Step 4: Commit (only if the SQL file changed)**

```bash
git add Web-app/docs/superpowers/plans/sql/web_getEmployeeProfileImgPath.sql
git commit -m "Add web_getEmployeeProfileImgPath SP for profile image lookup."
```

If the file is already committed and unchanged, skip this commit.

---

### Task 2: Package scaffold + single-file Lambda/Express API

**Files:**
- Create/overwrite: `Web-app/generateProfileImgUrlWeb/package.json`
- Create/overwrite: `Web-app/generateProfileImgUrlWeb/index.mjs`
- Delete if present: `Web-app/generateProfileImgUrlWeb/helpers.mjs`, `Web-app/generateProfileImgUrlWeb/helpers.test.mjs` (design is single-file)

**Interfaces:**
- Consumes: SP from Task 1; `web_validateToken`; env `S3_BUCKET_NAME`, `AWS_REGION`, `DB_*`, `PORT`
- Produces: `export const handler`; local `POST /web/profile-img-url`
- Inline helpers (not exported):
  - `normalizeEmpId(empId) → number | null`
  - `decodeBase64Image(imageBase64) → { ok: true, buffer: Buffer } | { ok: false, message: string }`
  - `extractS3KeyFromProfileImgPath(profileImgPath, bucketName, region) → string | null`
  - `buildS3ObjectUrl(s3Key) → string`
  - `buildProfileImageS3Key(email, timestampMs) → string`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "generateprofileimgurlweb",
  "version": "1.0.0",
  "description": "Upload employee profile image to S3 and return URL/key",
  "main": "index.mjs",
  "type": "module",
  "scripts": {
    "start": "node index.mjs"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.1136.0",
    "dotenv": "^18.0.1",
    "express": "^5.2.1",
    "mysql2": "^3.24.4"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd Web-app/generateProfileImgUrlWeb
npm install
```

Expected: `node_modules` present; no install errors.

- [ ] **Step 3: Remove leftover helper files if they exist**

```bash
# From repo root (PowerShell-safe)
Remove-Item -ErrorAction SilentlyContinue Web-app/generateProfileImgUrlWeb/helpers.mjs, Web-app/generateProfileImgUrlWeb/helpers.test.mjs
```

- [ ] **Step 4: Implement full `index.mjs`**

Create `Web-app/generateProfileImgUrlWeb/index.mjs` with the complete file below (inline helpers + auth + S3 + Express):

```js
import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand
} from "@aws-sdk/client-s3";

dotenv.config();

const PORT = process.env.PORT || 3020;

const AWS_REGION =
    process.env.AWS_REGION || "ap-south-1";

const S3_BUCKET_NAME =
    process.env.S3_BUCKET_NAME;

const dbConfig = {
    host: process.env.DB_SERVER || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "welcome@123",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "employee_attendance",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool = null;

const getDbConnection = async () => {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
        console.log("MySQL connection pool created");
    }
    return pool;
};

const s3Client = new S3Client({
    region: AWS_REGION
});

const normalizeEmpId = (empId) => {
    if (empId === undefined || empId === null || empId === "") {
        return null;
    }

    const value = Number(empId);

    if (!Number.isInteger(value) || value <= 0) {
        return null;
    }

    return value;
};

const decodeBase64Image = (imageBase64) => {
    if (!imageBase64 || typeof imageBase64 !== "string") {
        return {
            ok: false,
            message: "imageBase64 is required"
        };
    }

    let base64Data = imageBase64;

    if (imageBase64.includes(",")) {
        base64Data = imageBase64.split(",")[1];
    }

    if (!base64Data) {
        return {
            ok: false,
            message: "Invalid Base64 image"
        };
    }

    let imageBuffer;

    try {
        imageBuffer = Buffer.from(base64Data, "base64");
    } catch {
        return {
            ok: false,
            message: "Invalid Base64 image"
        };
    }

    if (!imageBuffer || imageBuffer.length === 0) {
        return {
            ok: false,
            message: "Invalid or empty image"
        };
    }

    return {
        ok: true,
        buffer: imageBuffer
    };
};

const extractS3KeyFromProfileImgPath = (
    profileImgPath,
    bucketName,
    region
) => {
    if (!profileImgPath || typeof profileImgPath !== "string") {
        return null;
    }

    const trimmed = profileImgPath.trim();

    if (!trimmed) {
        return null;
    }

    const prefix =
        `https://${bucketName}.s3.${region}.amazonaws.com/`;

    if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length);
    }

    if (trimmed.startsWith("profileImages/")) {
        return trimmed;
    }

    try {
        if (
            trimmed.startsWith("http://") ||
            trimmed.startsWith("https://")
        ) {
            const url = new URL(trimmed);
            const key = url.pathname.replace(/^\//, "");
            return key || null;
        }
    } catch {
        return null;
    }

    return trimmed;
};

const buildS3ObjectUrl = (s3Key) => {
    return `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`;
};

const buildProfileImageS3Key = (email, timestampMs) => {
    return `profileImages/${email}/${timestampMs}.png`;
};

const validateToken = async (token) => {
    if (!token) {
        return {
            valid: false,
            statusCode: 401,
            message: "Authorization token is required"
        };
    }

    try {
        const db = await getDbConnection();

        const [rows] = await db.query(
            "CALL web_validateToken(?)",
            [token]
        );

        const user = rows?.[0]?.[0];

        if (!user) {
            return {
                valid: false,
                statusCode: 401,
                message: "Invalid or expired token"
            };
        }

        return {
            valid: true,
            user
        };
    } catch (error) {
        console.error("Token Validation Error:", error);

        return {
            valid: false,
            statusCode: 500,
            message: "Token validation failed"
        };
    }
};

const jsonResponse = (statusCode, payload) => ({
    statusCode,
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
});

const uploadProfileImage = async (event) => {
    try {
        if (!S3_BUCKET_NAME) {
            return jsonResponse(500, {
                success: false,
                message: "S3_BUCKET_NAME is not configured"
            });
        }

        let body = event.body;

        if (typeof body === "string") {
            try {
                body = JSON.parse(body || "{}");
            } catch {
                return jsonResponse(400, {
                    success: false,
                    message: "Invalid JSON request body"
                });
            }
        }

        const email =
            typeof body?.email === "string"
                ? body.email.trim()
                : "";

        const imageBase64 = body?.imageBase64;
        const empId = normalizeEmpId(body?.empId);

        if (!email) {
            return jsonResponse(400, {
                success: false,
                message: "email is required"
            });
        }

        if (!imageBase64) {
            return jsonResponse(400, {
                success: false,
                message: "imageBase64 is required"
            });
        }

        const decoded = decodeBase64Image(imageBase64);

        if (!decoded.ok) {
            return jsonResponse(400, {
                success: false,
                message: decoded.message
            });
        }

        const db = await getDbConnection();

        const [rows] = await db.query(
            "CALL web_getEmployeeProfileImgPath(?, ?)",
            [empId, email]
        );

        const existingPath =
            rows?.[0]?.[0]?.profileImgPath;

        if (existingPath) {
            const oldKey = extractS3KeyFromProfileImgPath(
                existingPath,
                S3_BUCKET_NAME,
                AWS_REGION
            );

            if (oldKey) {
                try {
                    await s3Client.send(
                        new DeleteObjectCommand({
                            Bucket: S3_BUCKET_NAME,
                            Key: oldKey
                        })
                    );
                    console.log("Deleted old profile image:", oldKey);
                } catch (deleteError) {
                    console.error(
                        "Failed to delete old profile image (continuing):",
                        deleteError
                    );
                }
            }
        }

        const timestampMs = Date.now();
        const s3Key = buildProfileImageS3Key(email, timestampMs);

        await s3Client.send(
            new PutObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: s3Key,
                Body: decoded.buffer,
                ContentType: "image/png"
            })
        );

        const profileImgPath = buildS3ObjectUrl(s3Key);

        return jsonResponse(200, {
            success: true,
            message: "Profile image uploaded successfully",
            data: {
                email,
                empId,
                s3Key,
                profileImgPath
            }
        });
    } catch (error) {
        console.error("Profile Image Upload Error:", error);

        return jsonResponse(500, {
            success: false,
            message: "Failed to upload profile image"
        });
    }
};

export const handler = async (event) => {
    try {
        console.log("Lambda Event:", JSON.stringify(event));

        const headers = event.headers || {};

        const authorization =
            headers.Authorization ||
            headers.authorization;

        if (!authorization) {
            return jsonResponse(401, {
                success: false,
                message: "Authorization token is required"
            });
        }

        const parts = authorization.trim().split(/\s+/);

        if (
            parts.length !== 2 ||
            parts[0].toLowerCase() !== "bearer" ||
            !parts[1]
        ) {
            return jsonResponse(401, {
                success: false,
                message: "Invalid authorization format"
            });
        }

        const tokenResult = await validateToken(parts[1]);

        if (!tokenResult.valid) {
            return jsonResponse(tokenResult.statusCode, {
                success: false,
                message: tokenResult.message
            });
        }

        const path =
            event.rawPath ||
            event.path ||
            "/web/profile-img-url";

        const method =
            event.requestContext?.http?.method ||
            event.httpMethod ||
            "POST";

        if (
            path === "/web/profile-img-url" &&
            method.toUpperCase() === "POST"
        ) {
            return await uploadProfileImage(event);
        }

        return jsonResponse(404, {
            success: false,
            message: "API endpoint not found"
        });
    } catch (error) {
        console.error("Lambda Handler Error:", error);

        return jsonResponse(500, {
            success: false,
            message: "Internal server error"
        });
    }
};

const app = express();

app.use(
    express.json({
        limit: "10mb"
    })
);

app.post("/web/profile-img-url", async (req, res) => {
    try {
        const event = {
            body: JSON.stringify(req.body),
            rawPath: "/web/profile-img-url",
            headers: req.headers,
            requestContext: {
                http: {
                    method: "POST"
                }
            }
        };

        const response = await handler(event, {});

        res
            .status(response.statusCode)
            .set(response.headers || {})
            .send(response.body);
    } catch (error) {
        console.error("Local Profile Image Upload Error:", error);

        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

app.listen(PORT, () => {
    console.log(
        `Profile Image URL API running on http://localhost:${PORT}/web/profile-img-url`
    );
});
```

- [ ] **Step 5: Syntax-check the module loads**

```bash
cd Web-app/generateProfileImgUrlWeb
node --check index.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add Web-app/generateProfileImgUrlWeb/package.json Web-app/generateProfileImgUrlWeb/package-lock.json Web-app/generateProfileImgUrlWeb/index.mjs
git add -u Web-app/generateProfileImgUrlWeb/helpers.mjs Web-app/generateProfileImgUrlWeb/helpers.test.mjs
git commit -m "Add single-file generateProfileImgUrlWeb Lambda for S3 profile uploads."
```

---

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
| SP lookup + delete old object | Tasks 1–2 |
| Return `s3Key` + `profileImgPath`; no DB update | Task 2 |
| Best-effort delete | Task 2 |
| Single-file (no helpers.mjs) | Task 2 |
| Error statuses 401/400/500/404 | Task 2 |
| Manual create/edit/auth/validation tests | Task 3 |

**Placeholder scan:** none.  
**Type consistency:** inline helper names match usage inside `uploadProfileImage`.
