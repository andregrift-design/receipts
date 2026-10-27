// Stand-in for src/api.js so the screens can be tried without an account (tools/ui-test.html).
import { problems } from '../src/vat.js';
const user = { id: 'me', email: 'me@example.com' };
let rows = [
  { id: 'a', user_id: 'me', status: 'done', store: 'Albert Heijn', description: 'Office lunch', category: 'Meals', receipt_date: '2026-09-03', period: '2026-Q3', currency: 'EUR', total: 31.3, vat_country: 'NL', vat_lines: [{ rate: 9, net: 20, vat: 1.8 }, { rate: 21, net: 7.85, vat: 1.65 }], fx_rate: 1, issues: [], file_path: 'me/a.png', file_type: 'image/png', created_at: '2026-09-03T10:00:00Z', updated_at: '1' },
  { id: 'b', user_id: 'me', status: 'review', store: 'Hotel Adlon', description: 'Hotel 1 night', category: 'Accommodation', receipt_date: '2026-08-12', period: '2026-Q3', currency: 'EUR', total: 119, vat_country: 'DE', vat_lines: [], fx_rate: 1, issues: ['VAT not shown on the receipt.'], file_path: 'me/b.jpg', file_type: 'image/jpeg', created_at: '2026-08-12T10:00:00Z', updated_at: '1' },
  { id: 'c', user_id: 'me', status: 'done', doc_type: 'payment', store: 'Yellow Cab', description: 'Taxi', category: 'Travel', receipt_date: '2026-07-20', period: '2026-Q3', currency: 'USD', total: 50, vat_country: 'US', vat_lines: [{ rate: null, net: 50, vat: 0 }], fx_rate: 0.9, issues: [], file_path: 'me/c.jpg', file_type: 'image/jpeg', created_at: '2026-07-20T10:00:00Z', updated_at: '1' },
  { id: 'g', user_id: 'me', status: 'done', annual_only: true, store: 'Example Gym', description: 'Gym membership', category: 'Other', receipt_date: '2026-09-15', period: '2026-Q3', currency: 'EUR', total: 60.5, vat_country: 'NL', vat_lines: [{ rate: 21, net: 50, vat: 10.5 }], fx_rate: 1, issues: [], file_path: 'me/g.png', file_type: 'image/png', created_at: '2026-09-15T10:00:00Z', updated_at: '1' },
  { id: 'h', user_id: 'me', status: 'done', annual_only: true, store: 'Example Boutique Paris', description: 'Shoes for a shoot', category: 'Clothing', receipt_date: '2026-08-20', period: '2026-Q3', currency: 'EUR', total: 120, vat_country: 'FR', vat_lines: [{ rate: 20, net: 100, vat: 20 }], fx_rate: 1, issues: [], file_path: 'me/h.png', file_type: 'image/png', created_at: '2026-08-20T10:00:00Z', updated_at: '1' },
  { id: 'h', user_id: 'me', status: 'done', store: 'Example Studio', description: 'Studio rent', category: 'Rent', receipt_date: '2025-05-10', period: '2025-Q2', currency: 'EUR', total: 242, vat_country: 'NL', vat_lines: [{ rate: 21, net: 200, vat: 42 }], fx_rate: 1, issues: [], file_path: 'me/h.png', file_type: 'image/png', created_at: '2025-05-10T10:00:00Z', updated_at: '1' },
  { id: 'd', user_id: 'me', status: 'processing', store: null, description: null, receipt_date: null, currency: 'EUR', total: null, vat_country: 'NL', vat_lines: [], issues: [], file_path: 'me/d.jpg', file_type: 'image/jpeg', created_at: '2026-10-26T10:00:00Z', updated_at: '1' },
];
// Made-up statements with the same shape as real ones (one Dutch agency with VAT, one foreign agency with a reverse-charged fee).
const statementsData = [
  { id: 's1', user_id: 'me', status: 'done', agency: 'Example Models B.V.', agency_country: 'NL', agency_address: 'Voorbeeldstraat 1, 1000 AA Amsterdam',
    statement_no: 'PAY-000001', statement_date: '2026-07-01', booking_date: '2026-07-02', period: '2026-Q3', currency: 'EUR', fx_rate: 1, total_paid: 4840, issues: [], file_path: 'me/st-s1.pdf', file_type: 'application/pdf',
    lines: [{ job_date: '2026-06-10', client: 'Client A Ltd', description: 'Buy-out extension, campaign', invoice_no: 'INV-000001', kind: 'buyout', fee: 4000, vat_rate: 21, vat: 840, expenses: 0, deductions: [] }],
    created_at: '2026-07-02T10:00:00Z', updated_at: '1' },
  { id: 's2', user_id: 'me', status: 'done', agency: 'Alpine Models e.U.', agency_country: 'AT', agency_address: 'Beispielgasse 2, 6020 Innsbruck',
    statement_no: 'P-000002', statement_date: '2026-03-03', booking_date: '2026-03-04', period: '2026-Q1', currency: 'EUR', fx_rate: 1, total_paid: 750, issues: [], file_path: 'me/st-s2.png', file_type: 'image/png',
    lines: [{ job_date: '2025-10-22', client: 'Client B AG', description: 'Production, work day', invoice_no: '000002', kind: 'day_rate', fee: 1000, vat_rate: 0, vat: 0, expenses: 0,
      deductions: [{ type: 'agency_fee', label: 'Agency fee', amount: 250, vat: 0, reverse_charge: true }]}],
    created_at: '2026-03-04T10:00:00Z', updated_at: '1' },
];
export const sb = {
  auth: {
    getSession: async () => ({ data: { session: { user } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => {},
  },
};
export const initClient = async () => sb;
export const listReceipts = async () => rows;
export const watchReceipts = () => () => {};
export const listStatements = async () => statementsData;
let periodsData = [{ user_id: 'me', period: '2026-Q1', filed_at: '2026-04-20T10:00:00Z' }];
export const listPeriods = async () => periodsData;
export const filePeriod = async (period) => { periodsData = [...periodsData, { user_id: 'me', period, filed_at: new Date().toISOString() }]; };
export const createCorrection = async (table, rec) => ({ ...rec, id: rec.id + '-c', corrects: rec.id, status: 'review' });
export const saveStatement = async (x) => ({ ...x, updated_at: String(Date.now()) });
export const deleteStatement = async () => {};
export const saveReceipt = async (r) => { const s = { ...r, status: problems(r).length ? 'review' : 'done', updated_at: String(Date.now()) }; rows = rows.map((x) => (x.id === r.id ? s : x)); return s; };
export const deleteReceipt = async () => {};
export const readAgain = async (id) => rows.find((r) => r.id === id);
export const fileUrl = async () => '../icons/icon-512.png';
// PDFs: a made-up two-page statement, generated on the fly.
export const fileBlob = async (path = '') => {
  if (!path.endsWith('.pdf')) return (await fetch('/icons/icon-512.png')).blob();
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm');
  const doc = new jsPDF();
  doc.setFontSize(20); doc.text('Example Models Agency - statement PAY-000001', 15, 25);
  doc.setFontSize(12); doc.text('Job: Example shoot  ·  Fee EUR 4,000.00', 15, 40);
  doc.addPage(); doc.text('Page 2: deductions', 15, 25);
  return doc.output('blob');
};
export const ecbRate = async () => ({ rate: 0.9, date: '2026-07-20' });
// The real function (the ?real query avoids the import map that points /src/api.js here).
export { eurUsdRates } from '/src/api.js?real';
export const myShares = async () => [{ owner_id: 'me', viewer_email: 'cpa@example.com', owner_email: 'me@example.com' }];
export const addShare = async () => {};
export const removeShare = async () => {};
export const queued = async () => [];
export const unqueue = async () => {};
export const addFiles = async () => {};
export const flushOutbox = async () => {};
export const takeDropped = () => 0;
export const lastUploadError = '';
export const createManual = async (_u, extra = {}) => { const r = { ...extra, id: 'm' + Date.now(), user_id: 'me', status: 'review', doc_type: 'none', currency: 'EUR', vat_country: 'NL', vat_lines: [], issues: [], receipt_date: '2026-10-26', period: '2026-Q4', created_at: new Date().toISOString(), updated_at: '1' }; rows = [r, ...rows]; return r; };
export const attachFile = async (r) => r;
// Passkeys (made-up)
let passkeys = [{ id: 'pk1', friendly_name: 'iCloud Keychain', created_at: '2026-10-20T10:00:00Z', last_used_at: '2026-10-25T08:00:00Z' }];
export const passkeysSupported = () => true;
export const listPasskeys = async () => passkeys;
export const addPasskey = async () => { const p = { id: 'pk' + Date.now(), friendly_name: 'Chrome on Mac', created_at: new Date().toISOString() }; passkeys = [...passkeys, p]; return p; };
export const removePasskey = async (id) => { passkeys = passkeys.filter((p) => p.id !== id); };
export const signInWithPasskey = async () => true;
