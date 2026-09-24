# Task 3 Report: Password generation, SP call, and welcome email

**Date:** 2026-09-23  
**File modified:** `upsertEmployeeWeb/index.mjs`  
**Git commits:** None (per task constraints)

## Summary

Implemented create-only temporary password generation, 9-argument `web_upsertEmployee` call with `p_password`, and welcome email via nodemailer with SMTP from environment variables. Email failure after a successful create returns HTTP 500 with `success: false`, `empId`, and a message that the employee was created but the welcome email failed.

## Changes applied

### Imports and transporter

- Added `import nodemailer from "nodemailer"`.
- Added `transporter` using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD` (mirroring `forgetPassWeb/index.mjs`).

### `generateTemporaryPassword`

- Copied verbatim from `forgetPassWeb/index.mjs` (12-character policy: upper, lower, number, special, shuffle).
- Placed after `validateToken`, before the Lambda handler.

### Create vs update wiring

- `isCreate = !empId || empId === 0`
- `temporaryPassword = isCreate ? generateTemporaryPassword() : null`
- SP call updated to 9 placeholders; ninth argument is `temporaryPassword` (plain text for SP to MD5 on INSERT only).

### Welcome email

- On successful create (`employeeResult` present), sends HTML welcome email with plain temporary password in body only.
- `try/catch` around `sendMail`; on failure logs `empId` and error (not password), returns 500 JSON per spec.
- Updates skip email; password arg is `null`.

### Security / API contract

- Temporary password is not included in success JSON responses.
- No `console.log` of `temporaryPassword` (verified via grep).

## Verification

| Check | Result |
|-------|--------|
| `node --check index.mjs` | **Pass** (exit 0) |
| Create + inbox + MD5 in DB + login | **Not run** — no valid auth token available in this session |
| Update without email / unchanged password | **Not run** |
| Broken SMTP → 500 with empId | **Not run** |

## Manual E2E checklist (for operator)

1. `node index.mjs` in `upsertEmployeeWeb` (port 3012).
2. POST create with valid Bearer token → 200; verify welcome email; DB `password` = MD5(plain); login with emailed password.
3. POST update same `empId` → 200; no email; password unchanged.
4. Wrong `SMTP_PASSWORD`, create again → 500, `success: false`, `empId` set, welcome-email-failed message; row still exists.

## Spec coverage (Task 3)

| Requirement | Status |
|-------------|--------|
| Generate temp password on create | Done |
| Pass plain password to SP (INSERT MD5 in DB) | Done |
| `null` password on update | Done |
| Welcome email with plain password | Done |
| Email failure → 500 + empId + message | Done |
| Never return password in JSON | Done |
| Nodemailer + SMTP env | Done |
| No password logging | Done |

## Concerns / notes

- E2E depends on live MySQL, SMTP, and a valid token from `web_validateToken`.
- Email HTML interpolates `fullName` and `email`; same pattern as forgot-password flow (trust admin-only upsert context).
- `forgetPassWeb` logs “Temporary password generated”; upsert intentionally does not log the password value.

## Dependencies

- Task 1: `web_upsertEmployee` 9th param `p_password`
- Task 2: `nodemailer` + `.env` SMTP variables

## Final review fixes

**Date:** 2026-09-23  
**Smoke runner:** `.superpowers/sdd/final-review-smoke.mjs` (uses `upsertEmployeeWeb/.env` DB + SMTP)

| Check | Result |
|-------|--------|
| `web_upsertEmployee` in `information_schema` | **Pass** |
| 9 IN parameters (incl. `p_password`) | **Pass** |
| `SHOW CREATE` body contains `MD5(p_password)` | **Pass** |
| `CALL` insert with unique test email; DB `password` = MD5(plain) | **Pass** |
| Test employee cleanup (`employeelocation` + `employee` DELETE) | **Pass** |
| Nodemailer `transporter.verify()` | **Pass** |
| Test `sendMail` to `SMTP_USER` (self) | **Pass** |
| HTTP POST create via local handler | **Not run** — no Bearer token or login password in env/docs |
| Login / `web_validateLogin` for admin flow | **Skipped** — admin row exists; credentials not in env |

### Files changed (this pass)

- `upsertEmployeeWeb/.gitignore` — added `.env`, `node_modules/`
- `.superpowers/sdd/final-review-smoke.mjs` — reproducible smoke script (no secrets logged)

### Notes

- Full handler E2E (201/200 + welcome body) still needs a valid token from `loginWeb` or stored session token.
- HTML escaping / `Math.random` password entropy left unchanged per review deferral.
