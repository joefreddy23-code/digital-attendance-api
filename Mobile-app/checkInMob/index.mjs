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

        // Make sure pool exists before using it
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
// CHECK-IN API
// ============================================================
//
// POST /mob/checkin
//
// Request:
//
// {
//     "checkinDate": "2026-09-18",
//     "checkinDatetime": "2026-09-18 09:30:00",
//     "checkinLocCode": "LOC001",
//     "checkinLatitude": 12.9716000,
//     "checkinLongitude": 77.5946000,
//     "imgSrcPath": "https://bucket.s3.region.amazonaws.com/selfies/..."
// }
//
// empId is taken from the validated token.
//
// Flow:
// 1. POST /mob/upload-selfie with imageBase64
// 2. Use response data.imgSrcPath as imgSrcPath here
//    (data.s3Key is also returned for reference)
//
// ============================================================

const checkIn = async (event, authenticatedUser) => {

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
            checkinDate,
            checkinDatetime,
            checkinLocCode,
            checkinLatitude,
            checkinLongitude,
            imgSrcPath
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
        // Validate check-in date
        // --------------------------------------------------------

        if (!checkinDate) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "checkinDate is required"
                })
            };
        }


        // --------------------------------------------------------
        // Validate check-in datetime
        // --------------------------------------------------------

        if (!checkinDatetime) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "checkinDatetime is required"
                })
            };
        }


        // --------------------------------------------------------
        // Validate latitude
        // --------------------------------------------------------

        if (
            checkinLatitude === undefined ||
            checkinLatitude === null ||
            checkinLatitude === ""
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "checkinLatitude is required"
                })
            };
        }


        // --------------------------------------------------------
        // Validate longitude
        // --------------------------------------------------------

        if (
            checkinLongitude === undefined ||
            checkinLongitude === null ||
            checkinLongitude === ""
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "checkinLongitude is required"
                })
            };
        }


        // --------------------------------------------------------
        // Convert latitude / longitude
        // --------------------------------------------------------

        const latitude =
            Number(checkinLatitude);

        const longitude =
            Number(checkinLongitude);


        // --------------------------------------------------------
        // Validate latitude
        // --------------------------------------------------------

        if (
            Number.isNaN(latitude) ||
            latitude < -90 ||
            latitude > 90
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "Invalid checkinLatitude"
                })
            };
        }


        // --------------------------------------------------------
        // Validate longitude
        // --------------------------------------------------------

        if (
            Number.isNaN(longitude) ||
            longitude < -180 ||
            longitude > 180
        ) {

            return {
                statusCode: 400,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "Invalid checkinLongitude"
                })
            };
        }


        // --------------------------------------------------------
        // Get database
        // --------------------------------------------------------

        const db =
            await getDbConnection();


        // --------------------------------------------------------
        // Execute Check-in SP
        // --------------------------------------------------------

        const [results] = await db.query(

            "CALL mob_checkIn(?, ?, ?, ?, ?, ?, ?)",

            [
                employeeId,
                checkinDate,
                checkinDatetime,
                checkinLocCode,
                latitude,
                longitude,
                imgSrcPath || null
            ]

        );


        // --------------------------------------------------------
        // Get SP result
        // --------------------------------------------------------

        const result =
            results?.[0]?.[0];


        console.log(
            "Check-in SP result:",
            result
        );


        // --------------------------------------------------------
        // Check SP result
        // --------------------------------------------------------

        if (
            !result ||
            Number(result.success) !== 1
        ) {

            return {
                statusCode: 500,

                headers: getHeaders(),

                body: JSON.stringify({
                    success: false,
                    message: "Unable to complete check-in"
                })
            };
        }


        // --------------------------------------------------------
        // Successful check-in
        // --------------------------------------------------------

        return {

            statusCode: 200,

            headers: getHeaders(),

            body: JSON.stringify({

                success: true,

                message:
                    result.message ||
                    "Check-in successful",

                data: {

                    attendanceId:
                        result.attendanceId,

                    empId:
                        employeeId,

                    approverId:
                        result.approverId,

                    isPresent: 1,

                    checkinDate:
                        checkinDate,

                    checkinDatetime:
                        checkinDatetime,

                    checkinLocCode:
                        checkinLocCode,

                    checkinLatitude:
                        latitude,

                    checkinLongitude:
                        longitude,

                    imgSrcPath:
                        imgSrcPath || null

                }

            })

        };

    }
    catch (error) {

        console.error(
            "Check-in API Error:",
            error
        );

        return {

            statusCode: 500,

            headers: getHeaders(),

            body: JSON.stringify({

                success: false,

                message:
                    "Unable to process check-in"

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


        const roleId =
            Number(user.roleId);


        console.log(
            "Authenticated user:",
            user
        );

        console.log(
            "RoleId:",
            roleId
        );


        // ========================================================
        // GET REQUEST PATH
        // ========================================================

        const path =
            event.rawPath ||
            event.path ||
            "/checkin";


        const method =
            event.requestContext?.http?.method ||
            event.httpMethod ||
            "POST";

        // ========================================================
        // CHECK-IN
        // ========================================================

        if (
            path === "/mob/checkin" &&
            method.toUpperCase() === "POST"
        ) {

            return await checkIn(
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
// LOCAL CHECK-IN API
// ============================================================

app.post(
    "/mob/checkin",
    async (req, res) => {

        try {

            const event = {

                body:
                    JSON.stringify(req.body),

                rawPath:
                    "/mob/checkin",

                headers:
                    req.headers,

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
                .set(response.headers || {})
                .send(response.body);

        }
        catch (error) {

            console.error(
                "Local Check-in Error:",
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
    process.env.PORT || 3003;


app.listen(
    PORT,
    () => {

        console.log(
            `Check-in API running on http://localhost:${PORT}/mob/checkin`
        );

    }
);