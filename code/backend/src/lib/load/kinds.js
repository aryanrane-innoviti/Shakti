// Per-master-kind definitions. Adding a new kind = add an entry here.
// Target fields with server_set=true are populated by the commit handler,
// not from the file; if the client maps a header to them the mapping is
// dropped and recorded as an "info" entry on the attempt.
//
// matchField — what a row is resolved against:
//   'vendor_sku_number' → the row's Owner (vendor) + that vendor's SKU number
//                         resolve to one vendor SKU (vendor_skus). The unit is
//                         anchored to that vendor SKU; its Innoviti SKU(s) are
//                         derived through sku_vendor_links.
//   'sku_number'        → resolved directly to one Innoviti SKU (skus.sku_number).

const COMMON_SERVER_SET = [
  { field: 'present_location_id',    type: 'fk_location', required: false, server_set: true },
  { field: 'present_location_since', type: 'timestamp',   required: false, server_set: true },
  { field: 'last_audited_at',        type: 'timestamp',   required: false, server_set: true },
  { field: 'state',                  type: 'enum',        required: false, server_set: true },
];

export const KINDS = {
  payment_terminal: {
    label: 'Payment Terminal',
    requiredSkuTypeName: 'Payment Terminal',
    tableName: 'payment_terminal_master',
    pkColumn: 'payment_terminal_master_id',
    defaultState: 'Working',
    changeLogObjectType: 'PaymentTerminalMaster',
    uniqueIndexLabel: 'serial_number',
    matchField: 'vendor_sku_number',
    targetFields: [
      { field: 'vendor_sku_number', type: 'string', required: true,  synonyms: ['vendor sku', 'vendorsku', 'vendor sku number', 'vendor sku no', 'vendor sku#', 'vendor part number', 'vendorpartnumber', 'vsku', 'sku', 'sku#', 'sku_no', 'sku no', 'partnumber', 'part number', 'partno', 'part no'] },
      { field: 'description',      type: 'string', required: false, synonyms: ['desc', 'sku description', 'skudescription', 'notes', 'remarks', 'details'] },
      { field: 'owner',            type: 'string', required: true,  synonyms: ['vendor', 'supplier', 'owner name', 'ownername'] },
      { field: 'serial_number',    type: 'string', required: true,  synonyms: ['serial', 'serial no', 'serialno', 'sno', 's.no', 's no', 'serial#', 'terminalserial', 'terminal serial', 'terminal sr no', 'terminal sr. no.', 'sr no', 'sr. no.'] },
      { field: 'date_of_purchase', type: 'date',   required: false, synonyms: ['purchase date', 'purchasedate', 'date purchased', 'date of buy', 'buydate', 'dop', 'invoice date'] },
      ...COMMON_SERVER_SET,
    ],
  },

  sim_card: {
    label: 'SIM Card',
    requiredSkuTypeName: 'SIM Card',
    tableName: 'sim_card_master',
    pkColumn: 'sim_card_master_id',
    defaultState: 'Active',
    changeLogObjectType: 'SIMCardMaster',
    uniqueIndexLabel: 'sim_card_number',
    matchField: 'sku_number',
    targetFields: [
      { field: 'sku_number',      type: 'string', required: true,  synonyms: ['sku', 'sku#', 'sku_no', 'sku no', 'partnumber', 'part number'] },
      { field: 'description',     type: 'string', required: false, synonyms: ['desc', 'sku description', 'skudescription', 'notes', 'remarks', 'details'] },
      { field: 'owner',           type: 'string', required: true,  synonyms: ['vendor', 'supplier', 'owner name', 'ownername'] },
      { field: 'sim_card_number', type: 'string', required: true,  synonyms: ['sim', 'sim number', 'simnumber', 'sim#', 'iccid', 'sim no', 'sim_no'] },
      { field: 'date_of_purchase', type: 'date',  required: false, synonyms: ['purchase date', 'purchasedate', 'date purchased', 'date of buy', 'buydate', 'dop', 'invoice date'] },
      ...COMMON_SERVER_SET,
    ],
  },

  base_station: {
    label: 'Base Station',
    requiredSkuTypeName: 'Base Station',
    tableName: 'base_station_master',
    pkColumn: 'base_station_master_id',
    defaultState: 'Working',
    changeLogObjectType: 'BaseStationMaster',
    uniqueIndexLabel: 'serial_number',
    matchField: 'vendor_sku_number',
    targetFields: [
      { field: 'vendor_sku_number', type: 'string', required: true,  synonyms: ['vendor sku', 'vendorsku', 'vendor sku number', 'vendor sku no', 'vendor sku#', 'vendor part number', 'vendorpartnumber', 'vsku', 'sku', 'sku#', 'sku_no', 'sku no', 'partnumber', 'part number'] },
      { field: 'description',      type: 'string', required: false, synonyms: ['desc', 'sku description', 'skudescription', 'notes', 'remarks', 'details'] },
      { field: 'owner',            type: 'string', required: true,  synonyms: ['vendor', 'supplier', 'owner name', 'ownername'] },
      { field: 'serial_number',    type: 'string', required: true,  synonyms: ['serial', 'serial no', 'serialno', 'sno', 's.no', 's no', 'serial#', 'basestationserial'] },
      { field: 'date_of_purchase', type: 'date',   required: false, synonyms: ['purchase date', 'purchasedate', 'date purchased', 'buydate', 'dop'] },
      ...COMMON_SERVER_SET,
    ],
  },
};

export function getKind(name) {
  const k = KINDS[name];
  if (!k) {
    const err = new Error(`unknown load kind: ${name}`);
    err.status = 404;
    throw err;
  }
  return k;
}

export function publicTargetFields(kind) {
  return kind.targetFields.map(({ field, type, required, server_set }) => ({
    field, type, required: !!required, server_set: !!server_set,
  }));
}
