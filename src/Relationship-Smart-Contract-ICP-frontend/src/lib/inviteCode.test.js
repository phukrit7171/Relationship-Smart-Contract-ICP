import { describe, expect, it } from "vitest";
import {
  displayCode,
  inviteUrl,
  isLocalInviteOrigin,
  normalizeCode,
} from "./inviteCode";

// Mirrors invite.rs on the backend; both must agree or a typed code that the
// UI accepts would be rejected on-chain.
describe("normalizeCode", () => {
  it("accepts the displayed form", () => {
    expect(normalizeCode("ABCDE-FGHJK")).toBe("ABCDEFGHJK");
  });

  it("ignores case, dashes, spaces and underscores", () => {
    for (const input of [
      "abcdefghjk",
      "abcde-fghjk",
      "ABCDE FGHJK",
      "ABCDE_FGHJK",
      " abcde-FGHJK ",
      "ABCDE-FGHJK/",
      "ABCDE-FGHJK?igsh=MWZ4",
      "ABCDE-FGHJK#fragment",
      "ABCDE-FGHJK.",
    ]) {
      expect(normalizeCode(input)).toBe("ABCDEFGHJK");
    }
  });

  it("rewrites the look-alike characters", () => {
    // Nobody transcribing a code off a screen distinguishes these reliably.
    expect(normalizeCode("I23456789Z")).toBe("123456789Z");
    expect(normalizeCode("l23456789Z")).toBe("123456789Z");
    expect(normalizeCode("O23456789Z")).toBe("023456789Z");
  });

  it("extracts a code from a full invite link", () => {
    for (const input of [
      "https://example.com/#/invite/ABCDE-FGHJK",
      "https://example.com/invite/abcde-fghjk?utm_source=chat",
      "https://example.com/#/invite/ABCDE%2DFGHJK",
    ]) {
      expect(normalizeCode(input)).toBe("ABCDEFGHJK");
    }
  });

  it("survives common messaging-app copy and paste artefacts", () => {
    for (const input of [
      "\"ABCDE-FGHJK\"",
      "(ABCDE-FGHJK).",
      "ABCDE–FGHJK",
      "ABCDE\u00a0FGHJK",
      "AB\u200bCDE-FGHJK",
      "ＡＢＣＤＥ－ＦＧＨＪＫ",
    ]) {
      expect(normalizeCode(input)).toBe("ABCDEFGHJK");
    }
  });

  it("rejects U, which is excluded so it cannot be read as V", () => {
    expect(normalizeCode("U234567890")).toBeNull();
  });

  it("rejects the wrong length", () => {
    expect(normalizeCode("ABCDE")).toBeNull();
    expect(normalizeCode("ABCDEFGHJKL")).toBeNull();
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });

  it("rejects characters outside the alphabet", () => {
    expect(normalizeCode("ABCDEFGHJ!")).toBeNull();
  });
});

describe("displayCode", () => {
  it("groups a normalised code into two halves", () => {
    expect(displayCode("0123456789")).toBe("01234-56789");
  });

  it("round-trips through normalizeCode", () => {
    expect(normalizeCode(displayCode("abcdefghjk"))).toBe("ABCDEFGHJK");
  });
});

describe("inviteUrl", () => {
  it("puts the code in the fragment, never the path", () => {
    // Fragments are not sent to servers, so the code stays out of boundary
    // node and proxy access logs.
    const url = inviteUrl("abcde-fghjk", "https://example.com");
    expect(url).toBe("https://example.com/#/invite/ABCDEFGHJK");
    expect(new URL(url).pathname).toBe("/");
  });
});

describe("isLocalInviteOrigin", () => {
  it("recognises localhost and private-network development origins", () => {
    for (const origin of [
      "http://localhost:3000",
      "http://aaaaa-aa.localhost:8000",
      "http://127.0.0.1:8000",
      "http://192.168.1.8:3000",
      "http://10.0.0.5:3000",
      "http://172.20.0.2:3000",
    ]) {
      expect(isLocalInviteOrigin(origin)).toBe(true);
    }
  });

  it("does not flag a production origin", () => {
    expect(isLocalInviteOrigin("https://aaaaa-aa.icp.net")).toBe(false);
  });
});
