import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

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

const pool = mysql.createPool(dbConfig);
const validateToken = async (token) => {

    if (!token) {
        return {
            valid: false,
            statusCode: 401,
            message: "Authorization token is required"
        };
    }

    try {

        const [rows] = await pool.query(
            "CALL web_validateToken(?)",
            [token]
        );

        const user = rows[0]?.[0];
        console.log("User details from token is :", user);
        

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
export const handler = async (event) => {

    try {

        // ============================================================
        // GET AUTHORIZATION HEADER
        // ============================================================

        const headers = event.headers || {};

        const authorization =
            headers.Authorization ||
            headers.authorization;

        if (!authorization) {

            return {
                statusCode: 401,
                body: JSON.stringify({
                    success: false,
                    message: "Authorization token is required"
                })
            };
        }


        // ============================================================
        // VALIDATE BEARER TOKEN FORMAT
        // ============================================================

        const parts = authorization.split(" ");

        if (
            parts.length !== 2 ||
            parts[0].toLowerCase() !== "bearer"
        ) {

            return {
                statusCode: 401,
                body: JSON.stringify({
                    success: false,
                    message: "Invalid authorization format"
                })
            };
        }

        const token = parts[1];


        // ============================================================
        // VALIDATE TOKEN
        // ============================================================

        const tokenResult = await validateToken(token);

        if (!tokenResult.valid) {

            return {
                statusCode: tokenResult.statusCode,
                body: JSON.stringify({
                    success: false,
                    message: tokenResult.message
                })
            };
        }


        // ============================================================
        // GET ROLE ID FROM VALIDATED TOKEN
        // ============================================================

        let roleId = Number(tokenResult.user.roleId);
        console.log("Token result is:", tokenResult);
        
        console.log("RoleId :", roleId);
        


        // ============================================================
        // ATTENDANCE DASHBOARD
        // ============================================================

        const [attendanceRows] = await pool.query(
            "CALL web_getAttendanceDashboard()"
        );

        const attendanceResult =
            attendanceRows[0]?.[0];


        // ============================================================
        // EMPLOYEES BY CITY
        // ============================================================

        const [cityRows] = await pool.query(
            "CALL web_getEmployeesByCity()"
        );

        const employeesByCity =
            cityRows[0] || [];


        // ============================================================
        // SUPERVISOR QUERIES
        // ONLY FOR ROLE ID = 2
        // ============================================================

        let supervisorQueries = [];

        if (roleId == 2) {

            const [queriesRows] = await pool.query(
                "CALL web_retrieveSupervisorQuereies()"
            );

            supervisorQueries =
                queriesRows[0] || [];
        }


        // ============================================================
        // RESPONSE DATA
        // ============================================================

        const responseData = {

            totalEmployees:
                attendanceResult?.totalEmployees || 0,

            totalCheckedIn:
                attendanceResult?.totalCheckedIn || 0,

            yettoCheckIn:
                attendanceResult?.yettoCheckIn || 0,

            employeesByCity: employeesByCity.map(row => ({
                city: row.city,
                employeeCount: row.employeeCount
            }))
        };


        // ============================================================
        // ADD SUPERVISOR QUERIES ONLY FOR ROLE ID = 2
        // ============================================================

        if (roleId == 2) {

            responseData.supervisorQueries =
                supervisorQueries.map(row => ({
                    exceptionId: row.exceptionId,
                    employeeId: row.employeeId,
                    employeeName: row.employeeName,
                    attendanceId: row.attendanceId,
                    issueNote: row.issueNote,
                    checkinDatetime: row.checkinDatetime
                }));
        }


        // ============================================================
        // FINAL RESPONSE
        // ============================================================

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                data: responseData
            })
        };

    } 
 catch (error) {

        console.error("Overview API Error:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: "Internal server error",
                error: error.message
            })
        };
    }
};

const PORT = 3007;

app.get("/web/overview", async (req, res) => {

    const result = await handler({
        httpMethod: "GET",

        // Pass request headers to Lambda-style handler
        headers: req.headers
    });

    res
        .status(result.statusCode)
        .json(JSON.parse(result.body));

});


app.listen(PORT, () => {
    console.log(`Overview API running on port ${PORT}`);
});