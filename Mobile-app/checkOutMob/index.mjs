
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

// ============================================================
// DATABASE CONNECTION POOL
// ============================================================

let pool = null;

const getDbConnection = async () => {

    if (!pool) {

        pool = mysql.createPool(dbConfig);

        console.log("MySQL connection pool created");

    }

    return pool;
};

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

        const db = await getDbConnection();

        const [rows] = await db.query(
            "CALL mob_validateToken(?)",
            [token]
        );

        const user = rows?.[0]?.[0];

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

    }
    catch (error) {

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
// CHECKOUT API
// ============================================================
//
// POST /checkout
//
// Headers:
//
// Authorization: Bearer <token>
//
// Request body:
//
// {
//     "checkoutDateTime": "2026-09-18 18:00:00",
//     "checkoutLatitude": 12.9716000,
//     "checkoutLongitude": 77.5946000
// }
//
// empId is taken from the validated token.
//
// ============================================================

const checkOut = async (event, authenticatedUser) => {

    try {

        // --------------------------------------------------------
        // Get request body
        // --------------------------------------------------------

        let body = event.body;

        if (typeof body === "string") {

            try {

                body = JSON.parse(body);

            }
            catch (error) {

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

        const {
            checkoutDateTime,
            checkoutLocCode,
            checkoutLatitude,
            checkoutLongitude
        } = body || {};


        // --------------------------------------------------------
        // Employee ID from validated token
        // --------------------------------------------------------

        const employeeId =
            Number(authenticatedUser.id);


        if (
            !Number.isInteger(employeeId) ||
            employeeId <= 0
        ) {

            return {
                statusCode: 401,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "Invalid employee information in token"
                })
            };

        }


        // --------------------------------------------------------
        // Validate checkout datetime
        // --------------------------------------------------------

        if (!checkoutDateTime) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "checkoutDateTime is required"
                })
            };

        }


        // --------------------------------------------------------
        // Validate latitude
        // --------------------------------------------------------

        if (
            checkoutLatitude === undefined ||
            checkoutLatitude === null ||
            checkoutLatitude === ""
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "checkoutLatitude is required"
                })
            };

        }


        // --------------------------------------------------------
        // Validate longitude
        // --------------------------------------------------------

        if (
            checkoutLongitude === undefined ||
            checkoutLongitude === null ||
            checkoutLongitude === ""
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "checkoutLongitude is required"
                })
            };

        }


        // --------------------------------------------------------
        // Convert latitude / longitude
        // --------------------------------------------------------

        const latitude =
            Number(checkoutLatitude);

        const longitude =
            Number(checkoutLongitude);


        // --------------------------------------------------------
        // Validate latitude
        // --------------------------------------------------------

        if (
            !Number.isFinite(latitude) ||
            latitude < -90 ||
            latitude > 90
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "Invalid checkoutLatitude"
                })
            };

        }


        // --------------------------------------------------------
        // Validate longitude
        // --------------------------------------------------------

        if (
            !Number.isFinite(longitude) ||
            longitude < -180 ||
            longitude > 180
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "Invalid checkoutLongitude"
                })
            };

        }


        // --------------------------------------------------------
        // Get database
        // --------------------------------------------------------

        const db =
            await getDbConnection();


        // --------------------------------------------------------
        // Execute Checkout Stored Procedure
        // --------------------------------------------------------

        const [rows] = await db.query(

            "CALL mob_checkOut(?, ?, ?, ?, ?)",

            [
                employeeId,
                checkoutDateTime,
                checkoutLocCode,
                latitude,
                longitude
            ]

        );


        // --------------------------------------------------------
        // Get SP result
        // --------------------------------------------------------

        const result =
            rows?.[0]?.[0];


        console.log(
            "Checkout SP result:",
            result
        );


        // --------------------------------------------------------
        // Check result
        // --------------------------------------------------------

        if (
            !result ||
            Number(result.success) !== 1
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message:
                        result?.message ||
                        "Checkout failed"
                })
            };

        }


        // --------------------------------------------------------
        // Successful checkout
        // --------------------------------------------------------

        return {

            statusCode: 200,

            headers: getHeaders(),

            body: JSON.stringify({

                success: true,

                message:
                    result.message ||
                    "Checkout successful",

                data: {

                    empId:
                        employeeId,

                    checkoutDateTime:
                        checkoutDateTime,

                    checkoutLocCode: 
                        checkoutLocCode,

                    checkoutLatitude:
                        latitude,

                    checkoutLongitude:
                        longitude

                }

            })

        };

    }
    catch (error) {

        console.error(
            "Checkout API Error:",
            error
        );

        return {

            statusCode: 500,

            headers: getHeaders(),

            body: JSON.stringify({

                success: false,

                message:
                    "Unable to process checkout"

            })

        };

    }

};

// ============================================================
// AWS LAMBDA HANDLER
// ============================================================

export const handler = async (event) => {


    {
        const preflightMethod =
            event.requestContext?.http?.method ||
            event.httpMethod ||
            "POST";

        if (preflightMethod === "OPTIONS") {
            return {
                statusCode: 200,
                headers: getHeaders(),
                body: ""
            };
        }
    }

    try {

        console.log(
            "Lambda Event:",
            JSON.stringify(event)
        );


        // ========================================================
        // GET AUTHORIZATION HEADER
        // ========================================================

        const headers =
            event.headers || {};

        const authorization =
            headers.Authorization ||
            headers.authorization;


        if (!authorization) {

            return {

                statusCode: 401,

                headers: getHeaders(),

                body: JSON.stringify({

                    success: false,

                    message:
                        "Authorization token is required"

                })

            };

        }


        // ========================================================
        // VALIDATE BEARER TOKEN FORMAT
        // ========================================================

        const parts =
            authorization.trim().split(/\s+/);


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

                    message:
                        "Invalid authorization format"

                })

            };

        }


        const token =
            parts[1];


        // ========================================================
        // VALIDATE TOKEN
        // ========================================================

        const tokenResult =
            await validateToken(token);


        if (!tokenResult.valid) {

            return {

                statusCode:
                    tokenResult.statusCode,

                headers: getHeaders(),

                body: JSON.stringify({

                    success: false,

                    message:
                        tokenResult.message

                })

            };

        }


        // ========================================================
        // VALIDATED USER
        // ========================================================

        const user =
            tokenResult.user;


        console.log(
            "Authenticated user:",
            user
        );


        // ========================================================
        // GET REQUEST PATH
        // ========================================================

        const path =
            event.rawPath ||
            event.path ||
            "/mob/checkout";


        const method =
            event.requestContext?.http?.method ||
            event.httpMethod ||
            "POST";

        // ========================================================
        // CHECKOUT
        // ========================================================

        if (
            path === "/mob/checkout" &&
            method.toUpperCase() === "POST"
        ) {

            return await checkOut(
                event,
                user
            );

        }


        // ========================================================
        // API NOT FOUND
        // ========================================================

        return {

            statusCode: 404,

            headers: getHeaders(),

            body: JSON.stringify({

                success: false,

                message:
                    "API endpoint not found"

            })

        };

    }
    catch (error) {

        console.error(
            "Lambda Handler Error:",
            error
        );

        return {

            statusCode: 500,

            headers: getHeaders(),

            body: JSON.stringify({

                success: false,

                message:
                    "Internal server error"

            })

        };

    }

};


// ============================================================
// LOCAL DEVELOPMENT SERVER
// ============================================================

const PORT =
    process.env.PORT || 3004;


app.post(
    "/mob/checkout",
    async (req, res) => {

        try {

            const event = {

                body:
                    JSON.stringify(req.body),

                rawPath:
                    "/mob/checkout",

                headers:
                    req.headers,

                requestContext: {

                    http: {

                        method: "POST"

                    }

                }

            };


            const response =
                await handler(event);


            res
                .status(response.statusCode)
                .set(response.headers || {})
                .send(response.body);

        }
        catch (error) {

            console.error(
                "Local Checkout Error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Internal server error"

            });

        }

    }
);


app.listen(
    PORT,
    () => {

        console.log(
            `Checkout API running on http://localhost:${PORT}`
        );

    }
);