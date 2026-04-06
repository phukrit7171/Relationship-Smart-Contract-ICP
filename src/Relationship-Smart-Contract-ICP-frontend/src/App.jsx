import { useEffect, useState, useCallback } from "react";
import { AuthClient } from "@icp-sdk/auth/client";
import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { canisterId, idlFactory } from "declarations/Relationship-Smart-Contract-ICP-backend";
import "./index.scss";

// ── Helpers ──────────────────────────────────────────────────────────────────

function nsToDateString(ns) {
  const ms = Number(ns) / 1_000_000;
  return new Date(ms).toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function getIdentityProviderUrl() {
  const host = window.location.hostname;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost");
  if (isLocal) return "http://rdmx6-jaaaa-aaaaa-aaadq-cai.localhost:4943";
  return "https://identity.ic0.app";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [authClient, setAuthClient] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [principal, setPrincipal] = useState("");
  const [actor, setActor] = useState(null);
  const [isAccepted, setIsAccepted] = useState(false);
  const [acceptedTime, setAcceptedTime] = useState(0n);
  const [acceptedBy, setAcceptedBy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  // ── Actor factory ───────────────────────────────────────────────────────────

  const createAuthenticatedActor = useCallback(async (id) => {
    const agent = new HttpAgent({ identity: id });
    if (process.env.DFX_NETWORK !== "ic") {
      await agent.fetchRootKey().catch((err) => {
        console.warn("Unable to fetch root key — is the local replica running?");
        console.error(err);
      });
    }
    return Actor.createActor(idlFactory, { agent, canisterId });
  }, []);

  // ── Status fetcher ──────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async (actorInstance) => {
    try {
      const status = await actorInstance.get_status();
      setIsAccepted(status.is_accepted);
      setAcceptedTime(status.accepted_time);
      setAcceptedBy(status.accepted_by ?? null);
    } catch (err) {
      console.error("Error fetching status:", err);
    }
  }, []);

  // ── Mount: initialise AuthClient ────────────────────────────────────────────

  useEffect(() => {
    async function initAuth() {
      try {
        const client = await AuthClient.create();
        setAuthClient(client);

        const alreadyAuthenticated = await client.isAuthenticated();
        if (alreadyAuthenticated) {
          const id = client.getIdentity();
          const p = id.getPrincipal();
          setIdentity(id);
          setIsAuthenticated(true);
          setPrincipal(p.toText());

          const authenticatedActor = await createAuthenticatedActor(id);
          setActor(authenticatedActor);
          await fetchStatus(authenticatedActor);
        }
      } catch (err) {
        console.error("Auth initialisation error:", err);
      } finally {
        setLoading(false);
      }
    }

    initAuth();
  }, [createAuthenticatedActor, fetchStatus]);

  // ── Login ───────────────────────────────────────────────────────────────────

  async function login() {
    if (!authClient) return;
    const identityProvider = getIdentityProviderUrl();

    authClient.login({
      identityProvider,
      maxTimeToLive: BigInt(8) * BigInt(3_600_000_000_000),
      onSuccess: async () => {
        try {
          const id = authClient.getIdentity();
          const p = id.getPrincipal();
          setIdentity(id);
          setIsAuthenticated(true);
          setPrincipal(p.toText());

          const authenticatedActor = await createAuthenticatedActor(id);
          setActor(authenticatedActor);
          await fetchStatus(authenticatedActor);
        } catch (err) {
          console.error("Post-login setup error:", err);
        }
      },
      onError: (err) => {
        console.error("Login error:", err);
      },
    });
  }

  // ── Logout ──────────────────────────────────────────────────────────────────

  async function logout() {
    if (!authClient) return;
    await authClient.logout();
    setIdentity(null);
    setIsAuthenticated(false);
    setPrincipal("");
    setActor(null);
    setIsAccepted(false);
    setAcceptedTime(0n);
    setAcceptedBy(null);
  }

  // ── Accept proposal ─────────────────────────────────────────────────────────

  async function handleAccept() {
    if (!actor) return;
    setAccepting(true);
    try {
      await actor.accept_proposal();
      await fetchStatus(actor);
    } catch (err) {
      console.error("Error accepting proposal:", err);
    } finally {
      setAccepting(false);
    }
  }

  // ── Render: loading ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="proposal-page">
        <div className="card">
          <div className="spinner" aria-label="Loading…" />
          <p className="subtitle">Reading the blockchain…</p>
        </div>
      </main>
    );
  }

  // ── Render: accepted ────────────────────────────────────────────────────────

  if (isAuthenticated && isAccepted) {
    return (
      <main className="proposal-page accepted">
        <div className="card">
          <div className="hearts" aria-hidden="true">💖💍💖</div>
          <h1 className="title">She said YES! 🎉</h1>
          <p className="message">
            Our love story is now permanently engraved on the Internet Computer
            blockchain — immutable, unstoppable, and forever.
          </p>
          <div className="timestamp-box">
            <span className="timestamp-label">💎 Recorded on-chain at</span>
            <span className="timestamp-value">{nsToDateString(acceptedTime)}</span>
            <span className="timestamp-raw">({acceptedTime.toString()} ns)</span>
          </div>
          <div className="principal-box">
            <span className="principal-label">✍️ Digital Signature — Accepted by Principal</span>
            <span className="principal-value">
              {acceptedBy
                ? (acceptedBy.toText ? acceptedBy.toText() : acceptedBy.toString())
                : ""}
            </span>
            <span className="timestamp-raw">
              This Principal ID is the cryptographic proof of acceptance, permanently stored on-chain.
            </span>
          </div>
        </div>
      </main>
    );
  }

  // ── Render: logged in, not yet accepted ─────────────────────────────────────

  if (isAuthenticated && !isAccepted) {
    return (
      <main className="proposal-page">
        <div className="card">
          <div className="hearts" aria-hidden="true">💕</div>
          <h1 className="title">Will You Be My Girlfriend? 💌</h1>
          <p className="message">
            Every day with you feels like the luckiest day of my life. You make
            the world brighter, warmer, and infinitely more beautiful. I want to
            make this official — not just in my heart, but permanently recorded
            on the blockchain, forever. 🌹
          </p>
          <p className="sub-message">
            Once you click that button, our love becomes{" "}
            <strong>immutable on-chain history</strong>. No take-backs. 😉
          </p>
          <div className="principal-box">
            <span className="principal-label">🔑 Your Identity (Principal ID)</span>
            <span className="principal-value">{principal}</span>
          </div>
          <button
            className="accept-btn"
            onClick={handleAccept}
            disabled={accepting}
            aria-busy={accepting}
          >
            {accepting ? "Recording on-chain… ⏳" : "Accept 💖"}
          </button>
          <button className="logout-btn" onClick={logout}>
            Logout
          </button>
        </div>
      </main>
    );
  }

  // ── Render: not logged in ───────────────────────────────────────────────────

  return (
    <main className="proposal-page">
      <div className="card">
        <div className="hearts" aria-hidden="true">🔐💕</div>
        <h1 className="title">Will You Be My Girlfriend? 💌</h1>
        <p className="message">
          To accept this proposal, you need to verify your identity on the
          Internet Computer. Your Principal ID will be permanently recorded
          on-chain as cryptographic proof of your love. 💖
        </p>
        <p className="sub-message">
          Login is private, secure, and requires no password — just your
          device's biometrics or a passkey.
        </p>
        <button className="login-btn" onClick={login}>
          Login with Internet Identity 🌐
        </button>
      </div>
    </main>
  );
}
