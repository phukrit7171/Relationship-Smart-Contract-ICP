import { useAnniversary } from "../hooks/useAnniversary";
import {
  BANNER_WINDOW_DAYS,
  clockSkewSeconds,
  SKEW_WARNING_SECONDS,
} from "../lib/anniversary";

const ORDINALS = ["", "1st", "2nd", "3rd"];

function ordinal(n) {
  if (n < ORDINALS.length) return ORDINALS[n];
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** A live H:MM:SS countdown to midnight on the anniversary. */
function Countdown({ target, now }) {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <span className="countdown" aria-live="off">
      {days > 0 && <b>{days}d </b>}
      {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:
      {String(seconds).padStart(2, "0")}
    </span>
  );
}

/**
 * The running tally of how long the pair has been together, plus the
 * countdown to the next anniversary.
 */
export function TogetherSince({ acceptedAt, canisterNow }) {
  const info = useAnniversary(acceptedAt);
  if (!info) return null;

  const skewed =
    canisterNow !== undefined &&
    clockSkewSeconds(canisterNow, info.now.getTime()) > SKEW_WARNING_SECONDS;

  return (
    <div className="together-box">
      <span className="timestamp-label">💞 Together</span>
      <div className="together-figures">
        <Figure value={info.totalDays} unit={info.totalDays === 1 ? "day" : "days"} />
        <Figure
          value={info.monthsTogether}
          unit={info.monthsTogether === 1 ? "month" : "months"}
        />
        <Figure
          value={info.yearsCompleted}
          unit={info.yearsCompleted === 1 ? "year" : "years"}
        />
      </div>
      <span className="timestamp-raw">
        {info.isToday ? (
          <>Today is your {ordinal(info.nextAnniversaryNumber)} anniversary 🎉</>
        ) : (
          <>
            {ordinal(info.nextAnniversaryNumber)} anniversary in{" "}
            <Countdown target={info.nextAnniversary} now={info.now} />
          </>
        )}
      </span>
      {skewed && (
        <span className="timestamp-raw skew-warning">
          ⚠️ This device's clock disagrees with the network by more than five
          minutes, so these figures may be off.
        </span>
      )}
    </div>
  );
}

function Figure({ value, unit }) {
  return (
    <span className="figure">
      <b>{value.toLocaleString()}</b>
      <small>{unit}</small>
    </span>
  );
}

/**
 * Shows in the week before the anniversary and on the day itself. Silent the
 * rest of the year — a banner that is always up stops being a signal.
 */
export function AnniversaryBanner({ acceptedAt, action }) {
  const info = useAnniversary(acceptedAt, 60_000);
  if (!info || info.daysUntil > BANNER_WINDOW_DAYS) return null;

  const nth = ordinal(info.nextAnniversaryNumber);

  return (
    <div className={`anniversary-banner ${info.isToday ? "is-today" : ""}`.trim()}>
      <span className="banner-emoji" aria-hidden="true">
        {info.isToday ? "🎂" : "📅"}
      </span>
      <div className="banner-text">
        <strong>
          {info.isToday
            ? `Happy ${nth} anniversary!`
            : info.daysUntil === 1
              ? `Your ${nth} anniversary is tomorrow`
              : `Your ${nth} anniversary is in ${info.daysUntil} days`}
        </strong>
        {action}
      </div>
    </div>
  );
}
