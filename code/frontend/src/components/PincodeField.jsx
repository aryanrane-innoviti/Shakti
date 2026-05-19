import { useState } from 'react';
import { api } from '../lib/api.js';

export default function PincodeField({ pincode, city, state, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cities, setCities] = useState(null);

  const lookup = async () => {
    setError(null);
    setCities(null);
    if (!/^\d{6}$/.test(pincode || '')) return;
    setBusy(true);
    try {
      const data = await api.get(`/pincode/${pincode}`);
      if (data.cities.length === 1) {
        onChange({ pincode, city: data.cities[0], state: data.state });
      } else {
        setCities({ list: data.cities, state: data.state });
        onChange({ pincode, city: '', state: '' });
      }
    } catch (e) {
      setError('Could not resolve pincode. Form cannot be submitted until resolved.');
      onChange({ pincode, city: '', state: '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div>
        <label>Pincode *</label>
        <input
          value={pincode || ''}
          onChange={(e) => onChange({ pincode: e.target.value, city, state })}
          onBlur={lookup}
          placeholder="6 digits"
        />
        {busy && <div className="help-text">Looking up...</div>}
        {error && <div className="error-text">{error} <button type="button" className="ghost" onClick={lookup}>Retry</button></div>}
      </div>
      <div>
        <label>City</label>
        {cities ? (
          <select value={city || ''} onChange={(e) => onChange({ pincode, city: e.target.value, state: cities.state })}>
            <option value="">Pick city...</option>
            {cities.list.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <input value={city || ''} readOnly placeholder="derived" />
        )}
      </div>
      <div>
        <label>State</label>
        <input value={state || ''} readOnly placeholder="derived" />
      </div>
    </>
  );
}
