import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";


// ============================================================
// LOCAL ONLY — SSH tunnel deps (comment out for Lambda)
// ============================================================
import fs from "fs";
import net from "net";
import { Client as SshClient } from "ssh2";

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


// ============================================================
// LOCAL ONLY — SSH tunnel to AWS DB (comment out for Lambda)
// Matches MySQL Workbench: Standard TCP/IP over SSH
// When deploying to Lambda: comment out this whole block,
// the ensureSshTunnel() call in getDbConnection, and the
// ssh2 / fs / net imports above.
// ============================================================
let sshClient;
let sshServer;
let sshTunnelReady;

const ensureSshTunnel = () => {
    if (sshTunnelReady) {
        return sshTunnelReady;
    }

    sshTunnelReady = new Promise((resolve, reject) => {
        const remoteDbHost = process.env.DB_SERVER;
        const remoteDbPort = Number(process.env.DB_PORT) || 3306;
        const sshHost = process.env.SSH_HOST;
        const sshPort = Number(process.env.SSH_PORT) || 22;
        const sshUser = process.env.SSH_USER;
        const sshKeyPath = process.env.SSH_KEY_PATH;

        if (!sshHost || !sshUser || !sshKeyPath) {
            const err = new Error(
                "SSH tunnel env missing. Set SSH_HOST, SSH_USER, SSH_KEY_PATH in .env"
            );
            sshTunnelReady = null;
            reject(err);
            return;
        }

        console.log(
            `Opening SSH tunnel via ${sshUser}@${sshHost}:${sshPort} -> ${remoteDbHost}:${remoteDbPort}`
        );

        sshClient = new SshClient();

        const fail = (err) => {
            console.error("SSH tunnel error:", err.message || err);
            sshTunnelReady = null;
            try {
                sshClient?.end();
            } catch {
                // ignore
            }
            reject(err);
        };

        sshClient
            .on("ready", () => {
                sshServer = net.createServer((socket) => {
                    sshClient.forwardOut(
                        socket.remoteAddress || "127.0.0.1",
                        socket.remotePort || 0,
                        remoteDbHost,
                        remoteDbPort,
                        (err, stream) => {
                            if (err) {
                                console.error(
                                    "SSH forwardOut error:",
                                    err.message || err
                                );
                                socket.destroy();
                                return;
                            }

                            socket.pipe(stream).pipe(socket);
                        }
                    );
                });

                sshServer.listen(0, "127.0.0.1", () => {
                    const localPort = sshServer.address().port;

                    // Point the MySQL pool at the local tunnel endpoint
                    dbConfig.host = "127.0.0.1";
                    dbConfig.port = localPort;

                    console.log(
                        `SSH tunnel ready: 127.0.0.1:${localPort} -> ${remoteDbHost}:${remoteDbPort}`
                    );
                    resolve();
                });

                sshServer.on("error", fail);
            })
            .on("error", fail)
            .on("end", () => {
                console.warn("SSH tunnel ended");
                sshTunnelReady = null;
                pool = null;
            })
            .connect({
                host: sshHost,
                port: sshPort,
                username: sshUser,
                privateKey: fs.readFileSync(sshKeyPath),
                readyTimeout: 40000,
                keepaliveInterval: 10000
            });
    });

    return sshTunnelReady;
};
// ============================================================

let pool;

const getDbConnection = async () => {

    if (!pool) {
        // LOCAL ONLY — comment out the next line for Lambda
        await ensureSshTunnel();

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