import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();


const getHeaders = () => ({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Requested-With,Accept,Origin",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT",
    "Access-Control-Max-Age": "86400"
});

const app = express();

app.use((req, res, next) => {
    res.set(getHeaders());

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    next();
});

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

    const method =
        event.requestContext?.http?.method ||
        event.httpMethod ||
        "POST";

    if (method === "OPTIONS") {
        return {
            statusCode: 200,
            headers: getHeaders(),
            body: ""
        };
    }

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
                headers: getHeaders(),
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
            parts[0].toLowerCase() !== "bearer" ||
            !parts[1]
        ) {

            return {
                statusCode: 401,
                headers: getHeaders(),
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
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: tokenResult.message
                })
            };
        }

        console.log(
            "Authenticated user:",
            tokenResult.user
        );


        // ====================================================
        // GET SUPERVISOR ID FROM TOKEN (employeeId)
        // ====================================================

        const supervisorId = Number(tokenResult.user.id);

        if (!supervisorId || Number.isNaN(supervisorId)) {

            return {
                statusCode: 401,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Invalid employee ID in token"
                })
            };
        }


        // ====================================================
        // GET DATE FROM QUERY STRING
        // ====================================================
        //
        // Example: /mob/team-status?date=2026-09-18
        //
        // ====================================================

        const query =
            event.queryStringParameters ||
            event.query ||
            {};

        const date = query.date;

        if (
            date === undefined ||
            date === null ||
            String(date).trim() === ""
        ) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "date query parameter is required"
                })
            };
        }

        const attendanceDate = String(date).trim();

        // Validate YYYY-MM-DD format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "date must be in YYYY-MM-DD format"
                })
            };
        }


        // ====================================================
        // CALL STORED PROCEDURE
        // ====================================================
        //
        // mob_getTeamStatus(p_supervisorId, p_date)
        //
        // Result set 1: team attendance status
        // Result set 2: unresolved exceptions for supervisor
        //
        // ====================================================

        const [procedureResult] = await pool.query(
            "CALL mob_getTeamStatus(?, ?)",
            [supervisorId, attendanceDate]
        );

        const teamStatus = procedureResult?.[0] || [];
        const unresolvedExceptions = procedureResult?.[1] || [];


        // ====================================================
        // FINAL RESPONSE
        // ====================================================

        return {
            statusCode: 200,
            headers: getHeaders(),
            body: JSON.stringify({
                success: true,
                data: {
                    supervisorId,
                    date: attendanceDate,
                    teamStatus,
                    unresolvedExceptions
                }
            })
        };

    } catch (error) {

        console.error("Team Status API Error:", error);

        return {
            statusCode: 500,
            headers: getHeaders(),
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

const PORT = 3011;

app.get(
    "/mob/team-status",
    async (req, res) => {

        try {

            const result = await handler({

                httpMethod: "GET",

                headers: req.headers,

                queryStringParameters: req.query

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
        `Team Status API running on port ${PORT}`
    );

});
