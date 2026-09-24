import express from "express";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import crypto from "crypto";

import {
    S3Client,
    PutObjectCommand
} from "@aws-sdk/client-s3";


dotenv.config();


// ============================================================
// CONFIGURATION
// ============================================================

const PORT =
    process.env.PORT || 3013;

const AWS_REGION =
    process.env.AWS_REGION ||
    "ap-south-1";

const S3_BUCKET_NAME =
    process.env.S3_BUCKET_NAME;


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
// S3 CLIENT
// ============================================================

const s3Client = new S3Client({
    region: AWS_REGION
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
// BUILD PUBLIC S3 URL
// ============================================================

const buildS3ObjectUrl = (s3Key) => {

    return `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`;
};


// ============================================================
// UPLOAD SELFIE
// ============================================================
//
// POST /mob/upload-selfie
//
// Headers:
//
// Authorization: Bearer <token>
//
// Request:
//
// {
//     "imageBase64": "data:image/jpeg;base64,/9j/4AAQ..."
// }
//
// empId is taken from the validated token.
//
// Response data:
//
// {
//     "empId": 12,
//     "date": "2026-09-21",
//     "s3Key": "selfies/12/2026-09-21/uuid.jpg",
//     "imgSrcPath": "https://bucket.s3.region.amazonaws.com/selfies/..."
// }
//
// Pass imgSrcPath to /mob/checkin as imgSrcPath.
//
// ============================================================

const uploadSelfie = async (event, authenticatedUser) => {

    try {

        console.log("Starting selfie upload...");


        // --------------------------------------------------------
        // Validate S3 config
        // --------------------------------------------------------

        if (!S3_BUCKET_NAME) {

            return {
                statusCode: 500,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "S3_BUCKET_NAME is not configured"
                })
            };
        }


        // --------------------------------------------------------
        // Parse request body
        // --------------------------------------------------------

        let body = event.body;

        if (typeof body === "string") {

            try {

                body = JSON.parse(body || "{}");

            }
            catch (error) {

                return {
                    statusCode: 400,

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({
                        success: false,
                        message: "Invalid JSON request body"
                    })
                };
            }
        }


        const imageBase64 =
            body?.imageBase64;


        if (!imageBase64) {

            return {
                statusCode: 400,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "imageBase64 is required"
                })
            };
        }


        // --------------------------------------------------------
        // Employee ID from validated token
        // --------------------------------------------------------

        const empId =
            Number(authenticatedUser.id);


        if (
            !Number.isInteger(empId) ||
            empId <= 0
        ) {

            return {
                statusCode: 401,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "Invalid employee information in token"
                })
            };
        }


        console.log("Employee ID:", empId);


        // --------------------------------------------------------
        // Current UTC date for S3 path
        // --------------------------------------------------------

        const now = new Date();

        const year =
            now.getUTCFullYear();

        const month =
            String(now.getUTCMonth() + 1)
                .padStart(2, "0");

        const day =
            String(now.getUTCDate())
                .padStart(2, "0");

        const date =
            `${year}-${month}-${day}`;


        // --------------------------------------------------------
        // Strip data-URI prefix if present
        // --------------------------------------------------------

        let base64Data = imageBase64;

        if (imageBase64.includes(",")) {

            base64Data =
                imageBase64.split(",")[1];
        }


        // --------------------------------------------------------
        // Convert Base64 to Buffer
        // --------------------------------------------------------

        let imageBuffer;

        try {

            imageBuffer =
                Buffer.from(
                    base64Data,
                    "base64"
                );

        }
        catch (error) {

            return {
                statusCode: 400,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "Invalid Base64 image"
                })
            };
        }


        if (
            !imageBuffer ||
            imageBuffer.length === 0
        ) {

            return {
                statusCode: 400,

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "Invalid or empty image"
                })
            };
        }


        console.log(
            "Image size:",
            imageBuffer.length,
            "bytes"
        );


        // --------------------------------------------------------
        // S3 object key
        // selfies/{empId}/{YYYY-MM-DD}/{uuid}.jpg
        // --------------------------------------------------------

        const uniqueId =
            crypto.randomUUID();

        const s3Key =
            `selfies/${empId}/${date}/${uniqueId}.jpg`;


        console.log("S3 Key:", s3Key);


        // --------------------------------------------------------
        // Upload to S3
        // --------------------------------------------------------

        const command =
            new PutObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: s3Key,
                Body: imageBuffer,
                ContentType: "image/jpeg"
            });

        await s3Client.send(command);


        console.log("Selfie uploaded successfully");


        // --------------------------------------------------------
        // Public URL for check-in imgSrcPath
        // --------------------------------------------------------

        const imgSrcPath =
            buildS3ObjectUrl(s3Key);


        return {

            statusCode: 200,

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                success: true,

                message:
                    "Selfie uploaded successfully",

                data: {
                    empId,
                    date,
                    s3Key,
                    imgSrcPath
                }

            })

        };

    }
    catch (error) {

        console.error(
            "Selfie Upload Error:",
            error
        );

        return {

            statusCode: 500,

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                success: false,
                message: "Failed to upload selfie"
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

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "Authorization token is required"
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

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: "Invalid authorization format"
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

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    success: false,
                    message: tokenResult.message
                })
            };
        }


        // ========================================================
        // VALIDATED USER
        // ========================================================

        const user =
            tokenResult.user;


        console.log(
            "Authenticated user:",
            user
        );


        // ========================================================
        // GET REQUEST PATH / METHOD
        // ========================================================

        const path =
            event.rawPath ||
            event.path ||
            "/mob/selfie-url";

        const method =
            event.requestContext?.http?.method ||
            event.httpMethod ||
            "POST";


        // ========================================================
        // UPLOAD SELFIE
        // ========================================================

        if (
            path === "/mob/selfie-url" &&
            method.toUpperCase() === "POST"
        ) {

            return await uploadSelfie(
                event,
                user
            );
        }


        // ========================================================
        // API NOT FOUND
        // ========================================================

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

    }
    catch (error) {

        console.error(
            "Lambda Handler Error:",
            error
        );

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


// ============================================================
// LOCAL DEVELOPMENT SERVER
// ============================================================

const app = express();

app.use(
    express.json({
        limit: "10mb"
    })
);


app.post(
    "/mob/selfie-url",
    async (req, res) => {

        try {

            const event = {

                body:
                    JSON.stringify(req.body),

                rawPath:
                    "/mob/selfie-url",

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
                "Local Upload Selfie Error:",
                error
            );

            res.status(500).json({
                success: false,
                message: "Internal server error"
            });

        }

    }
);


app.listen(
    PORT,
    () => {

        console.log(
            `Upload Selfie API running on http://localhost:${PORT}/mob/selfie-url`
        );

    }
);
