# Location Detect Mobile API — Design

**Date:** 2026-09-23  
**Scope:** Modify `locationDetectMob` to authenticate via token, validate employee GPS against assigned locations, and return a boolean plus matching location code.

## Goal

`POST /mob/location-detect` determines whether the authenticated employee’s current coordinates fall within any of their actively assigned location radii. If yes, return `result: true` with that location’s code; otherwise `result: false` with `locationCode: null`.

## Approach

Mirror the existing `checkInMob` / `generateSelfieUrlMob` auth pattern (Bearer token → `mob_validateToken` → `user.id` as `empId`). Keep Haversine distance checks in `locationDetectMob/index.mjs`. Use each SP row’s `radiusInMeters`. On multiple matches, return the **first** match in SP result order.

## API Contract

### Endpoint

- Method: `POST`
- Path: `/mob/location-detect`
- Header: `Authorization: Bearer <token>`

### Request body

```json
{
  "currentLatitude": 12.9716,
  "currentLongitude": 77.5946
}
```

`empId` is **not** accepted from the body. It comes from the validated token (`authenticatedUser.id`).

### Success — inside a permitted location (200)

```json
{
  "result": true,
  "message": "You are within the permitted location",
  "locationCode": "BLR-1"
}
```

### Failure — outside all assigned locations (200)

```json
{
  "result": false,
  "message": "You are outside the permitted location",
  "locationCode": null
}
```

### Failure — no active assignments (200)

```json
{
  "result": false,
  "message": "No active location assigned to this employee",
  "locationCode": null
}
```

## Data flow

1. Parse `Authorization` header; require `Bearer <token>`.
2. Call `mob_validateToken(?)`; on failure return 401 with `{ result: false, message, locationCode: null }`.
3. Set `empId = Number(authenticatedUser.id)`; reject if not a positive integer.
4. Parse body; validate `currentLatitude` / `currentLongitude` (required, numeric, in range).
5. Call `mob_getEmployeeAssignedLocations(empId)`.
6. For each row in SP order:
   - Read `locationLatitude`, `locationLongitude`, `radiusInMeters`, `locationCode`.
   - Skip row if any of those values are invalid numbers (or radius ≤ 0).
   - Compute Haversine distance in meters.
   - If `distance <= radiusInMeters`, return success with that row’s `locationCode`.
7. If no row matches, return outside-location failure.

## Stored procedure

```sql
CALL mob_getEmployeeAssignedLocations(p_empId);
```

Expected columns:

| Column | Meaning |
|--------|---------|
| `locationId` | Location id |
| `locationName` | Display name |
| `locationCode` | Code returned on success |
| `locationLatitude` | Assigned latitude |
| `locationLongitude` | Assigned longitude |
| `radiusInMeters` | Allowed radius for that location |

Procedure already filters active locations and current date window on `employeelocation`.

## Error responses

| Case | Status | Shape |
|------|--------|-------|
| Missing Authorization | 401 | `{ result: false, message, locationCode: null }` |
| Invalid Bearer format | 401 | same |
| Invalid/expired token | 401 | same |
| Invalid empId in token | 401 | same |
| Missing/invalid lat or lng | 400 | same |
| Unexpected server/DB error | 500 | `{ result: false, message: "Unable to verify employee location", locationCode: null }` |

## Implementation notes

- File to change: `locationDetectMob/index.mjs`
- Add `validateToken` (same pattern as `checkInMob`)
- Update Lambda path check and local Express route from `/location-detect` to `/mob/location-detect`
- Remove body `employeeId` handling and hardcoded radius constants
- Always include `locationCode` in JSON responses (`string` or `null`)

## Out of scope

- Extracting shared auth into a common module
- Returning closest match when multiple locations overlap
- Returning a list of all matching locations
- Mobile client changes

## Testing checklist

- Valid token + coords inside first assigned location → `result: true`, correct `locationCode`
- Valid token + coords inside a later location only → that location’s code
- Valid token + coords outside all → `result: false`, `locationCode: null`
- Valid token + no assignments → no-assignment message, `locationCode: null`
- Missing/invalid token → 401
- Invalid lat/lng → 400
