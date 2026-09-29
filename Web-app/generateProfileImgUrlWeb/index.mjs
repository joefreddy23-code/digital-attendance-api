import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

// ============================================================
// LOCAL ONLY — SSH tunnel deps (comment out for Lambda)
// ============================================================
import fs from "fs";
import net from "net";
import { Client as SshClient } from "ssh2";

import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand
} from "@aws-sdk/client-s3";

dotenv.config({ quiet: true });


const getHeaders = () => ({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Requested-With,Accept,Origin",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT",
    "Access-Control-Max-Age": "86400"
});

const PORT = process.env.PORT || 3021;

const AWS_REGION =
    process.env.AWS_REGION || "ap-south-1";

const S3_BUCKET_NAME =
    process.env.S3_BUCKET_NAME;

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

const s3Client = new S3Client({
    region: AWS_REGION
});

const normalizeEmpId = (empId) => {
    if (empId === undefined || empId === null || empId === "") {
        return null;
    }

    const value = Number(empId);

    if (!Number.isInteger(value) || value <= 0) {
        return null;
    }

    return value;
};

const decodeBase64Image = (imageBase64) => {
    if (!imageBase64 || typeof imageBase64 !== "string") {
        return {
            ok: false,
            message: "imageBase64 is required"
        };
    }

    let base64Data = imageBase64;

    if (imageBase64.includes(",")) {
        base64Data = imageBase64.split(",")[1];
    }

    if (!base64Data) {
        return {
            ok: false,
            message: "Invalid Base64 image"
        };
    }

    let imageBuffer;

    try {
        imageBuffer = Buffer.from(base64Data, "base64");
    } catch {
        return {
            ok: false,
            message: "Invalid Base64 image"
        };
    }

    if (!imageBuffer || imageBuffer.length === 0) {
        return {
            ok: false,
            message: "Invalid or empty image"
        };
    }

    return {
        ok: true,
        buffer: imageBuffer
    };
};

const extractS3KeyFromProfileImgPath = (
    profileImgPath,
    bucketName,
    region
) => {
    if (!profileImgPath || typeof profileImgPath !== "string") {
        return null;
    }

    const trimmed = profileImgPath.trim();

    if (!trimmed) {
        return null;
    }

    const prefix =
        `https://${bucketName}.s3.${region}.amazonaws.com/`;

    if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length);
    }

    if (trimmed.startsWith("profileImages/")) {
        return trimmed;
    }

    try {
        if (
            trimmed.startsWith("http://") ||
            trimmed.startsWith("https://")
        ) {
            const url = new URL(trimmed);
            const key = url.pathname.replace(/^\//, "");
            return key || null;
        }
    } catch {
        return null;
    }

    return trimmed;
};

const buildS3ObjectUrl = (s3Key) => {
    return `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`;
};

const buildProfileImageS3Key = (empId, timestampMs) => {
    return `profileImages/${empId}/${timestampMs}.png`;
};

const validateToken = async (token) => {
    if (!token) {
        return {
            valid: false,
            statusCode: 401,
            message: "Authorization token is required"
        };
    }

    try {
        const db = await getDbConnection();

        const [rows] = await db.query(
            "CALL web_validateToken(?)",
            [token]
        );

        const user = rows?.[0]?.[0];

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

const jsonResponse = (statusCode, payload) => ({
    statusCode,
    headers: getHeaders(),
    body: JSON.stringify(payload)
});

const uploadProfileImage = async (event) => {
    try {
        if (!S3_BUCKET_NAME) {
            return jsonResponse(500, {
                success: false,
                message: "S3_BUCKET_NAME is not configured"
            });
        }

        let body = event.body;

        if (typeof body === "string") {
            try {
                body = JSON.parse(body || "{}");
            } catch {
                return jsonResponse(400, {
                    success: false,
                    message: "Invalid JSON request body"
                });
            }
        }

        const imageBase64 = body?.imageBase64;
        const empId = normalizeEmpId(body?.empId);

        if (!empId) {
            return jsonResponse(400, {
                success: false,
                message: "empId is required and must be a valid positive integer"
            });
        }

        if (!imageBase64) {
            return jsonResponse(400, {
                success: false,
                message: "imageBase64 is required"
            });
        }

        const decoded = decodeBase64Image(imageBase64);

        if (!decoded.ok) {
            return jsonResponse(400, {
                success: false,
                message: decoded.message
            });
        }

        const db = await getDbConnection();

        const [rows] = await db.query(
            "CALL web_getEmployeeProfileImgPath(?)",
            [empId]
        );

        const existingPath =
            rows?.[0]?.[0]?.profileImgPath;

        if (existingPath) {
            const oldKey = extractS3KeyFromProfileImgPath(
                existingPath,
                S3_BUCKET_NAME,
                AWS_REGION
            );

            if (oldKey) {
                try {
                    await s3Client.send(
                        new DeleteObjectCommand({
                            Bucket: S3_BUCKET_NAME,
                            Key: oldKey
                        })
                    );
                    console.log("Deleted old profile image:", oldKey);
                } catch (deleteError) {
                    console.error(
                        "Failed to delete old profile image (continuing):",
                        deleteError
                    );
                }
            }
        }

        const timestampMs = Date.now();
        const s3Key = buildProfileImageS3Key(empId, timestampMs);

        await s3Client.send(
            new PutObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: s3Key,
                Body: decoded.buffer,
                ContentType: "image/png"
            })
        );

        const profileImgPath = buildS3ObjectUrl(s3Key);

        return jsonResponse(200, {
            success: true,
            message: "Profile image uploaded successfully",
            data: {
                empId,
                s3Key,
                profileImgPath
            }
        });
    } catch (error) {
        console.error("Profile Image Upload Error:", error);

        return jsonResponse(500, {
            success: false,
            message: "Failed to upload profile image"
        });
    }
};

export const handler = async (event) => {

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
        console.log("Lambda Event:", JSON.stringify(event));

        const headers = event.headers || {};

        const authorization =
            headers.Authorization ||
            headers.authorization;

        if (!authorization) {
            return jsonResponse(401, {
                success: false,
                message: "Authorization token is required"
            });
        }

        const parts = authorization.trim().split(/\s+/);

        if (
            parts.length !== 2 ||
            parts[0].toLowerCase() !== "bearer" ||
            !parts[1]
        ) {
            return jsonResponse(401, {
                success: false,
                message: "Invalid authorization format"
            });
        }

        const tokenResult = await validateToken(parts[1]);

        if (!tokenResult.valid) {
            return jsonResponse(tokenResult.statusCode, {
                success: false,
                message: tokenResult.message
            });
        }

        const path =
            event.rawPath ||
            event.path ||
            "/web/profile-img-url";

        const method =
            event.requestContext?.http?.method ||
            event.httpMethod ||
            "POST";

        if (
            path === "/web/profile-img-url" &&
            method.toUpperCase() === "POST"
        ) {
            return await uploadProfileImage(event);
        }

        return jsonResponse(404, {
            success: false,
            message: "API endpoint not found"
        });
    } catch (error) {
        console.error("Lambda Handler Error:", error);

        return jsonResponse(500, {
            success: false,
            message: "Internal server error"
        });
    }
};

const app = express();


app.use((req, res, next) => {
    res.set(getHeaders());

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    next();
});

app.use(
    express.json({
        limit: "10mb"
    })
);

app.post("/web/profile-img-url", async (req, res) => {
    try {
        const event = {
            body: JSON.stringify(req.body),
            rawPath: "/web/profile-img-url",
            headers: req.headers,
            requestContext: {
                http: {
                    method: "POST"
                }
            }
        };

        const response = await handler(event, {});

        res
            .status(response.statusCode)
            .set(response.headers || {})
            .send(response.body);
    } catch (error) {
        console.error("Local Profile Image Upload Error:", error);

        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

app.listen(PORT, (error) => {
    if (error) {
        console.error(
            `Failed to start Profile Image URL API on port ${PORT}:`,
            error.message
        );
        process.exit(1);
        return;
    }

    console.log(
        `Profile Image URL API running on http://localhost:${PORT}/web/profile-img-url`
    );
});
