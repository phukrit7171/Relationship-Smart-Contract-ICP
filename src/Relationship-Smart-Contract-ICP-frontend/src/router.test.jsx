// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

// The real contexts reach for IndexedDB and the canister bindings. Only the
// routing decisions are under test here, so both are replaced wholesale.
const auth = { booting: false, isAuthenticated: false, error: null, principal: "" };
const relationship = {
  loading: false,
  error: null,
  state: null,
  active: null,
  outgoing: null,
  incoming: [],
  history: [],
  refresh: vi.fn(),
};

vi.mock("./context/AuthContext", () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}));
vi.mock("./context/RelationshipContext", () => ({
  useRelationship: () => relationship,
  RelationshipProvider: ({ children }) => children,
}));
vi.mock("./context/PhotoContext", () => ({
  usePhotos: () => ({ photos: [], loading: false, refresh: vi.fn() }),
  PhotoProvider: ({ children }) => children,
}));

const { routes } = await import("./router");

function renderAt(path) {
  return render(
    <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />,
  );
}

function signIn(state = {}) {
  auth.isAuthenticated = true;
  relationship.state = { now: 0n, ...state };
  Object.assign(relationship, {
    active: null,
    outgoing: null,
    incoming: [],
    ...state,
  });
}

// Auto-cleanup only happens when vitest runs with globals enabled, which this
// config doesn't. Without it each render stacks on the last and queries start
// matching several copies of the same screen.
afterEach(cleanup);

beforeEach(() => {
  auth.booting = false;
  auth.isAuthenticated = false;
  auth.error = null;
  Object.assign(relationship, {
    loading: false,
    error: null,
    state: null,
    active: null,
    outgoing: null,
    incoming: [],
    history: [],
  });
});

describe("routing", () => {
  it("shows the login screen to an anonymous visitor", () => {
    renderAt("/login");
    expect(screen.getByText(/Login with Internet Identity/)).toBeTruthy();
  });

  it("sends an anonymous visitor away from a protected route", () => {
    renderAt("/us");
    expect(screen.getByText(/Login with Internet Identity/)).toBeTruthy();
  });

  it("does not leave a signed-in user on the login screen", () => {
    // The reported bug: sign-in succeeds in a popup, nothing navigates, and
    // the login button is still the only thing on screen — so the user clicks
    // it again, and again.
    signIn();
    renderAt("/login");
    expect(screen.queryByText(/Login with Internet Identity/)).toBeNull();
  });

  it("lands a couple on their relationship rather than the proposal form", () => {
    signIn({
      active: {
        id: 1n,
        title: "Us",
        accepted_at: 1_700_000_000_000_000_000n,
        proposer: { toText: () => "aaaaa-aa" },
        recipient: { toText: () => "bbbbb-bb" },
      },
    });
    renderAt("/");
    expect(screen.getByText(/Us/)).toBeTruthy();
  });

  it("holds on a loading screen until state arrives", () => {
    // Without this the router would decide on an empty state and flash the
    // wrong screen.
    auth.isAuthenticated = true;
    relationship.state = null;
    renderAt("/");
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText(/Login with Internet Identity/)).toBeNull();
  });

  it("surfaces a failing get_my_state instead of hanging on the spinner", () => {
    auth.isAuthenticated = true;
    relationship.state = null;
    relationship.error = new Error("boom");
    renderAt("/");
    expect(screen.getByText(/Can't reach the canister/)).toBeTruthy();
  });
});
