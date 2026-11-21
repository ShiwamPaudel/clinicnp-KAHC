import { afterEach, describe, expect, test } from "vitest";
import { originOf, publicAppOrigin } from "@/lib/lab-report-view";

const ORIGINAL = process.env.PUBLIC_APP_URL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = ORIGINAL;
});

const vercelHeaders = () =>
  new Headers({ host: "clinicnp-kahc.vercel.app", "x-forwarded-host": "clinicnp-kahc.vercel.app", "x-forwarded-proto": "https" });

describe("the address a lab-report QR points at", () => {
  test("PUBLIC_APP_URL wins over the address the page was opened on", () => {
    process.env.PUBLIC_APP_URL = "https://clinicnp-kahc.infobytesnepal.com/";
    expect(originOf(vercelHeaders())).toBe("https://clinicnp-kahc.infobytesnepal.com");
    expect(publicAppOrigin()).toBe("https://clinicnp-kahc.infobytesnepal.com");
  });

  test("without it, the request's own address", () => {
    delete process.env.PUBLIC_APP_URL;
    expect(originOf(vercelHeaders())).toBe("https://clinicnp-kahc.vercel.app");
    expect(publicAppOrigin()).toBeNull();
  });

  test("a value that is not an http(s) address is ignored", () => {
    process.env.PUBLIC_APP_URL = "clinicnp-kahc.infobytesnepal.com";
    expect(publicAppOrigin()).toBeNull();
    process.env.PUBLIC_APP_URL = "ftp://example.com";
    expect(publicAppOrigin()).toBeNull();
  });
});
