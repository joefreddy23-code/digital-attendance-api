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
            "User details from token is:",
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

        console.log(
            "Authenticated user:",
            tokenResult.user
        );


        // ====================================================
        // GET REQUEST BODY
        // ====================================================

        let body = event.body;
        let employeeId = tokenResult.user.id;

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

        const { oldPassword, newPassword } = body;


        // ====================================================
        // VALIDATE LOCATION ID
        // ====================================================

        console.log("Old P and New P", oldPassword, newPassword);
        

        if (
            (oldPassword === undefined ||
            oldPassword === null ||
            oldPassword === "") || ( newPassword === undefined || newPassword === null || newPassword === "")
        ) {

            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: "Old Password and New Password is required"
                })
            };
        }



        // ====================================================
        // CALL STORED PROCEDURE
        // ====================================================

        const [results] = await pool.query(
            "CALL web_changePassword(?,?,?)",
            [employeeId, oldPassword, newPassword]
        );


        // ====================================================
        // GET STORED PROCEDURE RESPONSE
        // ====================================================

        const changePasswordResult =
            results[0]?.[0];


        if (!changePasswordResult) {

            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Password cannot be changed"
                })
            };
        }


        // ====================================================
        // SUCCESS RESPONSE
        // ====================================================

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                data: {
                    empId: changePasswordResult.empId,
                    message: changePasswordResult.message
                }
            })
        };

    } catch (error) {

        console.error(
            "Change Password API Error:",
            error
        );


        // ====================================================
        // STORED PROCEDURE ERROR
        // ====================================================

        return {
            statusCode: 500,
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

const PORT = 3015;

app.post(
    "/web/change-password",
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
        `Change Password API running on port ${PORT}`
    );

});