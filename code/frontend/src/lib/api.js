const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('shakti_token');
}
export function setToken(t) {
  if (t) localStorage.setItem('shakti_token', t);
  else localStorage.removeItem('shakti_token');
}

async function request(method, path, body, opts = {}) {
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
  const res = await fetch(BASE + path, { method, headers, body: payload, ...opts });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', p, fd);
  },
};
