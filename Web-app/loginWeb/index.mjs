import express from "express"; // LOCAL ONLY — uncomment to run on local
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

const dbConfig = {
    host: process.env.DB_SERVER,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const getHeaders = () => ({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Requested-With,Accept,Origin",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT",
    "Access-Control-Max-Age": "86400"
});

const JWT_SECRET = process.env.JWT_SECRET;

const JWT_EXPIRES_IN = process.env.EXP_TIME;

let pool;

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

const getDbConnection = async () => {
    if (!pool) {
        // LOCAL ONLY — comment out the next line for Lambda
        await ensureSshTunnel();

        pool = mysql.createPool(dbConfig);
        console.log("MySQL connection pool created");
    }

    return pool;
};

const login = async (event) => {
    const headers = getHeaders();

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
                headers,
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
                headers,
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
            headers,
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
            headers,
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

    const headers = getHeaders();

    const path =
        event.rawPath ||
        event.path ||
        "";

    const method =
        event.requestContext?.http?.method ||
        event.httpMethod ||
        "POST";

    if (method === "OPTIONS") {
        return {
            statusCode: 200,
            headers,
            body: ""
        };
    }

    if (path === "/login" && method === "POST") {
        return await login(event);
    }

    return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
            success: false,
            message: "API endpoint not found"
        })
    };
};

// ============================================================
// LOCAL EXPRESS API — uncomment below to run on local
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

        const response = await handler(event, {});

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
        message: "Employee Attendance API is running"
    });
});

const PORT =
    process.env.PORT || 3005;

app.listen(PORT, () => {
    console.log(
        `Local API running on http://localhost:${PORT}/web`
    );
});
