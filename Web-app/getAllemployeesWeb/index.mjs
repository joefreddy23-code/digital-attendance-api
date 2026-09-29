import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

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

        const [rows] = await (await getDbConnection()).query(
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


        // ============================================================
        // GET QUERY PARAMETERS
        // ============================================================

        const queryParams =
            event.queryStringParameters || {};

        const searchText =
            queryParams.searchText?.trim() || null;

        const locationCode =
            queryParams.locationCode?.trim() || null;

        const date =
            queryParams.date?.trim();

        const role =
            queryParams.role?.trim();


        // ============================================================
        // VALIDATE MANDATORY PARAMETERS
        // ============================================================

        if (!date) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "date is required"
                })
            };
        }

        if (!role) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "role is required"
                })
            };
        }


        // ============================================================
        // VALIDATE DATE FORMAT
        // Expected: YYYY-MM-DD
        // ============================================================

        const dateRegex =
            /^\d{4}-\d{2}-\d{2}$/;

        if (!dateRegex.test(date)) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "Invalid date format. Expected YYYY-MM-DD"
                })
            };
        }


        // ============================================================
        // VALIDATE ROLE
        // ============================================================

        const roleId = Number(role);

        if (!Number.isInteger(roleId)) {

            return {
                statusCode: 400,
                headers: getHeaders(),
                body: JSON.stringify({
                    success: false,
                    message: "role must be a valid integer"
                })
            };
        }


        // ============================================================
        // GET EMPLOYEES
        // ============================================================

        console.log("Get All Employees Parameters:", {
            searchText,
            locationCode,
            date,
            role: roleId
        });


        const [employeeRows] = await (await getDbConnection()).query(
            "CALL web_getAllEmployees(?, ?, ?, ?)",
            [
                searchText,
                locationCode,
                date,
                roleId
            ]
        );


        const employees =
            employeeRows[0] || [];


        // ============================================================
        // FORMAT RESPONSE
        // ============================================================

        const employeeData = employees.map(row => ({

            id: row.id,

            name: row.name,

            mobileNumber: row.mobileNumber,

            email: row.email,

            roleId: row.roleId,

            roleName: row.roleName,

            status: row.status,

            allocatedLocations:
                row.allocatedLocations
                    ? row.allocatedLocations
                        .split(", ")
                    : [],
            
        }));


        // ============================================================
        // FINAL RESPONSE
        // ============================================================

        return {
            statusCode: 200,
            headers: getHeaders(),
            body: JSON.stringify({
                success: true,
                data: employeeData
            })
        };

    } catch (error) {

        console.error(
            "Get All Employees API Error:",
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


// ============================================================
// LOCAL DEVELOPMENT SERVER
// ============================================================

const PORT = 3008;

app.get("/web/employees", async (req, res) => {

    try {

        const result = await handler({

            httpMethod: "GET",

            headers: req.headers,

            queryStringParameters:
                req.query

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
                message: "Internal server error",
                error: error.message
            });
    }
});


app.listen(PORT, () => {

    console.log(
        `Get All Employees API running on port ${PORT}`
    );

});
