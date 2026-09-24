import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

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

const JWT_SECRET = process.env.JWT_SECRET ;

const JWT_EXPIRES_IN = process.env.EXP_TIME;

let pool;

const getDbConnection = async () => {

    if (!pool) {

        pool = mysql.createPool(dbConfig);

        console.log("MySQL connection pool created");
    }

    return pool;
};

const login = async (event) => {

    try {

        let body = event.body;

        if (typeof body === "string") {
            body = JSON.parse(body);
        }

        const {
            empId,
            email,
            password
        } = body || {};

        if ((!email && !empId) || !password) {

            return {
                statusCode: 400,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "Employee ID/email and password are required"
                })
            };
        }

        const db = await getDbConnection();

        const [results] = await db.query(
            "CALL web_validateLogin(?, ?, ?)",
            [
                empId || null,
                email || null,
                password
            ]
        );

        const employees = results[0];

        if (!employees || employees.length === 0) {

            return {
                statusCode: 401,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "Invalid email or password"
                })
            };
        }

        const employee = employees[0];

        const token = jwt.sign(
            {
                empId: employee.id,
                email: employee.email,
                roleId: employee.roleId,
                roleName: employee.roleName
            },
            JWT_SECRET,
            {
                expiresIn: JWT_EXPIRES_IN
            }
        );

        const createdDate = new Date();
        const expiryTime = new Date(createdDate.getTime() + 24 * 60 * 60 * 1000);

        await db.query(
            "CALL web_upsertUserToken(?, ?, ?, ?)",
            [
                employee.id,
                token,
                expiryTime,
                createdDate
            ]
        );

        return {
            statusCode: 200,

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                success: true,

                message: "Login successful",

                data: {

                    empId: employee.id,

                    empName: employee.name,

                    empEmail: employee.email,

                    empRoleId: employee.roleId,

                    empRole: employee.roleName,

                    token: token,

                    tokenType: "Bearer",

                    expiresIn: 86400,

                    expiryTime: expiryTime
                }
            })
        };

    } catch (error) {

        console.error("Login API Error:", error);

        return {
            statusCode: 500,

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                success: false,
                message: "Internal server error"
            })
        };
    }
};

export const handler = async (event, context) => {

    console.log(
        "Lambda event:",
        JSON.stringify(event)
    );


    const path =
        event.rawPath ||
        event.path ||
        "";


    const method =
        event.requestContext?.http?.method ||
        event.httpMethod ||
        "POST";

    if (path === "/login" && method === "POST") {

        return await login(event);
    }

    return {

        statusCode: 404,

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            success: false,
            message: "API endpoint not found"
        })
    };
};

const app = express();

app.use(express.json());

app.post("/web/login", async (req, res) => {

    try {

        const event = {

            body: JSON.stringify(req.body),

            rawPath: "/login",

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

    } catch (error) {

        console.error(
            "Local API Error:",
            error
        );

        res.status(500).json({

            success: false,

            message: "Internal server error"

        });
    }
});

app.get("/", (req, res) => {

    res.json({

        success: true,

        message:
            "Employee Attendance API is running"

    });
});

const PORT =
    process.env.PORT || 3005;


app.listen(PORT, () => {

    console.log(
        `Local API running on http://localhost:${PORT}/web`
    );

});