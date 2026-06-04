import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { subscribeLoading } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

// Wait out trivially fast requests so they don't flash the overlay.
const SHOW_DELAY = 120;
// Keep the loader up briefly after the last request settles. This is what
// bridges the gaps — between chained requests, and between the initial auth
// check and the first page fetch — so the whole load reads as one continuous
// loader instead of blinking off and on.
const HIDE_DELAY = 250;
// After a route change, hold the cover for this long while the destination
// page mounts and fires its first request. If a request starts, `busy` takes
// over; if the page has no fetch at all, the cover auto-dismisses.
const NAV_GRACE = 200;

/**
 * The single, app-wide loading overlay.
 *
 * Mounted ONCE at the App root (see main.jsx) so it persists across the auth
 * check, route changes and page data fetches. There is never a second
 * instance to unmount/remount, so the overlay animates in exactly once and
 * never blinks mid-session.
 *
 * Visible whenever auth is still resolving, a route change is in progress, OR
 * any non-silent API request is in flight. Showing waits out very fast
 * requests; hiding is debounced so a chain of sequential requests (and the
 * auth-check → first-fetch handoff) stays covered the whole way through.
 */
export default function GlobalLoader() {
  const { loading: authLoading } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [navHold, setNavHold] = useState(false);

  // One subscription to the global request-activity counter in api.js.
  useEffect(() => subscribeLoading(setBusy), []);

  const active = authLoading || busy || navHold;
  const [visible, setVisible] = useState(active);
  const showTimer = useRef();
  const hideTimer = useRef();

  // Route change → cover the screen *before* the destination page paints its
  // empty/data-less state. useLayoutEffect runs after the DOM is committed but
  // before the browser paints, so setting visible here suppresses the flash of
  // an un-loaded page background. The grace window is then handed off to the
  // page's first request (`busy`), or expires on its own for static pages.
  useLayoutEffect(() => {
    setVisible(true);
    setNavHold(true);
    const t = setTimeout(() => setNavHold(false), NAV_GRACE);
    return () => clearTimeout(t);
  }, [location.key]);

  useEffect(() => {
    const clearShow = () => {
      if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = undefined; }
    };
    const clearHide = () => {
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = undefined; }
    };

    if (active) {
      clearHide();
      if (authLoading || navHold) {
        // Refresh, auth transitions and navigation cover the screen instantly —
        // there is nothing meaningful to paint underneath yet.
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
  }, [active, authLoading, navHold]);

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
