/**
 * Final review smoke: SP shape, MD5 insert, SMTP verify/send, optional HTTP if token available.
 * Run from repo root: node .superpowers/sdd/final-review-smoke.mjs
 */
import mysql from "../../upsertEmployeeWeb/node_modules/mysql2/promise.js";
import crypto from "crypto";
import nodemailer from "../../upsertEmployeeWeb/node_modules/nodemailer/dist/esm/nodemailer.js";
import dotenv from "../../upsertEmployeeWeb/node_modules/dotenv/lib/main.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../../upsertEmployeeWeb/.env");
dotenv.config({ path: envPath });

const results = {
  spExists: null,
  spNineParams: null,
  spMd5InBody: null,
  spInsertMd5: null,
  cleanup: null,
  smtpVerify: null,
  smtpSend: null,
  httpCreate: null,
  loginAttempt: null,
};

const dbConfig = {
  host: process.env.DB_SERVER || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? "",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || "employee_attendance",
};

let conn;

try {
  conn = await mysql.createConnection(dbConfig);

  const [procRows] = await conn.query(
    `SELECT ROUTINE_NAME, ROUTINE_DEFINITION
     FROM information_schema.ROUTINES
     WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = 'web_upsertEmployee'`,
    [dbConfig.database]
  );
  results.spExists = procRows.length === 1;

  const [paramRows] = await conn.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.PARAMETERS
     WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = 'web_upsertEmployee' AND PARAMETER_MODE = 'IN'`,
    [dbConfig.database]
  );
  results.spNineParams = Number(paramRows[0]?.cnt) === 9;

  const [showRows] = await conn.query("SHOW CREATE PROCEDURE web_upsertEmployee");
  const body = showRows[0]?.["Create Procedure"] || "";
  results.spMd5InBody = /MD5\s*\(\s*p_password\s*\)/i.test(body);

  const [[refs]] = await conn.query(`
    SELECT
      (SELECT MIN(id) FROM role) AS roleId,
      (SELECT MIN(id) FROM designation) AS designationId,
      (SELECT MIN(id) FROM location WHERE active = 1) AS locationId
  `);
  if (!refs?.roleId || !refs?.designationId || !refs?.locationId) {
    throw new Error("Missing seed role/designation/location for smoke insert");
  }

  const plainPassword = "SmokeT3st!9xZ";
  const testEmail = `smoke-upsert-${Date.now()}@example.invalid`;
  const mobile = `9${String(Date.now()).slice(-9)}`;

  const [callResult] = await conn.query(
    `CALL web_upsertEmployee(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      null,
      "Smoke Test Employee",
      "2026-01-15",
      testEmail,
      mobile,
      refs.roleId,
      refs.designationId,
      String(refs.locationId),
      plainPassword,
    ]
  );
  const empId = callResult[0]?.[0]?.empId;
  if (!empId) {
    results.spInsertMd5 = false;
  } else {
    const [[row]] = await conn.query(
      "SELECT password FROM employee WHERE id = ?",
      [empId]
    );
    const expected = crypto.createHash("md5").update(plainPassword).digest("hex");
    results.spInsertMd5 = row?.password === expected;

    await conn.query("DELETE FROM employeelocation WHERE empId = ?", [empId]);
    const [del] = await conn.query("DELETE FROM employee WHERE id = ?", [empId]);
    results.cleanup = del.affectedRows === 1;
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;
  if (smtpHost && smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });
    try {
      await transporter.verify();
      results.smtpVerify = true;
    } catch {
      results.smtpVerify = false;
    }
    try {
      const info = await transporter.sendMail({
        from: smtpUser,
        to: smtpUser,
        subject: "[smoke] upsertEmployeeWeb welcome-email SMTP test",
        text: "Automated final-review smoke; safe to ignore.",
      });
      results.smtpSend = Boolean(info?.messageId);
    } catch {
      results.smtpSend = false;
    }
  } else {
    results.smtpVerify = "skipped_missing_smtp_env";
    results.smtpSend = "skipped_missing_smtp_env";
  }

  // Optional: login + HTTP create (no invented success)
  const loginWebEnv = path.join(__dirname, "../../loginWeb/.env");
  dotenv.config({ path: loginWebEnv });
  const [[adminRow]] = await conn.query(
    `SELECT e.id, e.email FROM employee e
     INNER JOIN role r ON r.id = e.roleId
     WHERE e.active = 1 AND LOWER(r.name) LIKE '%admin%'
     LIMIT 1`
  );
  if (adminRow?.email) {
    results.loginAttempt = { tried: true, email: adminRow.email, note: "no password in env; skipped web_validateLogin" };
  } else {
    results.loginAttempt = { tried: false, note: "no admin row found" };
  }
  results.httpCreate = "skipped_no_bearer_token";
} catch (err) {
  results.error = err.message;
} finally {
  if (conn) await conn.end();
}

console.log(JSON.stringify(results, null, 2));
