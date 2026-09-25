import express from "express";
import mysql from "mysql2/promise";
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
        // --------------------------------------------------------

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
            locationCode: null
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
