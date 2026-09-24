import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    normalizeEmpId,
    decodeBase64Image,
    extractS3KeyFromProfileImgPath,
    buildS3ObjectUrl,
    buildProfileImageS3Key
} from "./helpers.mjs";

describe("normalizeEmpId", () => {
    it("returns null for missing, 0, negative, or non-integer", () => {
        assert.equal(normalizeEmpId(undefined), null);
        assert.equal(normalizeEmpId(null), null);
        assert.equal(normalizeEmpId(0), null);
        assert.equal(normalizeEmpId(-1), null);
        assert.equal(normalizeEmpId("abc"), null);
    });

    it("returns positive integer", () => {
        assert.equal(normalizeEmpId(12), 12);
        assert.equal(normalizeEmpId("12"), 12);
    });
});

describe("decodeBase64Image", () => {
    it("rejects empty", () => {
        const result = decodeBase64Image("");
        assert.equal(result.ok, false);
    });

    it("decodes data-URI and raw base64", () => {
        const raw = Buffer.from("hello").toString("base64");
        const a = decodeBase64Image(raw);
        const b = decodeBase64Image(`data:image/png;base64,${raw}`);
        assert.equal(a.ok, true);
        assert.equal(b.ok, true);
        assert.deepEqual(a.buffer, Buffer.from("hello"));
        assert.deepEqual(b.buffer, Buffer.from("hello"));
    });
});

describe("extractS3KeyFromProfileImgPath", () => {
    const bucket = "my-bucket";
    const region = "ap-south-1";

    it("returns null for empty", () => {
        assert.equal(
            extractS3KeyFromProfileImgPath("", bucket, region),
            null
        );
    });

    it("parses full URL", () => {
        const url =
            `https://${bucket}.s3.${region}.amazonaws.com/profileImages/a@b.com/1.png`;
        assert.equal(
            extractS3KeyFromProfileImgPath(url, bucket, region),
            "profileImages/a@b.com/1.png"
        );
    });

    it("passes through bare key", () => {
        assert.equal(
            extractS3KeyFromProfileImgPath(
                "profileImages/a@b.com/1.png",
                bucket,
                region
            ),
            "profileImages/a@b.com/1.png"
        );
    });
});

describe("build helpers", () => {
    it("builds key and URL", () => {
        assert.equal(
            buildProfileImageS3Key("a@b.com", 1727160000000),
            "profileImages/a@b.com/1727160000000.png"
        );
        assert.equal(
            buildS3ObjectUrl(
                "profileImages/a@b.com/1.png",
                "my-bucket",
                "ap-south-1"
            ),
            "https://my-bucket.s3.ap-south-1.amazonaws.com/profileImages/a@b.com/1.png"
        );
    });
});
