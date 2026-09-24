export const normalizeEmpId = (empId) => {
    if (empId === undefined || empId === null || empId === "") {
        return null;
    }

    const value = Number(empId);

    if (!Number.isInteger(value) || value <= 0) {
        return null;
    }

    return value;
};

export const decodeBase64Image = (imageBase64) => {
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

export const extractS3KeyFromProfileImgPath = (
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

    // Fallback: if value looks like a URL with a path, take pathname without leading /
    try {
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            const url = new URL(trimmed);
            const key = url.pathname.replace(/^\//, "");
            return key || null;
        }
    } catch {
        return null;
    }

    return trimmed;
};

export const buildS3ObjectUrl = (s3Key, bucketName, region) => {
    return `https://${bucketName}.s3.${region}.amazonaws.com/${s3Key}`;
};

export const buildProfileImageS3Key = (email, timestampMs) => {
    return `profileImages/${email}/${timestampMs}.png`;
};
