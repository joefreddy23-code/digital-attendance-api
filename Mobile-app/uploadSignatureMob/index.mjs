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
        // GET EMPLOYEE ID FROM TOKEN
        // ====================================================

        const employeeId = tokenResult.user.id;

        if (!employeeId) {

            return {
                statusCode: 401,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Employee ID not found in token"
                })
            };
        }


        // ====================================================
        // GET REQUEST BODY
        // ====================================================

        let body = event.body;

        if (!body) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Request body is required"
                })
            };
        }


        // ====================================================
        // PARSE REQUEST BODY
        // ====================================================

        if (typeof body === "string") {

            try {

                body = JSON.parse(body);

            } catch (error) {

                return {
                    statusCode: 400,
                    headers: getHeaders(),
                    body: JSON.stringify({
                        success: false,
                        message: "Invalid JSON request body"
                    })
                };
            }
        }


        // ====================================================
        // GET SIGNATURE URL
        // ====================================================

        const { signatureUrl } = body;


        // ====================================================
        // VALIDATE SIGNATURE URL
        // ====================================================

        if (
            signatureUrl === undefined ||
            signatureUrl === null ||
            String(signatureUrl).trim() === ""
        ) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "signatureUrl is required"
                })
            };
        }


        // ====================================================
        // CALL STORED PROCEDURE
        // ====================================================

        const [results] = await pool.query(
            "CALL mob_uploadSignature(?, ?)",
            [
                employeeId,
                signatureUrl
            ]
        );


        // ====================================================
        // GET STORED PROCEDURE RESPONSE
        // ====================================================

        const uploadResult = results[0]?.[0];

        console.log(
            "Upload signature result:",
            uploadResult
        );

        if (!uploadResult) {

            return {
                statusCode: 500,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Unable to upload signature"
                })
            };
        }


        // ====================================================
        // HANDLE SP FAILURE
        // ====================================================

        if (uploadResult.success !== 1) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: uploadResult.message
                })
            };
        }


        // ====================================================
        // SUCCESS RESPONSE
        // ====================================================

        return {
            statusCode: 200,
            headers: getHeaders(),
            body: JSON.stringify({
                success: true,
                data: {
                    empId: uploadResult.empId,
                    message: uploadResult.message
                }
            })
        };

    } catch (error) {

        console.error(
            "Upload Signature API Error:",
            error
        );

        return {
            statusCode: 500,
            headers: getHeaders(),
            body: JSON.stringify({
                success: false,
                message: error.sqlMessage || error.message
            })
        };
    }
};


// ============================================================
// LOCAL EXPRESS API
// ============================================================

const PORT = 3009;

app.post(
    "/mob/upload-signature",
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
        `Upload Signature API running on port ${PORT}`
    );

});