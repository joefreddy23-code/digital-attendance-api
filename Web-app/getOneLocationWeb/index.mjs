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


// ============================================================
// LAMBDA HANDLER
// ============================================================

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


        // API Gateway sends body as a string
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


        // ====================================================
        // GET LOCATION ID
        // ====================================================

        const { locationId } = body;


        // ====================================================
        // VALIDATE LOCATION ID
        // ====================================================

        console.log("locationId", locationId);
        

        if (
            locationId === undefined ||
            locationId === null ||
            locationId === ""
        ) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "locationId is required"
                })
            };
        }

        console.log(
            "Location ID from body:",
            locationId
        );


        // ============================================================
        // VALIDATE EMPLOYEE ID
        // ============================================================

        if (
            !Number.isInteger(locationId) ||
            locationId <= 0
        ) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Invalid employee ID from token"
                })
            };
        }
        // ============================================================
        // VALIDATE EMPLOYEE ID
        // ============================================================

        if (!locationId) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "locationId is required"
                })
            };
        }



        if (!Number.isInteger(locationId) || locationId <= 0) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "locationId must be a valid positive integer"
                })
            };
        }


        console.log("Employee ID:", locationId);


        // ============================================================
        // GET EMPLOYEE DETAILS
        // ============================================================

        const [results] = await pool.query(
            "CALL web_getOneLocation(?)",
            [locationId]
        );


        // ============================================================
        // GET RESULT SETS
        // ============================================================

        /*
            Stored procedure returns TWO result sets:

            employeeRows[0] -> Employee details
            employeeRows[1] -> Last 5 days attendance
        */

        const locationResult =
            results[0]?.[0];


        // ============================================================
        // EMPLOYEE NOT FOUND
        // ============================================================

        if (!locationResult) {

            return {
                statusCode: 404,
                body: JSON.stringify({
                    success: false,
                    message: "locationResult not found"
                })
            };
        }


        // ============================================================
        // FORMAT EMPLOYEE DETAILS
        // ============================================================

        const locationData = {

            id: locationResult.id,

            code: locationResult.code,

            physicalAddress: locationResult.physicalAddress,

            city: locationResult.city,

            radiusInMeters: locationResult.radiusInMeters,

            latitude: locationResult.latitude,

            longitude: locationResult.longitude
            }

        // ============================================================
        // FINAL RESPONSE
        // ============================================================

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                data: {
                    location: locationData
                }
            })
        };

    } catch (error) {

        console.error(
            "Get One Location Details API Error:",
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

const PORT = 3016;

app.post("/web/location", async (req, res) => {

    try {

        const result = await handler({

            httpMethod: "GET",

            headers: req.headers,
            body: JSON.stringify(req.body),

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
        `Get One Location Details API running on port ${PORT}`
    );

});