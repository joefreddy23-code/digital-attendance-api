import mysql from "mysql2/promise";

const c = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "welcome@123",
    database: "employee_attendance"
});

const [r] = await c.query("SHOW CREATE PROCEDURE web_upsertEmployee");
const body = r[0]["Create Procedure"];
console.log("has p_password", /p_password/.test(body));
console.log("has MD5", /MD5\s*\(\s*p_password\s*\)/i.test(body));
await c.end();
