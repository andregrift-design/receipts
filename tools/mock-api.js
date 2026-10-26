// Stand-in for src/api.js so the screens can be tried without an account (tools/ui-test.html).
import { problems } from '../src/vat.js';
const user = { id: 'me', email: 'me@example.com' };
let rows = [
  { id: 'a', user_id: 'me', status: 'done', store: 'Albert Heijn', description: 'Office lunch', category: 'Meals', receipt_date: '2026-09-03', currency: 'EUR', total: 31.3, vat_country: 'NL', vat_lines: [{ rate: 9, net: 20, vat: 1.8 }, { rate: 21, net: 7.85, vat: 1.65 }], fx_rate: 1, issues: [], file_path: 'me/a.png', file_type: 'image/png', created_at: '2026-09-03T10:00:00Z', updated_at: '1' },
  { id: 'b', user_id: 'me', status: 'review', store: 'Hotel Adlon', description: 'Hotel 1 night', category: 'Accommodation', receipt_date: '2026-08-12', currency: 'EUR', total: 119, vat_country: 'DE', vat_lines: [], fx_rate: 1, issues: ['VAT not shown on the receipt.'], file_path: 'me/b.jpg', file_type: 'image/jpeg', created_at: '2026-08-12T10:00:00Z', updated_at: '1' },
  { id: 'c', user_id: 'me', status: 'done', doc_type: 'payment', store: 'Yellow Cab', description: 'Taxi', category: 'Travel', receipt_date: '2026-07-20', currency: 'USD', total: 50, vat_country: 'US', vat_lines: [{ rate: null, net: 50, vat: 0 }], fx_rate: 0.9, issues: [], file_path: 'me/c.jpg', file_type: 'image/jpeg', created_at: '2026-07-20T10:00:00Z', updated_at: '1' },
  { id: 'd', user_id: 'me', status: 'processing', store: null, description: null, receipt_date: null, currency: 'EUR', total: null, vat_country: 'NL', vat_lines: [], issues: [], file_path: 'me/d.jpg', file_type: 'image/jpeg', created_at: '2026-10-26T10:00:00Z', updated_at: '1' },
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
export const saveReceipt = async (r) => { const s = { ...r, status: problems(r).length ? 'review' : 'done', updated_at: String(Date.now()) }; rows = rows.map((x) => (x.id === r.id ? s : x)); return s; };
export const deleteReceipt = async () => {};
export const readAgain = async (id) => rows.find((r) => r.id === id);
export const fileUrl = async () => '../icons/icon-512.png';
export const fileBlob = async () => (await fetch('/icons/icon-512.png')).blob();
export const ecbRate = async () => 0.9;
export const myShares = async () => [{ owner_id: 'me', viewer_email: 'cpa@example.com', owner_email: 'me@example.com' }];
export const addShare = async () => {};
export const removeShare = async () => {};
export const queued = async () => [];
export const addFiles = async () => {};
export const flushOutbox = async () => {};
export const createManual = async () => { const r = { id: 'm' + Date.now(), user_id: 'me', status: 'review', doc_type: 'none', currency: 'EUR', vat_country: 'NL', vat_lines: [], issues: [], receipt_date: '2026-10-26', created_at: new Date().toISOString(), updated_at: '1' }; rows = [r, ...rows]; return r; };
export const attachFile = async (r) => r;
