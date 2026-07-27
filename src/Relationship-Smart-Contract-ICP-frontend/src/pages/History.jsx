import { Link } from "react-router-dom";
import { useRelationship } from "../context/RelationshipContext";
import { Page } from "../components/Layout";
import { nsToShortDate } from "../lib/format";

const LABEL = {
  Ended: "Ended",
  Declined: "Declined",
  Cancelled: "Withdrawn",
};

export default function History() {
  const { history } = useRelationship();

  return (
    <Page>
      <div className="hearts" aria-hidden="true">
        🕰️
      </div>
      <h1 className="title">What came before</h1>

      {history.length === 0 ? (
        <p className="message">Nothing here yet.</p>
      ) : (
        <ul className="invite-list">
          {history.map((rel) => (
            <li className="invite-item" key={rel.id.toString()}>
              <h2 className="invite-title">
                {rel.title || "Untitled"}{" "}
                <span className={`status-chip status-${rel.status.toLowerCase()}`}>
                  {LABEL[rel.status] ?? rel.status}
                </span>
              </h2>
              {rel.accepted_at !== undefined && (
                <p className="timestamp-raw">
                  Together {nsToShortDate(rel.accepted_at)} –{" "}
                  {rel.ended_at !== undefined ? nsToShortDate(rel.ended_at) : "?"}
                </p>
              )}
              {rel.end_reason && <p className="sub-message">“{rel.end_reason}”</p>}
            </li>
          ))}
        </ul>
      )}

      <Link className="logout-btn" to="/">
        Back
      </Link>
    </Page>
  );
}
