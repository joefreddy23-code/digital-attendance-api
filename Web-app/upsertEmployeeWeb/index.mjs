import express from "express";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
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


        // API Gateway sends body as a string
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
        // GET REQUEST PARAMETERS
        // ====================================================

        const {
            empId,
            fullName,
            joiningDate,
            email,
            mobileNumber,
            roleId,
            designationId,
            clientId,
            locationIds,
            profileImgPath
        } = body;


        // ====================================================
        // BASIC VALIDATION
        // ====================================================

        if (!fullName) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "fullName is required"
                })
            };
        }

        if (!joiningDate) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "joiningDate is required"
                })
            };
        }

        if (!email) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "email is required"
                })
            };
        }

        if (!mobileNumber) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "mobileNumber is required"
                })
            };
        }

        if (!roleId) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "roleId is required"
                })
            };
        }

        if (!designationId) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "designationId is required"
                })
            };
        }

        if (!clientId) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "clientId is required"
                })
            };
        }

        if (!profileImgPath) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Profile Image is required"
                })
            };
        }

        if (
            !Array.isArray(locationIds) ||
            locationIds.length === 0
        ) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "At least one locationId is required"
                })
            };
        }

        const parsedEmpId = Number(empId);

        if (!Number.isInteger(parsedEmpId) || parsedEmpId <= 0) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "empId is required and must be a valid positive integer"
                })
            };
        }


        // ====================================================
        // CONVERT LOCATION IDS TO CSV
        // ====================================================

        /*
            Example:

            locationIds: [1, 2, 3]

            becomes:

            "1,2,3"

            This matches the stored procedure parameter
            p_locationIds VARCHAR(1000)
        */

        const locationIdsString =
            locationIds.join(",");


        console.log(
            "Upserting employee:",
            {
                empId,
                fullName,
                joiningDate,
                email,
                mobileNumber,
                roleId,
                designationId,
                clientId,
                locationIds: locationIdsString,
                profileImgPath
            }
        );

        const temporaryPassword = generateTemporaryPassword();


        // ====================================================
        // CALL STORED PROCEDURE
        // ====================================================

        const [results] = await pool.query(
            `CALL web_upsertEmployee(
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )`,
            [
                parsedEmpId,
                fullName,
                joiningDate,
                email,
                mobileNumber,
                roleId,
                designationId,
                clientId,
                locationIdsString,
                temporaryPassword,
                profileImgPath
            ]
        );


        // ====================================================
        // GET STORED PROCEDURE RESPONSE
        // ====================================================

        const employeeResult =
            results[0]?.[0];


        if (!employeeResult) {

            return {
                statusCode: 500,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Employee could not be saved"
                })
            };
        }

        const isCreated =
            Number(employeeResult.isCreated) === 1;

        if (isCreated) {

            try {

                await transporter.sendMail({
                    from: `"Employee Attendance" <${process.env.SMTP_USER}>`,
                    to: email,
                    subject: "Welcome - Employee Attendance Account",
                    html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px;">
                    <h2>Welcome to Employee Attendance</h2>
                    <p>Hello ${fullName},</p>
                    <p>
                        Your employee account has been created successfully.
                        You can log in using the credentials below.
                    </p>
                    <p><strong>Employee No:</strong> ${empId}</p>
                    <p>Your temporary password is:</p>
                    <div style="
                        display: inline-block;
                        padding: 12px 20px;
                        background-color: #f3f3f3;
                        border-radius: 6px;
                        font-size: 20px;
                        font-weight: bold;
                        letter-spacing: 2px;
                    ">
                        ${temporaryPassword}
                    </div>
                    <p>
                        Please change your password after logging in.
                    </p>
                    <br>
                    <p>
                        Regards,<br>
                        Employee Attendance Team
                    </p>
                </div>
            `
                });

            } catch (emailError) {

                console.error(
                    "Welcome email failed for employee:",
                    employeeResult.empId,
                    emailError
                );

                return {
                    statusCode: 500,
                    headers: getHeaders(),
                    body: JSON.stringify({
                        success: false,
                        empId: employeeResult.empId,
                        message:
                            "Employee created successfully, but welcome email failed to send"
                    })
                };
            }
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
                    empId: employeeResult.empId,
                    message: employeeResult.message
                }
            })
        };

    } catch (error) {

        console.error(
            "Upsert Employee API Error:",
            error
        );


        // ====================================================
        // STORED PROCEDURE ERROR
        // ====================================================

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

const PORT = 3012;

app.post(
    "/web/upsertemployee",
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
        `Upsert Employee API running on port ${PORT}`
    );

});