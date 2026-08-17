import { describe, expect, it } from "vitest";
import { EVIDENCE_MAX_PER_STAGE, processEvidenceImage } from "../src/evidence/image-pipeline";

function tinyJpeg(): Buffer {
  // A minimal valid 1x1 JPEG.
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );
}

function tinyPng(): Buffer {
  // A minimal valid 1x1 transparent PNG.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
}

describe("evidence image pipeline (§23)", () => {
  it("accepts a genuine JPEG and returns a compressed JPEG", async () => {
    const result = await processEvidenceImage({
      buffer: tinyJpeg(),
      originalName: "photo.jpg",
    });
    expect(result.contentType).toBe("image/jpeg");
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("accepts a genuine PNG and normalizes it to JPEG", async () => {
    const result = await processEvidenceImage({
      buffer: tinyPng(),
      originalName: "photo.png",
    });
    expect(result.contentType).toBe("image/jpeg");
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });

  it("rejects a non-image (HTML disguised as jpg)", async () => {
    const html = Buffer.from("<html><body>not an image</body></html>");
    await expect(
      processEvidenceImage({ buffer: html, originalName: "photo.jpg" }),
    ).rejects.toThrow(/genuine JPEG or PNG/);
  });

  it("rejects a plain text file", async () => {
    const text = Buffer.from("plain text payload");
    await expect(
      processEvidenceImage({ buffer: text, originalName: "notes.txt" }),
    ).rejects.toThrow(/genuine JPEG or PNG/);
  });

  it("rejects a truncated image that cannot be decoded", async () => {
    const truncated = tinyJpeg().subarray(0, 20);
    await expect(
      processEvidenceImage({ buffer: truncated, originalName: "broken.jpg" }),
    ).rejects.toThrow();
  });

  it("caps photos per stage", () => {
    expect(EVIDENCE_MAX_PER_STAGE).toBe(4);
  });
});