import { useEffect, useState } from 'react';
import { subscribeLoading } from '../lib/api.js';

/**
 * Transparent "S" spinner shown whenever an API request is in flight.
 * It subscribes to the request-activity counter in api.js, so every
 * api.get / post / patch / del / upload call triggers it automatically.
 *
 * A short delay before showing avoids a flash on very fast requests.
 *
 * Pass `force` to show the spinner unconditionally — used for the
 * initial auth check on a full page refresh, before any layout renders.
 */
export default function GlobalLoader({ force = false }) {
  // Start visible so the very first mount inside Layout bridges the gap
  // between the auth-gate force-loader unmounting and the new page firing
  // its initial API request (otherwise the page paints uncovered for a
  // few frames before the subscriber kicks in).
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (force) return undefined;
    let showTimer;
    let hideTimer;
    let graceTimer;
    let pastGrace = false;
    let busyNow = false;

    const cancelHide = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = undefined; }
    };
    const scheduleHide = () => {
      cancelHide();
      // Hold the loader for a short window after the last in-flight request
      // ends. Pages often chain awaits (request → request → request); without
      // this delay the loader hides between each one and the page flashes
      // through. A follow-up request within the window cancels the hide.
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        setVisible(false);
      }, 200);
    };
    const scheduleShow = () => {
      if (showTimer) return; // don't reset; let the original 150ms tick run
      showTimer = setTimeout(() => {
        showTimer = undefined;
        // Suppress the show if all requests already completed in under 150ms.
        if (busyNow) setVisible(true);
      }, 150);
    };

    // Initial-mount bridging: the auth-gate force-loader has just unmounted
    // and the new page's useEffect hasn't fired its API request yet. Keep
    // the loader visible across that gap.
    graceTimer = setTimeout(() => {
      pastGrace = true;
      if (!busyNow) scheduleHide();
    }, 200);

    const unsubscribe = subscribeLoading((busy) => {
      busyNow = busy;
      if (!pastGrace) {
        if (busy) setVisible(true);
        return;
      }
      if (busy) {
        cancelHide();
        scheduleShow();
      } else {
        scheduleHide();
      }
    });

    return () => {
      if (showTimer) clearTimeout(showTimer);
      cancelHide();
      clearTimeout(graceTimer);
      unsubscribe();
    };
  }, [force]);

  if (!force && !visible) return null;

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
