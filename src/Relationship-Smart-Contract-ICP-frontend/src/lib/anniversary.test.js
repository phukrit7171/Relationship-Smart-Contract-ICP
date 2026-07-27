import { describe, expect, it } from "vitest";
import { anniversaryInfo, clampToMonth, clockSkewSeconds } from "./anniversary";

// Both helpers take a 1-based month. `new Date` is 0-based, and mixing the
// two silently shifts a test by a month, so neither appears raw below.
// Defaults to midnight so it can double as the expected value for the
// start-of-day dates the module returns.
function at(y, month, day, hour = 0) {
  return new Date(y, month - 1, day, hour);
}

/** Local-time date -> canister nanoseconds. */
function ns(y, month, day, hour = 0) {
  return BigInt(at(y, month, day, hour).getTime()) * 1_000_000n;
}

// clampToMonth mirrors `new Date` and takes a 0-based month; `at` above is
// 1-based. That's why the two sides of these assertions differ by one.
describe("clampToMonth", () => {
  it("keeps a day that exists in the target month", () => {
    expect(clampToMonth(2027, 0, 15)).toEqual(at(2027, 1, 15));
  });

  it("clamps 29 February back to the 28th in a common year", () => {
    // setMonth would roll this to 1 March, moving the anniversary.
    expect(clampToMonth(2027, 1, 29)).toEqual(at(2027, 2, 28));
  });

  it("keeps 29 February in a leap year", () => {
    expect(clampToMonth(2028, 1, 29)).toEqual(at(2028, 2, 29));
  });

  it("clamps the 31st to the last day of a 30-day month", () => {
    expect(clampToMonth(2027, 3, 31)).toEqual(at(2027, 4, 30));
  });
});

describe("anniversaryInfo", () => {
  it("counts down to this year's date when it is still ahead", () => {
    const info = anniversaryInfo(ns(2024, 6, 10), at(2027, 6, 1));
    expect(info.nextAnniversary).toEqual(at(2027, 6, 10));
    expect(info.daysUntil).toBe(9);
    expect(info.yearsCompleted).toBe(2);
    expect(info.nextAnniversaryNumber).toBe(3);
  });

  it("rolls to next year once the date has passed", () => {
    const info = anniversaryInfo(ns(2024, 6, 10), at(2027, 6, 11));
    expect(info.nextAnniversary).toEqual(at(2028, 6, 10));
    expect(info.yearsCompleted).toBe(3);
  });

  it("treats the day itself as today, not as a year away", () => {
    const info = anniversaryInfo(ns(2024, 6, 10), at(2027, 6, 10, 23));
    expect(info.isToday).toBe(true);
    expect(info.daysUntil).toBe(0);
    expect(info.nextAnniversaryNumber).toBe(3);
  });

  it("is unaffected by the time of day", () => {
    const early = anniversaryInfo(ns(2024, 6, 10, 1), at(2027, 6, 1, 23));
    const late = anniversaryInfo(ns(2024, 6, 10, 23), at(2027, 6, 1, 1));
    expect(early.daysUntil).toBe(late.daysUntil);
  });

  it("observes a 29 February anniversary on the 28th in common years", () => {
    const info = anniversaryInfo(ns(2024, 2, 29), at(2027, 2, 1));
    expect(info.nextAnniversary).toEqual(at(2027, 2, 28));
  });

  it("clamps the monthly milestone to short months", () => {
    const info = anniversaryInfo(ns(2024, 1, 31), at(2027, 2, 10));
    expect(info.nextMonthiversary).toEqual(at(2027, 2, 28));
  });

  it("does not count a month until its day arrives", () => {
    const start = ns(2024, 6, 20);
    // The day before the one-month mark is still zero months.
    expect(anniversaryInfo(start, at(2024, 7, 19)).monthsTogether).toBe(0);
    expect(anniversaryInfo(start, at(2024, 7, 20)).monthsTogether).toBe(1);
    expect(anniversaryInfo(start, at(2024, 8, 19)).monthsTogether).toBe(1);
    expect(anniversaryInfo(start, at(2024, 8, 20)).monthsTogether).toBe(2);
  });

  it("never reports negative totals for a future start date", () => {
    const info = anniversaryInfo(ns(2030, 1, 1), at(2027, 1, 1));
    expect(info.totalDays).toBe(0);
    expect(info.monthsTogether).toBe(0);
    expect(info.yearsCompleted).toBe(0);
  });
});

describe("clockSkewSeconds", () => {
  it("is near zero when the clocks agree", () => {
    const now = Date.now();
    expect(clockSkewSeconds(BigInt(now) * 1_000_000n, now)).toBeLessThan(1);
  });

  it("is symmetric — a fast browser clock is as wrong as a slow one", () => {
    const now = Date.now();
    const canister = BigInt(now + 600_000) * 1_000_000n;
    expect(clockSkewSeconds(canister, now)).toBe(600);
    expect(clockSkewSeconds(BigInt(now - 600_000) * 1_000_000n, now)).toBe(600);
  });
});
