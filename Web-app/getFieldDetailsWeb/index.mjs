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
            "CALL web_validateToken(?)",
            [token]
        );

        const user = rows[0]?.[0];

        console.log("User details from token is:", user);

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
                headers: getHeaders(),
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
                headers: getHeaders(),
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
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: tokenResult.message
                })
            };
        }

        const [results] = await pool.query(
            "CALL web_getRolesDesignationsReportingEmployees()"
        );

        const roles =
            results[0] || [];

        const designation =
            results[1] || [];

        const reportingEmployees =
            results[2] || [];

        const locations = 
            results[3] || [];

 return {
            statusCode: 200,
            headers: getHeaders(),
            body: JSON.stringify({
                success: true,
                data: {
                    roles: roles,
                    designation: designation,
                    reportingEmployees: reportingEmployees,
                    locations: locations
                }
            })
        };

    } catch (error) {

        console.error(
            "Get One Employee Details API Error:",
            error
        );

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



const PORT = 3011;

app.get("/web/getFields", async (req, res) => {

    try {

        const result = await handler({

            httpMethod: "GET",

            headers: req.headers,

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
});


app.listen(PORT, () => {

    console.log(
        `Get One Employee Details API running on port ${PORT}`
    );

});