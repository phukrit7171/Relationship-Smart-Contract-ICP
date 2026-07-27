import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ErrorBanner, Page } from "../components/Layout";

export default function Login() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleLogin() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="hearts" aria-hidden="true">
        🔐💕
      </div>
      <h1 className="title">
        Ask, and be asked <span className="title-emoji">💌</span>
      </h1>
      <p className="message">
        Send someone a link asking them to be yours. When they accept, both of
        your Principal IDs are written to the Internet Computer — a record
        neither of you can quietly edit later.
      </p>
      <p className="sub-message">
        Signing in is private and passwordless — your device's biometrics or a
        passkey, nothing else.
      </p>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <button className="login-btn" onClick={handleLogin} disabled={busy}>
        {busy ? "Opening Internet Identity…" : "Login with Internet Identity 🌐"}
      </button>
      <Link className="logout-btn" to="/join">
        Someone sent me a code 🔑
      </Link>
    </Page>
  );
}
