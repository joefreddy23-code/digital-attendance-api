### Task 3: Implement password generation, SP call, and welcome email in index.mjs

**Files:**
- Modify: `upsertEmployeeWeb/index.mjs`

**Interfaces:**
- Consumes: `web_upsertEmployee(..., p_password)`; `nodemailer.createTransport`; `generateTemporaryPassword()`
- Produces:
  - Create: email sent on success; on email failure `{ success: false, empId, message }` with status `500`
  - Update: no email; password arg `null`

- [ ] **Step 1: Add imports and transporter after existing dotenv import**

At top of `upsertEmployeeWeb/index.mjs`, change imports to:

```javascript
import express from "express";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
```

After `dotenv.config();` and before DB config (or immediately after pool creation), add:

```javascript
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
});
```

- [ ] **Step 2: Add `generateTemporaryPassword` helper**

Place after `validateToken` (before the Lambda handler). Copy the exact function from `forgetPassWeb/index.mjs` (lines defining `generateTemporaryPassword` â€” 12-char policy with upper/lower/number/special + shuffle). Do not `console.log` the password.

- [ ] **Step 3: Wire create vs update password + SP call**

Inside `handler`, after `locationIdsString` is built and before `pool.query`, add:

```javascript
const isCreate = !empId || empId === 0;

const temporaryPassword = isCreate
    ? generateTemporaryPassword()
    : null;
```

Replace the SP call with:

```javascript
const [results] = await pool.query(
    `CALL web_upsertEmployee(
        ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
    [
        empId || null,
        fullName,
        joiningDate,
        email,
        mobileNumber,
        roleId,
        designationId,
        locationIdsString,
        temporaryPassword
    ]
);
```

- [ ] **Step 4: Send welcome email after successful create; handle failure (option B)**

Immediately after `employeeResult` is validated as present, and before the success return:

```javascript
if (isCreate) {

    try {

        await transporter.sendMail({
            from: `"Employee Attendance" <${process.env.SMTP_USER}>`,
            to: email,
            subject: "Welcome - Employee Attendance Account",
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px;">
                    <h2>Welcome to Employee Attendance</h2>
                    <p>Hello ${fullName},</p>
                    <p>
                        Your employee account has been created successfully.
                        You can log in using the credentials below.
                    </p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p>Your temporary password is:</p>
                    <div style="
                        display: inline-block;
                        padding: 12px 20px;
                        background-color: #f3f3f3;
                        border-radius: 6px;
                        font-size: 20px;
                        font-weight: bold;
                        letter-spacing: 2px;
                    ">
                        ${temporaryPassword}
                    </div>
                    <p>
                        Please change your password after logging in.
                    </p>
                    <br>
                    <p>
                        Regards,<br>
                        Employee Attendance Team
                    </p>
                </div>
            `
        });

    } catch (emailError) {

        console.error(
            "Welcome email failed for employee:",
            employeeResult.empId,
            emailError
        );

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                empId: employeeResult.empId,
                message:
                    "Employee created successfully, but welcome email failed to send"
            })
        };
    }
}
```

Keep the existing success return unchanged for successful create+email and for updates.

- [ ] **Step 5: Manual verification checklist**

1. Start API: `node index.mjs` in `upsertEmployeeWeb` (port 3012).
2. **Create** employee with valid auth token â†’ expect 200; check inbox for welcome mail with password; in DB `employee.password` equals `MD5('<plain>')` not plain text; login works with emailed password.
3. **Update** same employee (change name) â†’ expect 200; no email; `password` column unchanged.
4. Temporarily break SMTP (wrong `SMTP_PASSWORD`) and **create** again â†’ expect 500 with `success: false`, `empId` set, message about welcome email failed; employee row still exists.

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Extend SP with `p_password` | Task 1 |
| `MD5(p_password)` on insert only | Task 1 |
| Ignore password on update | Task 1 + Task 3 |
| Generate temp password on create | Task 3 |
| Welcome email with plain password | Task 3 |
| Email failure returns error with `empId` | Task 3 |
| Never return password in JSON | Task 3 |
| Nodemailer + SMTP env | Task 2 + Task 3 |
| No secrets in source | Task 2 (`.env.example` empty; `.env` local) |

## Placeholder scan

No TBD / â€œimplement laterâ€ / vague validation steps remaining.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-23-upsert-employee-welcome-email.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** â€” fresh subagent per task, review between tasks  
2. **Inline Execution** â€” implement in this session with checkpoints  

Which approach?
