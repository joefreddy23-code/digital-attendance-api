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
            "CALL mob_validateToken(?)",
            [token]
        );

        const user = rows[0]?.[0];

        console.log("User details from token:", user);

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


// ============================================================
// LAMBDA HANDLER
// ============================================================

export const handler = async (event) => {

    try {

        // ====================================================
        // GET AUTHORIZATION HEADER
        // ====================================================

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


        // ====================================================
        // VALIDATE BEARER TOKEN FORMAT
        // ====================================================

        const parts = authorization.trim().split(/\s+/);

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


        // ====================================================
        // VALIDATE TOKEN
        // ====================================================

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


        // ====================================================
        // GET EMPLOYEE ID FROM TOKEN
        // ====================================================

        const empId = Number(tokenResult.user.id);

        console.log("Employee ID:", empId);


        if (!empId || Number.isNaN(empId)) {

            return {
                statusCode: 401,
                body: JSON.stringify({
                    success: false,
                    message: "Invalid employee ID in token"
                })
            };
        }


        // ====================================================
        // GET LAST 4 DAYS ATTENDANCE STATUS
        // ====================================================

        const [statusRows] = await pool.query(
            "CALL mob_checkStatus(?)",
            [empId]
        );

        /*
         * MySQL stored procedure result:
         *
         * statusRows[0] = actual result rows
         * statusRows[1] = metadata
         *
         * Example:
         *
         * statusRows[0] = [
         *   {
         *      empId: 1,
         *      day: "Friday",
         *      date: "2026-09-18",
         *      isPresent: 1,
         *      checkinDatetime: "...",
         *      checkoutDatetime: "..."
         *   },
         *   {
         *      empId: 1,
         *      day: "Saturday",
         *      date: "2026-09-19",
         *      isPresent: null,
         *      checkinDatetime: null,
         *      checkoutDatetime: null
         *   },
         *   ...
         * ]
         */

        const statusResult = statusRows[0] || [];


        // ====================================================
        // RESPONSE DATA
        // ====================================================

        const responseData = {

            last4DaysStatus: statusResult

        };


        // ====================================================
        // FINAL RESPONSE
        // ====================================================

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                data: responseData
            })
        };

    } catch (error) {

        console.error("Check Status API Error:", error);

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
// LOCAL EXPRESS API
// ============================================================

const PORT = 3007;

app.get("/mob/check-status", async (req, res) => {

    try {

        const result = await handler({
            httpMethod: "GET",
            headers: req.headers
        });

        res
            .status(result.statusCode)
            .json(JSON.parse(result.body));

    } catch (error) {

        console.error("Express API Error:", error);

        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});


app.listen(PORT, () => {
    console.log(`Check Status API running on port ${PORT}`);
});