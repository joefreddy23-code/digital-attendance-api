import express from "express";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();


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
// NODEMAILER CONFIGURATION
// ============================================================

const transporter = nodemailer.createTransport({

    host: process.env.SMTP_HOST || "smtp.gmail.com",

    port: Number(process.env.SMTP_PORT || 587),

    secure: false,

    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }

});


// ============================================================
// GENERATE TEMPORARY PASSWORD
// ============================================================
//
// Password Policy:
//
// Minimum 12 characters
// At least 1 uppercase
// At least 1 lowercase
// At least 1 number
// At least 1 special character
//
// Example:
// K8@pL2#xQ9mA
//
// ============================================================

const generateTemporaryPassword = () => {

    const uppercase =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    const lowercase =
        "abcdefghijklmnopqrstuvwxyz";

    const numbers =
        "0123456789";

    const special =
        "!@#$%^&*";

    const allCharacters =
        uppercase +
        lowercase +
        numbers +
        special;


    const getRandomCharacter = (characters) => {

        return characters[
            Math.floor(
                Math.random() * characters.length
            )
        ];

    };


    // Make sure required character types are included

    let password = "";

    password += getRandomCharacter(uppercase);

    password += getRandomCharacter(lowercase);

    password += getRandomCharacter(numbers);

    password += getRandomCharacter(special);


    // Generate remaining characters

    while (password.length < 12) {

        password += getRandomCharacter(
            allCharacters
        );

    }


    // Shuffle password

    password = password
        .split("")
        .sort(() => Math.random() - 0.5)
        .join("");


    return password;
};


// ============================================================
// FORGOT PASSWORD API
// ============================================================
//
// Request:
//
// POST /forgot-password
//
// Body:
//
// {
//     "employeeId": 101
// }
//
// Flow:
//
// employeeId
//      ↓
// Generate temporary password
//      ↓
// usp_UpdateTemporaryPassword
//      ↓
// Validate employee
//      ↓
// Update password
//      ↓
// Get employee email
//      ↓
// Send email
//
// ============================================================

const forgotPassword = async (event) => {

    try {

        // --------------------------------------------------------
        // Get request body
        // --------------------------------------------------------

        let body = event.body;

        if (typeof body === "string") {

            body = JSON.parse(body);

        }


        const {
            employeeId,
            empEmail
        } = body || {};


        // --------------------------------------------------------
        // Validate employeeId
        // --------------------------------------------------------

        if (
            (employeeId === undefined ||
            employeeId === null ||
            employeeId === "" ) && (empEmail === "")
        ) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "employeeId or employeeEmail is required"

                })

            };

        }


        // --------------------------------------------------------
        // Validate employeeId is a number
        // --------------------------------------------------------

        if (
            (isNaN(employeeId) ||
            Number(employeeId) <= 0) && !empEmail
        ) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "employeeId or empEmail must be a valid number"

                })

            };

        }


        // --------------------------------------------------------
        // Get database connection
        // --------------------------------------------------------

        const db =
            await getDbConnection();


        // --------------------------------------------------------
        // Generate temporary password
        // --------------------------------------------------------

        const temporaryPassword =
            generateTemporaryPassword();


        console.log(
            `Temporary password generated for employee`
        );


        // --------------------------------------------------------
        // Update password using Stored Procedure
        // --------------------------------------------------------

        let empId = null;

        if (Number(employeeId))
            {
                empId = Number(employeeId)
            }
        else null

        const [results] = await db.query(

            "CALL web_updateTemporaryPassword(?, ?, ?)",

            [
                empId, empEmail,
                temporaryPassword
            ]

        );


        // --------------------------------------------------------
        // Get SP result
        // --------------------------------------------------------

        const result =
            results?.[0]?.[0];


        // --------------------------------------------------------
        // Check SP response
        // --------------------------------------------------------

        if (!result) {

            return {

                statusCode: 500,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Unable to process password reset"

                })

            };

        }


        // --------------------------------------------------------
        // Invalid employee / inactive employee
        // --------------------------------------------------------

        if (result.success === 0) {

            return {

                statusCode: 404,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Invalid employee ID or employee is inactive"

                })

            };

        }


        // --------------------------------------------------------
        // Validate email
        // --------------------------------------------------------

        if (!result.email) {

            return {

                statusCode: 400,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    success: false,

                    message:
                        "Employee email address is not available"

                })

            };

        }


        // --------------------------------------------------------
        // Send temporary password through email
        // --------------------------------------------------------

        await transporter.sendMail({

            from:
                `"Employee Attendance" <${process.env.SMTP_USER}>`,

            to:
                result.email,

            subject:
                "Temporary Password - Employee Attendance",

            html: `

                <div
                    style="
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        max-width: 600px;
                    "
                >

                    <h2>
                        Password Reset
                    </h2>

                    <p>
                        Hello ${result.name},
                    </p>

                    <p>
                        Your password reset request has
                        been processed successfully.
                    </p>

                    <p>
                        Your temporary password is:
                    </p>

                    <div
                        style="
                            display: inline-block;
                            padding: 12px 20px;
                            background-color: #f3f3f3;
                            border-radius: 6px;
                            font-size: 20px;
                            font-weight: bold;
                            letter-spacing: 2px;
                        "
                    >
                        ${temporaryPassword}
                    </div>

                    <p>
                        Please use this temporary password
                        to log in to the Employee Attendance
                        application.
                    </p>

                    <p>
                        Please change your password after
                        logging in.
                    </p>

                    <br>

                    <p>
                        Regards,<br>
                        Employee Attendance Team
                    </p>

                </div>

            `

        });


        // --------------------------------------------------------
        // Success response
        // --------------------------------------------------------

        return {

            statusCode: 200,

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                success: true,

                message:
                    "Temporary password has been sent to the employee email"

            })

        };

    }
    catch (error) {

        console.error(
            "Forgot Password API Error:",
            error
        );


        return {

            statusCode: 500,

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                success: false,

                message:
                    "Unable to process forgot password request"

            })

        };

    }

};


// ============================================================
// AWS LAMBDA HANDLER
// ============================================================

export const handler = async (
    event,
    context
) => {

    console.log(
        "Lambda Event:",
        JSON.stringify(event)
    );


    const path =
        event.rawPath ||
        event.path ||
        "/forgot-password";


    const method =
        event.requestContext?.http?.method ||
        event.httpMethod ||
        "POST";


    // --------------------------------------------------------
    // Forgot Password
    // --------------------------------------------------------

    if (
        path === "/forgot-password" &&
        method === "POST"
    ) {

        return await forgotPassword(event);

    }


    // --------------------------------------------------------
    // API not found
    // --------------------------------------------------------

    return {

        statusCode: 404,

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({

            success: false,

            message:
                "API endpoint not found"

        })

    };

};


// ============================================================
// LOCAL DEVELOPMENT SERVER
// ============================================================
//
// This section is only used when running locally.
//
// AWS Lambda will use the handler above.
//
// ============================================================

const app = express();

app.use(express.json());


// ============================================================
// LOCAL FORGOT PASSWORD API
// ============================================================

app.post(
    "/web/forgot-password",
    async (req, res) => {

        try {

            const event = {

                body:
                    JSON.stringify(req.body),

                rawPath:
                    "/forgot-password",

                requestContext: {

                    http: {

                        method: "POST"

                    }

                }

            };


            const response =
                await handler(event, {});


            res
                .status(response.statusCode)
                .set(response.headers)
                .send(response.body);

        }
        catch (error) {

            console.error(
                "Local API Error:",
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


// ============================================================
// LOCAL SERVER
// ============================================================

const PORT =
    process.env.PORT || 3006;


app.listen(
    PORT,
    () => {

        console.log(
            `Forgot Password API running on http://localhost:${PORT}/web`
        );

    }
);