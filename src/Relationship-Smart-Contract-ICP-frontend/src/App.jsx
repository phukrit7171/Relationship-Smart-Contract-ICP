import { useEffect, useState } from "react";
import { Relationship_Smart_Contract_ICP_backend } from "declarations/Relationship-Smart-Contract-ICP-backend";
import "./index.scss";

// Convert nanosecond timestamp (bigint) to a human-readable date string
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

export default function App() {
  const [isAccepted, setIsAccepted] = useState(false);
  const [acceptedTime, setAcceptedTime] = useState(0n);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  // Fetch the current status when the page loads
  useEffect(() => {
    Relationship_Smart_Contract_ICP_backend.get_status()
      .then((status) => {
        setIsAccepted(status.is_accepted);
        setAcceptedTime(status.accepted_time);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleAccept() {
    setAccepting(true);
    try {
      await Relationship_Smart_Contract_ICP_backend.accept_proposal();
      // Re-fetch the definitive on-chain status after acceptance
      const status = await Relationship_Smart_Contract_ICP_backend.get_status();
      setIsAccepted(status.is_accepted);
      setAcceptedTime(status.accepted_time);
    } catch (err) {
      console.error("Error accepting proposal:", err);
    } finally {
      setAccepting(false);
    }
  }

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

  if (isAccepted) {
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
            <span className="timestamp-raw">
              ({acceptedTime.toString()} ns)
            </span>
          </div>
        </div>
      </main>
    );
  }

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
        <button
          className="accept-btn"
          onClick={handleAccept}
          disabled={accepting}
          aria-busy={accepting}
        >
          {accepting ? "Recording on-chain… ⏳" : "Accept 💖"}
        </button>
      </div>
    </main>
  );
}
