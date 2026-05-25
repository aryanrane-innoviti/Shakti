// Suggest a header-to-target-field mapping. Bijection enforced:
// each header maps to at most one target, each target gets at most one header.

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function suggestMapping(headers, targetFields) {
  const normalizedHeaders = headers.map((h) => ({ original: h, norm: normalize(h) }));
  const result = {};
  const usedHeaders = new Set();

  for (const tf of targetFields) {
    if (tf.server_set) continue; // server-set fields should not auto-map
    const candidates = [normalize(tf.field), ...(tf.synonyms || []).map(normalize)];
    let pick = null;
    for (const cand of candidates) {
      const hit = normalizedHeaders.find(
        (h) => !usedHeaders.has(h.original) && h.norm === cand
      );
      if (hit) { pick = hit.original; break; }
    }
    if (pick) {
      result[tf.field] = pick;
      usedHeaders.add(pick);
    } else {
      result[tf.field] = null;
    }
  }
  return result;
}

// Validate the explicit mapping the client posted at commit time.
// Returns an array of issues; empty array = ok.
export function validateMapping(mapping, targetFields, headers) {
  const issues = [];
  const headerSet = new Set(headers);
  const targetByField = new Map(targetFields.map((t) => [t.field, t]));
  const usedHeader = new Map();

  for (const [field, header] of Object.entries(mapping || {})) {
    if (!targetByField.has(field)) {
      issues.push({ code: 'unknown_target', field });
      continue;
    }
    if (header == null) continue;
    if (!headerSet.has(header)) {
      issues.push({ code: 'unknown_header', field, header });
      continue;
    }
    if (usedHeader.has(header)) {
      issues.push({ code: 'header_double_mapped', header, fields: [usedHeader.get(header), field] });
    } else {
      usedHeader.set(header, field);
    }
  }

  // Required, non-server-set targets must be mapped.
  for (const tf of targetFields) {
    if (tf.required && !tf.server_set) {
      const h = mapping?.[tf.field];
      if (!h) issues.push({ code: 'required_target_unmapped', field: tf.field });
    }
  }

  return issues;
}

// Split the mapping into effective (used by validation) and dropped
// (mapped to a server_set target — silently ignored).
export function splitMapping(mapping, targetFields) {
  const serverSetFields = new Set(targetFields.filter((t) => t.server_set).map((t) => t.field));
  const effective = {};
  const dropped = [];
  for (const [field, header] of Object.entries(mapping || {})) {
    if (header == null) continue;
    if (serverSetFields.has(field)) dropped.push(field);
    else effective[field] = header;
  }
  return { effective, dropped };
}
