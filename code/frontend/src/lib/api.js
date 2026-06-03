const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('shakti_token');
}
export function setToken(t) {
  if (t) localStorage.setItem('shakti_token', t);
  else localStorage.removeItem('shakti_token');
}

// --- Global request-activity tracking --------------------------------------
// Every in-flight API call bumps a counter; the global S loader is shown
// whenever the counter is above zero. Subscribers (the loader component) are
// notified on every change.
let activeRequests = 0;
const loadingSubscribers = new Set();

function notifyLoading() {
  const busy = activeRequests > 0;
  for (const fn of loadingSubscribers) fn(busy);
}

export function subscribeLoading(fn) {
  loadingSubscribers.add(fn);
  fn(activeRequests > 0);
  return () => loadingSubscribers.delete(fn);
}

async function request(method, path, body, opts = {}) {
  // `silent` keeps a request out of the global loader — for rapid background
  // writes (e.g. audit counter +/-) where a spinner is more distracting than
  // helpful. It is NOT a fetch option, so pull it out before spreading.
  const { silent = false, ...fetchOpts } = opts;
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (!silent) { activeRequests += 1; notifyLoading(); }
  try {
    const res = await fetch(BASE + path, { method, headers, body: payload, ...fetchOpts });
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) {
      const err = new Error(
        (data && data.error) || res.statusText || `HTTP ${res.status}`
      );
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    if (!silent) { activeRequests -= 1; notifyLoading(); }
  }
}

export const api = {
  get: (p, opts) => request('GET', p, undefined, opts),
  post: (p, b, opts) => request('POST', p, b, opts),
  patch: (p, b, opts) => request('PATCH', p, b, opts),
  put: (p, b, opts) => request('PUT', p, b, opts),
  del: (p, opts) => request('DELETE', p, undefined, opts),
  upload: (p, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', p, fd);
  },
};
