import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";


dotenv.config();



const getHeaders = () => ({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Requested-With,Accept,Origin",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT",
    "Access-Control-Max-Age": "86400"
});

// ============================================================
// DATABASE CONFIGURATION
// ============================================================

const dbConfig = {
    host: process.env.DB_SERVER || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "welcome@123",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "employee_attendance",

    // Recommended for Lambda/local usage
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};


// ============================================================
// DATABASE CONNECTION POOL
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || "digitalattendancewebapplication" ;

const JWT_EXPIRES_IN = process.env.EXP_TIME || "30d";

let pool;

const getDbConnection = async () => {

    if (!pool) {
        pool = mysql.createPool(dbConfig);

        console.log("MySQL connection pool created");
    }

    return pool;
};


// ============================================================
// LOGIN API
// ============================================================

const login = async (event) => {

    try {

        // --------------------------------------------------------
        // Get request body
        // --------------------------------------------------------

        let body = event.body;

        if (typeof body === "string") {
            body = JSON.parse(body);
        }

        const { employeeId, password } = body || {};


        // --------------------------------------------------------
        // Validate request
        // --------------------------------------------------------

        if (!employeeId || !password) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Employee Id and password are required"
                })
            };
        }


        // --------------------------------------------------------
        // Get database pool
        // --------------------------------------------------------

        const db = await getDbConnection();


        // --------------------------------------------------------
        // Execute Stored Procedure
        // --------------------------------------------------------

        const [results] = await db.query(
            "CALL mob_validateLogin(?, ?)",
            [employeeId, password]
        );


        // --------------------------------------------------------
        // Stored procedure returns an array
        //
        // results[0] = SELECT result
        // --------------------------------------------------------

        const employees = results[0];


        // --------------------------------------------------------
        // Employee not found
        // --------------------------------------------------------

        if (!employees || employees.length === 0) {

            return {
                statusCode: 401,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Invalid employee Id or password"
                })
            };
        }


        // --------------------------------------------------------
        // Employee found
        // --------------------------------------------------------

        const employee = employees[0];

        const token = jwt.sign(
            {
                empId: employee.id,
                email: employee.email,
                roleId: employee.roleId,
                roleName: employee.empRole
            },
            JWT_SECRET,
            {
                expiresIn: JWT_EXPIRES_IN
            }
        );

        const createdDate = new Date();
        const expiryTime = new Date(createdDate.getTime() + 30 * 24 * 60 * 60 * 1000);

        await db.query(
            "CALL mob_upsertUserToken(?, ?, ?, ?)",
            [
                employee.id,
                token,
                expiryTime,
                createdDate
            ]
        );

        return {
            statusCode: 200,
            headers: getHeaders(),
            body: JSON.stringify({
                success: true,
                message: "Login successful",
                data: {
                    empId: employee.id,
                    empName: employee.name,
                    empPhNumber: employee.mobileNumber,
                    empEmail: employee.email,
                    empRoleId: employee.roleId,
                    empRole: employee.empRole,
                    empDesignationId: employee.designationId,
                    empDesignation: employee.empDesignation,
                    empClientId: employee.clientId,
                    empClient: employee.client,
                    empProfilePic: employee.profileImg,
                    token: token,
                    reportingId: employee.ReportingId
                }
            })
        };

    } catch (error) {

        console.error("Login API Error:", error);

        return {
            statusCode: 500,
            headers: getHeaders(),
            body: JSON.stringify({
                success: false,
                message: "Internal server error"
            })
        };
    }
};


// ============================================================
// AWS LAMBDA HANDLER
// ============================================================

export const handler = async (event) => {

    console.log("Lambda event:", JSON.stringify(event));

    const path = event.rawPath || event.path || "";
    const method = event.requestContext?.http?.method ||
                   event.httpMethod ||
                   "POST";

    if (method === "OPTIONS") {
        return {
            statusCode: 200,
            headers: getHeaders(),
            body: ""
        };
    }

    // --------------------------------------------------------
    // LOGIN
    // --------------------------------------------------------

    if (path === "/mob/login" && method === "POST") {
        return await login(event);
    }


    // --------------------------------------------------------
    // DEFAULT RESPONSE
    // --------------------------------------------------------

    return {
        statusCode: 404,
        headers: getHeaders(),
        body: JSON.stringify({
            success: false,
            message: "API endpoint not found"
        })
    };
};


// ============================================================
// LOCAL DEVELOPMENT SERVER
// ============================================================
//
// This section is ONLY for running locally.
//
// When deploying to AWS Lambda, this section will not be used.
// ============================================================

const app = express();


app.use((req, res, next) => {
    res.set(getHeaders());

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    next();
});

app.use(express.json());


// ------------------------------------------------------------
// Local Login API
// ------------------------------------------------------------

app.post("/mob/login", async (req, res) => {

    try {

        const event = {
            body: JSON.stringify(req.body),
            rawPath: "/mob/login",
            requestContext: {
                http: {
                    method: "POST"
                }
            }
        };

        const response = await handler(event, {});

        res
            .status(response.statusCode)
            .set(response.headers)
            .send(response.body);

    } catch (error) {

        console.error("Local API Error:", error);

        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});


// ------------------------------------------------------------
// Health Check
// ------------------------------------------------------------

app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "Employee Attendance API is running"
    });

});


// ============================================================
// START LOCAL SERVER
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(`Local API running on http://localhost:${PORT}`);

});