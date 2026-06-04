import { useEffect, useRef, useState } from 'react';
import { subscribeLoading } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

// Wait out trivially fast requests so they don't flash the overlay.
const SHOW_DELAY = 120;
// Keep the loader up briefly after the last request settles. This is what
// bridges the gaps — between chained requests, and between the initial auth
// check and the first page fetch — so the whole load reads as one continuous
// loader instead of blinking off and on.
const HIDE_DELAY = 250;

/**
 * The single, app-wide loading overlay.
 *
 * Mounted ONCE at the App root (see main.jsx) so it persists across the auth
 * check, route changes and page data fetches. There is never a second
 * instance to unmount/remount, so the overlay animates in exactly once and
 * never blinks mid-session.
 *
 * Visible whenever auth is still resolving OR any non-silent API request is in
 * flight. Showing waits out very fast requests; hiding is debounced so a chain
 * of sequential requests (and the auth-check → first-fetch handoff) stays
 * covered the whole way through.
 */
export default function GlobalLoader() {
  const { loading: authLoading } = useAuth();
  const [busy, setBusy] = useState(false);

  // One subscription to the global request-activity counter in api.js.
  useEffect(() => subscribeLoading(setBusy), []);

  const active = authLoading || busy;
  const [visible, setVisible] = useState(active);
  const showTimer = useRef();
  const hideTimer = useRef();

  useEffect(() => {
    const clearShow = () => {
      if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = undefined; }
    };
    const clearHide = () => {
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = undefined; }
    };

    if (active) {
      clearHide();
      if (authLoading) {
        // Refresh / auth transitions cover the screen instantly — there is
        // nothing meaningful to paint underneath yet.
        clearShow();
        setVisible(true);
      } else if (!showTimer.current) {
        // A mid-session request waits out the show delay so quick calls don't
        // flash the overlay.
        showTimer.current = setTimeout(() => {
          showTimer.current = undefined;
          setVisible(true);
        }, SHOW_DELAY);
      }
    } else {
      clearShow(); // a queued show is no longer wanted
      hideTimer.current = setTimeout(() => {
        hideTimer.current = undefined;
        setVisible(false);
      }, HIDE_DELAY);
    }

    return () => { clearShow(); clearHide(); };
  }, [active, authLoading]);

  if (!visible) return null;

  return (
    <div className="global-loader" role="status" aria-label="Loading">
      <div className="shakti-loader">
        <span className="shakti-loader__label">LOADING</span>
        <div className="shakti-loader__bar">
          <div className="shakti-loader__fill">
            <div className="p"></div>
            <div className="o"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
