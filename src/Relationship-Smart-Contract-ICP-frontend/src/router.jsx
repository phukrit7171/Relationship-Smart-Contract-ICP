import { useEffect } from "react";
import {
  createHashRouter,
  Navigate,
  Outlet,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useRelationship } from "./context/RelationshipContext";
import { ErrorBanner, Loading, Page } from "./components/Layout";
import { isBootstrapping, routeForState } from "./lib/routing";
import Login from "./pages/Login";
import InviteLanding, { consumePendingInviteCode } from "./pages/InviteLanding";
import JoinWithCode from "./pages/JoinWithCode";
import CreateProposal from "./pages/CreateProposal";
import InviteInbox from "./pages/InviteInbox";
import OutgoingPending from "./pages/OutgoingPending";
import RelationshipHome from "./pages/RelationshipHome";
import PhotoUploader from "./pages/PhotoUploader";
import PhotoDetail from "./pages/PhotoDetail";
import History from "./pages/History";
import Settings from "./pages/Settings";

/**
 * Waits for auth and state, then resumes an interrupted invite flow.
 *
 * Internet Identity drops you back on the bare origin, so the code stashed by
 * `InviteLanding` is picked up here and the visitor is returned to the
 * invitation rather than the "create a proposal" screen.
 */
function Root() {
  const { booting, isAuthenticated, error } = useAuth();
  const { loading, state, error: stateError } = useRelationship();
  const navigate = useNavigate();

  useEffect(() => {
    if (booting || !isAuthenticated) return;
    const code = consumePendingInviteCode();
    if (code) navigate(`/invite/${code}`, { replace: true });
  }, [booting, isAuthenticated, navigate]);

  // stateError is checked here too, otherwise a failing get_my_state would
  // leave `state` null forever and the loading guard below would never lift.
  if (error || stateError) {
    return (
      <Page>
        <h1 className="title">Can't reach the canister</h1>
        <ErrorBanner error={error ?? stateError} />
        <p className="sub-message">
          If you're running locally, start the replica and deploy the backend:
          <code> icp network start -d &amp;&amp; icp deploy</code>
        </p>
      </Page>
    );
  }

  if (isBootstrapping({ booting, isAuthenticated, loading, state })) {
    return <Loading />;
  }
  return <Outlet />;
}

/** Bounces anonymous visitors to the login screen. */
function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

/**
 * Sends an already-signed-in visitor on to wherever they belong.
 *
 * `signIn` resolves in a popup rather than redirecting the page, so without
 * this the login screen stays mounted after a successful sign-in — and the
 * only thing on it is a login button, which makes it look like the sign-in
 * silently failed.
 */
function RedirectIfAuthenticated({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/" replace /> : children;
}

/** Sends each principal to whichever screen matches their current state. */
function Home() {
  const { isAuthenticated } = useAuth();
  const { active, outgoing, incoming } = useRelationship();
  return (
    <Navigate
      to={routeForState({ isAuthenticated, active, outgoing, incoming })}
      replace
    />
  );
}

/**
 * Guards a screen that only makes sense in one state, so a stale bookmark
 * lands on the right page instead of crashing on a null relationship.
 */
function RequireState({ pick, children }) {
  const relationship = useRelationship();
  return pick(relationship) ? children : <Navigate to="/" replace />;
}

/**
 * Exported separately from `router` so tests can mount them in a memory
 * router without the hash history.
 */
export const routes = [
  {
    element: <Root />,
    children: [
      { path: "/", element: <Home /> },
      {
        path: "/login",
        element: (
          <RedirectIfAuthenticated>
            <Login />
          </RedirectIfAuthenticated>
        ),
      },
      // The only two routes reachable without signing in: an invite link, and
      // the form for typing a code in by hand.
      { path: "/invite/:code", element: <InviteLanding /> },
      { path: "/join", element: <JoinWithCode /> },
      {
        path: "/new",
        element: (
          <RequireAuth>
            <RequireState pick={(r) => !r.active && !r.outgoing}>
              <CreateProposal />
            </RequireState>
          </RequireAuth>
        ),
      },
      {
        path: "/pending",
        element: (
          <RequireAuth>
            <RequireState pick={(r) => r.outgoing}>
              <OutgoingPending />
            </RequireState>
          </RequireAuth>
        ),
      },
      {
        path: "/invites",
        element: (
          <RequireAuth>
            <RequireState pick={(r) => r.incoming.length > 0}>
              <InviteInbox />
            </RequireState>
          </RequireAuth>
        ),
      },
      {
        path: "/us",
        element: (
          <RequireAuth>
            <RequireState pick={(r) => r.active}>
              <RelationshipHome />
            </RequireState>
          </RequireAuth>
        ),
      },
      {
        path: "/us/upload",
        element: (
          <RequireAuth>
            <RequireState pick={(r) => r.active}>
              <PhotoUploader />
            </RequireState>
          </RequireAuth>
        ),
      },
      {
        path: "/us/photo/:photoId",
        element: (
          <RequireAuth>
            <RequireState pick={(r) => r.active}>
              <PhotoDetail />
            </RequireState>
          </RequireAuth>
        ),
      },
      {
        path: "/history",
        element: (
          <RequireAuth>
            <History />
          </RequireAuth>
        ),
      },
      {
        path: "/settings",
        element: (
          <RequireAuth>
            <Settings />
          </RequireAuth>
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

export const router = createHashRouter(routes);
