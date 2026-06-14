import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function InitialSetup() {
  const { refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [types, setTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({
    first_name: '', last_name: '',
    email: '', password: '',
    mobile: '', employee_id: '',
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/user-types'), api.get('/vendors'), api.get('/locations')]).then(([t, v, l]) => {
      setTypes(t);
      setVendors(v);
      setLocations(l);
    });
  }, []);

  const adminType = types.find((t) => t.code === 'ADMIN');
  const innoviti  = vendors.find((v) => v.is_seed || v.company_name === 'Innoviti');
  // The first Admin is tied to the seeded Bangalore HO location (task1.md §1.12).
  const bangaloreHo = locations.find(
    (l) => l.location_name === 'Bangalore HO' && Number(l.vendor_id) === Number(innoviti?.vendor_id)
  );

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post('/users', {
        ...form,
        user_type_id: adminType?.user_type_id,
        vendor_id: innoviti?.vendor_id,
        location_id: bangaloreHo?.location_id,
      });
      await refresh();
      navigate('/');
    } catch (e) {
      setErr(e.data?.error || e.message || 'Could not register Admin');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell auth-setup">
      <section className="auth-poster">
        <div className="topline">
          <span className="pip" /> Initial Setup
        </div>
        <div>
          <h1 className="wordmark">First<span className="dot">.</span></h1>
          <p className="tagline">
            Register your first Admin user. Until you do, Super Admin can't reach anything else.
          </p>
        </div>
        <div className="colophon">
          <span>Step 01 / 01</span>
          <span>Reversible</span>
        </div>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <p className="label-section">Register Admin</p>
          <h2>Create the first Admin.</h2>
          <p className="lede">
            Operational object management belongs to Admin. SA only handles user types and backups.
          </p>

          <div className="form-grid">
            <div>
              <label>First name *</label>
              <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div>
              <label>Last name *</label>
              <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </div>
            <div className="full">
              <label>Email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@innoviti.com" />
            </div>
            <div className="full">
              <label>Initial password *</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Share this once; user resets after first login" />
            </div>
            <div>
              <label>Mobile</label>
              <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="optional" />
            </div>
            <div>
              <label>Employee ID *</label>
              <input placeholder="IC/0001 or INN/9999" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} />
            </div>
          </div>

          {err && <div className="error-text" style={{ marginTop: 16 }}>{err}</div>}

          <div className="row between" style={{ marginTop: 28 }}>
            <button type="button" className="ghost" onClick={async () => { await logout(); navigate('/login'); }}>
              Sign out
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Registering…' : 'Register Admin →'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
