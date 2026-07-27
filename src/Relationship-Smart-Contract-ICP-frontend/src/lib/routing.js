/**
 * Routing policy, as plain functions.
 *
 * These decisions are easy to get subtly wrong — the first version of this app
 * left a signed-in user sitting on the login screen, which reads exactly like
 * a failed login — so they live here where they can be tested directly rather
 * than only through a rendered router.
 */

/** Where a signed-in principal belongs, given their current state. */
export function routeForState({ isAuthenticated, active, outgoing, incoming }) {
  if (!isAuthenticated) return "/login";
  if (active) return "/us";
  if (outgoing) return "/pending";
  if (incoming?.length > 0) return "/invites";
  return "/new";
}

/**
 * True while the app must not route yet.
 *
 * `!state` matters as much as `loading`: signing in flips `isAuthenticated` a
 * render before the refresh effect starts, and routing on an empty state in
 * that gap sends an existing couple to the "create a proposal" screen before
 * snapping back.
 */
export function isBootstrapping({ booting, isAuthenticated, loading, state }) {
  if (booting) return true;
  return Boolean(isAuthenticated) && (Boolean(loading) || !state);
}
