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
// CALCULATE DISTANCE BETWEEN TWO LOCATIONS
// ============================================================
//
// Uses Haversine formula.
//
// Returns distance in meters.
//
// ============================================================

const calculateDistanceInMeters = (
    latitude1,
    longitude1,
    latitude2,
    longitude2
) => {

    const earthRadius = 6371000; // meters

    const lat1 =
        Number(latitude1) * Math.PI / 180;

    const lat2 =
        Number(latitude2) * Math.PI / 180;

    const latitudeDifference =
        (Number(latitude2) - Number(latitude1))
        * Math.PI / 180;

    const longitudeDifference =
        (Number(longitude2) - Number(longitude1))
        * Math.PI / 180;


    const a =
        Math.sin(latitudeDifference / 2) *
        Math.sin(latitudeDifference / 2) +

        Math.cos(lat1) *
        Math.cos(lat2) *

        Math.sin(longitudeDifference / 2) *
        Math.sin(longitudeDifference / 2);


    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    return earthRadius * c;
};


const jsonResponse = (statusCode, payload) => ({

    statusCode,

    headers: getHeaders(),

    body: JSON.stringify({
        locationCode: null,
        ...payload
    })

});


// ============================================================
// LOCATION DETECT API
// ============================================================
//
// Request:
//
// POST /mob/location-detect
//
// Authorization: Bearer <token>
//
// Body:
//
// {
//     "currentLatitude": 12.9716000,
//     "currentLongitude": 77.5946000
// }
//
// empId is taken from the validated token (user.id).
//
// Response:
//
// {
//     "result": true,
//     "message": "You are within the permitted location",
//     "locationCode": "BLR-1"
// }
//
// OR
//
// {
//     "result": false,
//     "message": "You are outside the permitted location",
//     "locationCode": null
// }
//
// ============================================================

const locationDetect = async (event, authenticatedUser) => {

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

                return jsonResponse(400, {
                    result: false,
                    message: "Invalid JSON request body"
                });
            }

        }


        const {
            currentLatitude,
            currentLongitude
        } = body || {};


        // --------------------------------------------------------
        // Employee ID from validated token
        // --------------------------------------------------------

        const empId =
            Number(authenticatedUser.id);


        if (
            !Number.isInteger(empId) ||
            empId <= 0
        ) {

            return jsonResponse(401, {
                result: false,
                message: "Invalid employee information in token"
            });

        }


        // --------------------------------------------------------
        // Validate current latitude
        // --------------------------------------------------------

        if (
            currentLatitude === undefined ||
            currentLatitude === null ||
            currentLatitude === ""
        ) {

            return jsonResponse(400, {
                result: false,
                message: "currentLatitude is required"
            });

        }


        // --------------------------------------------------------
        // Validate current longitude
        // --------------------------------------------------------

        if (
            currentLongitude === undefined ||
            currentLongitude === null ||
            currentLongitude === ""
        ) {

            return jsonResponse(400, {
                result: false,
                message: "currentLongitude is required"
            });

        }


        // --------------------------------------------------------
        // Convert values to numbers
        // --------------------------------------------------------

        const latitude =
            Number(currentLatitude);

        const longitude =
            Number(currentLongitude);


        // --------------------------------------------------------
        // Validate numeric values
        // --------------------------------------------------------

        if (
            Number.isNaN(latitude) ||
            latitude < -90 ||
            latitude > 90
        ) {

            return jsonResponse(400, {
                result: false,
                message: "Invalid currentLatitude"
            });

        }


        if (
            Number.isNaN(longitude) ||
            longitude < -180 ||
            longitude > 180
        ) {

            return jsonResponse(400, {
                result: false,
                message: "Invalid currentLongitude"
            });

        }


        // --------------------------------------------------------
        // Get database connection
        // --------------------------------------------------------

        const db =
            await getDbConnection();


        // --------------------------------------------------------
        // Get assigned employee locations
        // --------------------------------------------------------

        const [results] = await db.query(

            "CALL mob_getEmployeeAssignedLocations(?)",

            [empId]

        );


        const employeeLocations =
            results?.[0] || [];


        // --------------------------------------------------------
        // No assigned location
        // --------------------------------------------------------

        if (
            employeeLocations.length === 0
        ) {

            return jsonResponse(200, {
                result: false,
                message:
                    "No active location assigned to this employee",
                locationCode: null
            });

        }


        // --------------------------------------------------------
        // Check all assigned locations (first match wins)
        // and track nearest location for the failure response
        // --------------------------------------------------------

        let nearestLocation = null;
        let nearestDistanceFromCenter = Infinity;

        const allAssignedLocations = [];

        for (
            const location
            of employeeLocations
        ) {

            const assignedLatitude =
                Number(
                    location.locationLatitude
                );

            const assignedLongitude =
                Number(
                    location.locationLongitude
                );

            const allowedRadius =
                Number(
                    location.radiusInMeters
                );


            if (
                Number.isNaN(assignedLatitude) ||
                Number.isNaN(assignedLongitude) ||
                Number.isNaN(allowedRadius) ||
                allowedRadius <= 0
            ) {

                console.warn(
                    "Skipping invalid assigned location row:",
                    location
                );

                continue;

            }


            // ----------------------------------------------------
            // Collect all valid assigned locations for
            // the failure response
            // ----------------------------------------------------

            allAssignedLocations.push({
                locationId:
                    location.locationId ?? null,
                locationName:
                    location.locationName ?? null,
                locationCode:
                    location.locationCode ?? null,
                latitude:
                    assignedLatitude,
                longitude:
                    assignedLongitude,
                radiusInMeters:
                    allowedRadius
            });


            // ----------------------------------------------------
            // Calculate distance
            // ----------------------------------------------------

            const distance =
                calculateDistanceInMeters(

                    latitude,

                    longitude,

                    assignedLatitude,

                    assignedLongitude

                );


            console.log(
                `Employee ${empId} is ${distance.toFixed(2)} meters from ${location.locationName} (radius ${allowedRadius}m)`
            );


            // ----------------------------------------------------
            // Track nearest location (by distance from center)
            // ----------------------------------------------------

            if (distance < nearestDistanceFromCenter) {

                nearestDistanceFromCenter = distance;

                nearestLocation = {
                    locationId:
                        location.locationId ?? null,
                    locationName:
                        location.locationName ?? null,
                    locationCode:
                        location.locationCode ?? null,
                    latitude:
                        assignedLatitude,
                    longitude:
                        assignedLongitude,
                    radiusInMeters:
                        allowedRadius,
                    distanceFromBoundaryInMeters:
                        Math.round(
                            Math.max(0, distance - allowedRadius)
                        )
                };

            }


            // ----------------------------------------------------
            // Employee is within this location radius
            // ----------------------------------------------------

            if (
                distance <= allowedRadius
            ) {

                return jsonResponse(200, {
                    result: true,
                    message:
                        "You are within the permitted location",
                    locationCode:
                        location.locationCode ?? null
                });

            }

        }


        // --------------------------------------------------------
        // Employee is outside all assigned locations
        // --------------------------------------------------------

        return jsonResponse(200, {
            result: false,
            message:
                "You are outside the permitted location",
            locationCode: null,
            assignedLocations:
                allAssignedLocations,
            nearestLocation:
                nearestLocation
        });

    }
    catch (error) {

        console.error(
            "Location Detect API Error:",
            error
        );


        return jsonResponse(500, {
            result: false,
            message:
                "Unable to verify employee location"
        });

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

            return jsonResponse(401, {
                result: false,
                message:
                    "Authorization token is required"
            });
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

            return jsonResponse(401, {
                result: false,
                message:
                    "Invalid authorization format"
            });

        }


        const token =
            parts[1];


        // ========================================================
        // VALIDATE TOKEN
        // ========================================================

        const tokenResult =
            await validateToken(token);


        if (!tokenResult.valid) {

            return jsonResponse(
                tokenResult.statusCode,
                {
                    result: false,
                    message:
                        tokenResult.message
                }
            );

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
        // GET REQUEST PATH
        // ========================================================

        const path =
            event.rawPath ||
            event.path ||
            "/mob/location-detect";


        const method =
            event.requestContext?.http?.method ||
            event.httpMethod ||
            "POST";

        // ========================================================
        // LOCATION DETECT
        // ========================================================

        if (
            path === "/mob/location-detect" &&
            method.toUpperCase() === "POST"
        ) {

            return await locationDetect(
                event,
                user
            );

        }


        // ========================================================
        // API NOT FOUND
        // ========================================================

        return jsonResponse(404, {
            result: false,
            message:
                "API endpoint not found"
        });

    }
    catch (error) {

        console.error(
            "Lambda Handler Error:",
            error
        );

        return jsonResponse(500, {
            result: false,
            message:
                "Internal server error"
        });

    }

};


// ============================================================
// LOCAL DEVELOPMENT SERVER
// ============================================================
//
// Used only when running locally.
//
// AWS Lambda will use the handler above.
//
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
// LOCAL LOCATION DETECT API
// ============================================================

app.post(
    "/mob/location-detect",
    async (req, res) => {

        try {

            const event = {

                body:
                    JSON.stringify(req.body),

                rawPath:
                    "/mob/location-detect",

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
                "Local API Error:",
                error
            );


            res.status(500).json({

                result: false,

                message:
                    "Internal server error",

                locationCode: null

            });

        }

    }
);


// ============================================================
// LOCAL SERVER
// ============================================================

const PORT =
    process.env.PORT || 3002;


app.listen(
    PORT,
    () => {

        console.log(
            `Location Detect API running on http://localhost:${PORT}/mob/location-detect`
        );

    }
);
