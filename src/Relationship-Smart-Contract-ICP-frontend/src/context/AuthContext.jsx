import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AuthClient } from "@icp-sdk/auth/client";
import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";
import { createActor } from "../bindings/relationship_backend";
import { getIdentityProviderUrl, SESSION_TTL_NS } from "../lib/identityProvider";
import { clearAll } from "../lib/photoCache";

const AuthContext = createContext(null);

function buildActor(identity) {
  const canisterEnv = safeGetCanisterEnv();
  const canisterId = canisterEnv?.["PUBLIC_CANISTER_ID:relationship_backend"];
  if (!canisterId) {
    throw new Error(
      "Backend canister ID is unavailable. Deploy the project, or start Vite after deploying the backend.",
    );
  }
  return createActor(canisterId, {
    agentOptions: {
      identity,
      host: window.location.origin,
      rootKey: canisterEnv?.IC_ROOT_KEY,
    },
  });
}

export function AuthProvider({ children }) {
  const [client, setClient] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [principal, setPrincipal] = useState("");
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authClient = new AuthClient({
          identityProvider: getIdentityProviderUrl(),
        });
        if (cancelled) return;
        setClient(authClient);
        if (authClient.isAuthenticated()) {
          const id = await authClient.getIdentity();
          if (cancelled) return;
          setIdentity(id);
          setPrincipal(id.getPrincipal().toText());
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      const id = await client.signIn({ maxTimeToLive: SESSION_TTL_NS });
      setIdentity(id);
      setPrincipal(id.getPrincipal().toText());
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    await client.signOut();
    setIdentity(null);
    setPrincipal("");
    // Decrypted photos are held as object URLs for the session; signing out
    // must not leave them reachable for whoever signs in next.
    clearAll();
  }, [client]);

  /**
   * An anonymous actor is created when nobody is signed in, so the public
   * invite-preview query works before authentication. Every mutating endpoint
   * rejects the anonymous principal on the canister side.
   */
  const [actor, setActor] = useState(null);

  useEffect(() => {
    if (booting) {
      setActor(null);
      return;
    }
    try {
      setActor(buildActor(identity ?? undefined));
    } catch (err) {
      setError(err);
      setActor(null);
    }
  }, [booting, identity]);

  const value = useMemo(
    () => ({
      booting,
      actor,
      identity,
      principal,
      isAuthenticated: Boolean(identity),
      signIn,
      signOut,
      error,
    }),
    [booting, actor, identity, principal, signIn, signOut, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
