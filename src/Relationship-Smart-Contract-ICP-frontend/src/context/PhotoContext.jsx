import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "./AuthContext";
import { useRelationship } from "./RelationshipContext";
import { unwrap } from "../lib/result";

const PhotoContext = createContext(null);

/** Owns the photo list for the active relationship. */
export function PhotoProvider({ children }) {
  const { actor } = useAuth();
  const { active } = useRelationship();
  const relationshipId = active?.id;

  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!actor || relationshipId === undefined) return;
    try {
      setPhotos(unwrap(await actor.list_photos(relationshipId)));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [actor, relationshipId]);

  useEffect(() => {
    if (relationshipId === undefined) {
      setPhotos([]);
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
  }, [relationshipId, refresh]);

  const value = useMemo(
    () => ({ photos, loading, error, refresh, relationshipId }),
    [photos, loading, error, refresh, relationshipId],
  );

  return <PhotoContext.Provider value={value}>{children}</PhotoContext.Provider>;
}

export function usePhotos() {
  const ctx = useContext(PhotoContext);
  if (!ctx) throw new Error("usePhotos must be used inside <PhotoProvider>");
  return ctx;
}
