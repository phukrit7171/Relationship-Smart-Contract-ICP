import { describe, expect, it } from "vitest";
import { isBootstrapping, routeForState } from "./routing";

const signedOut = {
  isAuthenticated: false,
  active: null,
  outgoing: null,
  incoming: [],
};
const signedIn = { ...signedOut, isAuthenticated: true };

describe("routeForState", () => {
  it("sends an anonymous visitor to login", () => {
    expect(routeForState(signedOut)).toBe("/login");
  });

  it("never leaves a signed-in principal on the login screen", () => {
    // The bug this guards: signIn resolves in a popup, so nothing navigates
    // away on its own. A signed-in user left on /login sees only a login
    // button, which is indistinguishable from the sign-in having failed.
    expect(routeForState(signedIn)).not.toBe("/login");
  });

  it("prefers an active relationship over everything else", () => {
    expect(
      routeForState({
        ...signedIn,
        active: { id: 1n },
        outgoing: { id: 2n },
        incoming: [{ id: 3n }],
      }),
    ).toBe("/us");
  });

  it("shows an unclaimed invite ahead of the inbox", () => {
    expect(
      routeForState({ ...signedIn, outgoing: { id: 2n }, incoming: [{ id: 3n }] }),
    ).toBe("/pending");
  });

  it("shows the inbox when someone is waiting on an answer", () => {
    expect(routeForState({ ...signedIn, incoming: [{ id: 3n }] })).toBe("/invites");
  });

  it("falls through to creating a proposal", () => {
    expect(routeForState(signedIn)).toBe("/new");
  });

  it("tolerates a missing incoming list", () => {
    // MyState is absent for a beat right after sign-in.
    expect(routeForState({ ...signedIn, incoming: undefined })).toBe("/new");
  });
});

describe("isBootstrapping", () => {
  const loaded = {
    booting: false,
    isAuthenticated: true,
    loading: false,
    state: { now: 1n },
  };

  it("waits while the auth client is starting", () => {
    expect(isBootstrapping({ ...loaded, booting: true })).toBe(true);
  });

  it("waits while state is being fetched", () => {
    expect(isBootstrapping({ ...loaded, loading: true })).toBe(true);
  });

  it("waits in the gap between signing in and the fetch starting", () => {
    // loading is still false here — this is the render where isAuthenticated
    // has flipped but the refresh effect has not run yet. Routing now would
    // send an existing couple to /new.
    expect(isBootstrapping({ ...loaded, loading: false, state: null })).toBe(true);
  });

  it("does not wait for an anonymous visitor with no state", () => {
    expect(
      isBootstrapping({
        booting: false,
        isAuthenticated: false,
        loading: false,
        state: null,
      }),
    ).toBe(false);
  });

  it("stops waiting once state has arrived", () => {
    expect(isBootstrapping(loaded)).toBe(false);
  });
});
