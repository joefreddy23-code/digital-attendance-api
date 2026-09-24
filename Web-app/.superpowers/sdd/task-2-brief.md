### Task 2: Add nodemailer + env template to upsertEmployeeWeb

**Files:**
- Modify: `upsertEmployeeWeb/package.json`
- Create: `upsertEmployeeWeb/.env.example`
- Create or update: `upsertEmployeeWeb/.env` (local only; never commit)

**Interfaces:**
- Consumes: npm registry `nodemailer`
- Produces: `nodemailer` available for import in `index.mjs`; documented SMTP env keys

- [ ] **Step 1: Install nodemailer**

From `upsertEmployeeWeb`:

```bash
npm install nodemailer@^10.0.3
```

Expected: `package.json` dependencies include `"nodemailer": "^10.0.3"` (or compatible 10.x); `package-lock.json` updated.

- [ ] **Step 2: Add `.env.example`**

Create `upsertEmployeeWeb/.env.example`:

```env
DB_USER=root
DB_PASSWORD=
DB_SERVER=localhost
DB_PORT=3306
DB_NAME=employee_attendance

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
```

- [ ] **Step 3: Ensure local `.env` has SMTP vars**

If `upsertEmployeeWeb/.env` is missing, create it with the same keys as `.env.example` and fill SMTP values from the same source used by `forgetPassWeb` (do not paste secrets into docs or commits).

Verify:

```bash
# PowerShell
Select-String -Path upsertEmployeeWeb\.env -Pattern "SMTP_"
```

Expected: `SMTP_USER` and `SMTP_PASSWORD` lines present.

---

