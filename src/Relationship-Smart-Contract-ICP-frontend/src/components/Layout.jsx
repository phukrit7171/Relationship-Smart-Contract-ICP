export function Particles() {
  return (
    <div className="particles" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <span className="particle" key={i}>
          💕
        </span>
      ))}
    </div>
  );
}

/** The single page shell every screen sits in. */
export function Page({ className = "", children }) {
  return (
    <main className={`proposal-page ${className}`.trim()}>
      <Particles />
      <div className="card">{children}</div>
    </main>
  );
}

export function Spinner({ label = "Loading…" }) {
  return <div className="spinner" role="status" aria-label={label} />;
}

export function Loading({ message = "Reading the blockchain…" }) {
  return (
    <Page>
      <Spinner />
      <p className="subtitle">{message}</p>
    </Page>
  );
}

export function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <span>{error.message ?? String(error)}</span>
      {onDismiss && (
        <button type="button" className="error-dismiss" onClick={onDismiss}>
          ✕
        </button>
      )}
    </div>
  );
}
