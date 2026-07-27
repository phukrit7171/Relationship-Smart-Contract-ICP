import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "./AuthContext";

const RelationshipContext = createContext(null);

/**
 * Owns `get_my_state` and re-reads it after every mutation.
 *
 * No optimistic updates: an update call takes a couple of seconds, so the
 * honest thing is an in-flight indicator followed by real state, rather than a
 * guess that occasionally has to be walked back.
 */
export function RelationshipProvider({ children }) {
  const { actor, isAuthenticated, booting } = useAuth();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!actor || !isAuthenticated) return null;
    try {
      const next = await actor.get_my_state();
      if (!isAuthenticated) return null;
      setState(next);
      setError(null);
      return next;
    } catch (err) {
      if (isAuthenticated) setError(err);
      return null;
    }
  }, [actor, isAuthenticated]);

  useEffect(() => {
    if (booting) return;
    if (!isAuthenticated) {
      setState(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [booting, isAuthenticated, refresh]);

  const value = useMemo(
    () => ({
      state,
      loading,
      error,
      refresh,
      active: state?.active ?? null,
      outgoing: state?.outgoing ?? null,
      incoming: state?.incoming ?? [],
      history: state?.history ?? [],
    }),
    [state, loading, error, refresh],
  );

  return (
    <RelationshipContext.Provider value={value}>
      {children}
    </RelationshipContext.Provider>
  );
}

export function useRelationship() {
  const ctx = useContext(RelationshipContext);
  if (!ctx) {
    throw new Error("useRelationship must be used inside <RelationshipProvider>");
  }
  return ctx;
}
