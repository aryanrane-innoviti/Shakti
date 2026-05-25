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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (force) return undefined;
    let timer;
    const unsubscribe = subscribeLoading((busy) => {
      clearTimeout(timer);
      if (busy) {
        timer = setTimeout(() => setVisible(true), 150);
      } else {
        setVisible(false);
      }
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [force]);

  if (!force && !visible) return null;

  return (
    <div className="global-loader" role="status" aria-label="Loading">
      <div className="s-loader">
        <div className="s-loader-whirl">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            {/* Outer arc, broken into two sweeps */}
            <path className="arc arc-3" d="M 100 6 A 94 94 0 0 1 184 60" />
            <path
              className="arc arc-3"
              d="M 100 194 A 94 94 0 0 1 16 140"
              style={{ animationDelay: '-1.7s' }}
            />

            {/* Middle arc */}
            <path className="arc arc-2" d="M 100 22 A 78 78 0 1 1 22 100" />

            {/* Inner arc (matches S spin) */}
            <path className="arc arc-1" d="M 100 38 A 62 62 0 0 1 162 100" />
            <path
              className="arc arc-1"
              d="M 100 162 A 62 62 0 0 1 38 100"
              style={{ animationDelay: '-0.8s' }}
            />

            {/* Particle dots riding the orbits */}
            <g className="dot-a">
              <circle className="dot-purple" cx="100" cy="38" r="2.6" />
            </g>
            <g className="dot-b">
              <circle className="dot-orange" cx="100" cy="22" r="2.2" />
            </g>
            <g className="dot-a" style={{ animationDelay: '-0.55s' }}>
              <circle className="dot-orange" cx="100" cy="38" r="1.8" opacity="0.85" />
            </g>
          </svg>
        </div>

        <div className="s-loader-letter">S</div>
      </div>
    </div>
  );
}
