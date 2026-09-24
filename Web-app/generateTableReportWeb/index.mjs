import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());


// ============================================================
// DATABASE CONFIGURATION
// ============================================================

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


// ============================================================
// TOKEN VALIDATION
// ============================================================

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

        console.log(
            "User details from token:",
            user
        );

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

        console.error(
            "Token Validation Error:",
            error
        );

        return {
            valid: false,
            statusCode: 500,
            message: "Token validation failed"
        };
    }
};


// ============================================================
// LAMBDA HANDLER
// ============================================================

export const handler = async (event) => {

    try {

        // ========================================================
        // GET AUTHORIZATION HEADER
        // ========================================================

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


        // ========================================================
        // VALIDATE BEARER TOKEN FORMAT
        // ========================================================

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


        // ========================================================
        // VALIDATE TOKEN
        // ========================================================

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


        // ========================================================
        // GET ROLE ID FROM TOKEN
        // ========================================================

        const roleId = tokenResult.user.roleId;

        console.log(
            "Role ID from token:",
            roleId
        );


        // ========================================================
        // ROLE AUTHORIZATION
        //
        // Only Role ID 1 and 2 are allowed
        // ========================================================

        if (
            Number(roleId) !== 1 &&
            Number(roleId) !== 2
        ) {

            return {
                statusCode: 403,
                body: JSON.stringify({
                    success: false,
                    message: "You are not authorized to access monthly attendance"
                })
            };
        }


        // ========================================================
        // GET REQUEST BODY
        // ========================================================

        let body = event.body;

        if (!body) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Request body is required"
                })
            };
        }


        // ========================================================
        // API GATEWAY BODY IS STRING
        // ========================================================

        if (typeof body === "string") {

            try {

                body = JSON.parse(body);

            } catch (error) {

                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        success: false,
                        message: "Invalid JSON request body"
                    })
                };
            }
        }


        // ========================================================
        // GET MONTH FROM REQUEST
        // ========================================================

        const { month } = body;

        console.log(
            "Month received:",
            month
        );


        // ========================================================
        // VALIDATE MONTH
        // ========================================================

        if (
            month === undefined ||
            month === null ||
            month === ""
        ) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "month is required"
                })
            };
        }


        // ========================================================
        // VALIDATE MONTH FORMAT
        //
        // Expected:
        // AUG 2026
        // JAN 2026
        // DEC 2025
        // ========================================================

        if (
            typeof month !== "string" ||
            !/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}$/i.test(
                month.trim()
            )
        ) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "month must be in the format 'AUG 2026'"
                })
            };
        }


        const formattedMonth = month
            .trim()
            .toUpperCase();


        console.log(
            "Formatted month:",
            formattedMonth
        );


        // ========================================================
        // CALL MONTHLY ATTENDANCE STORED PROCEDURE
        // ========================================================

        const [results] = await pool.query(
            "CALL web_getEmployeeMonthlyAttendance(?)",
            [formattedMonth]
        );


        // ========================================================
        // GET RESULT SET
        // ========================================================

        /*
            The stored procedure returns one result set.

            Example:

            [
                {
                    id: 1,
                    name: "John",
                    designation: "Software Engineer",
                    client: "ABC",
                    allocatedLocations: "BLR01, BLR02",
                    "1": "P",
                    "2": "P",
                    "3": "L",
                    ...
                }
            ]
        */

        const attendanceRows = results[0] || [];


        // ========================================================
        // NO DATA
        // ========================================================

        if (attendanceRows.length === 0) {

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: "No employee attendance data found",
                    data: []
                })
            };
        }


        // ========================================================
        // FINAL RESPONSE
        // ========================================================

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                data: attendanceRows
            })
        };

    } catch (error) {

        console.error(
            "Get Employee Monthly Attendance API Error:",
            error
        );

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


// ============================================================
// LOCAL DEVELOPMENT SERVER
// ============================================================

const PORT = 3019;


app.post(
    "/web/employee-monthly-attendance",
    async (req, res) => {

        try {

            const result = await handler({

                httpMethod: "POST",

                headers: req.headers,

                body: JSON.stringify(req.body)

            });


            res
                .status(result.statusCode)
                .json(JSON.parse(result.body));

        } catch (error) {

            console.error(
                "Local API Error:",
                error
            );

            res
                .status(500)
                .json({
                    success: false,
                    message: "Internal server error"
                });
        }
    }
);


app.listen(PORT, () => {

    console.log(
        `Get Employee Monthly Attendance API running on port ${PORT}`
    );

});