import { getAccessToken, zohoApi } from './utils/zohoAuth.js';

const BALANCE_CONFIRMATION_MODULE = 'cm_balance_confirmation';
const LEDGER_FIELD = 'cf_cm_all_ledgers_details';

async function resolveContactId(api, customerIdentifier) {
    const value = String(customerIdentifier || '').trim();
    if (!value) return null;
    if (/^\d{15,}$/.test(value)) return value;

    const response = await api.get('/contacts', {
        params: { contact_number: value, per_page: 200 },
    });
    const contact = (response.data.contacts || []).find(
        (item) => String(item.contact_number) === value
    );
    return contact?.contact_id || null;
}

function latestLedgerRow(rows = []) {
    return rows
        .map((row, index) => ({ row, index }))
        .sort((first, second) => {
            const firstDate = `${first.row.cf_period_to || ''}|${first.row.cf_period_from || ''}`;
            const secondDate = `${second.row.cf_period_to || ''}|${second.row.cf_period_from || ''}`;
            return secondDate.localeCompare(firstDate) || second.index - first.index;
        })[0]?.row;
}

async function hasUploadedLatestBalanceConfirmation(api, customerId) {
    const response = await api.get(`/${BALANCE_CONFIRMATION_MODULE}`, { params: { per_page: 200 } });
    const records = await Promise.all((response.data.module_records || []).map(async (summary) => {
        const detail = await api.get(`/${BALANCE_CONFIRMATION_MODULE}/${summary.module_record_id}`);
        return detail.data.module_record_hash;
    }));
    const latest = records
        .filter((record) => String(record?.cf_customer) === String(customerId))
        .sort((first, second) => new Date(second.last_modified_time || 0) - new Date(first.last_modified_time || 0))[0];

    return Boolean(latest && latestLedgerRow(latest[LEDGER_FIELD])?.cf_ledger_upload);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const customerIdentifier = req.headers['x-customer-id'];
        if (!customerIdentifier) {
            return res.status(400).json({ error: 'Customer ID missing in headers.' });
        }

        const api = await zohoApi(await getAccessToken());
        const customerId = await resolveContactId(api, customerIdentifier);
        if (!customerId) {
            return res.status(404).json({ error: 'No Zoho Books customer matches this customer number.' });
        }

        const contactRes = await api.get(`/contacts/${customerId}`);
        const contact = contactRes.data.contact || {};
        if (!await hasUploadedLatestBalanceConfirmation(api, customerId)) {
            return res.status(403).json({
                error: 'Order blocked: upload the ledger for the latest Balance Confirmation before placing an order.'
            });
        }

        const { cartItems } = req.body;
        if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
            return res.status(400).json({ error: 'Cart items are missing or invalid.' });
        }

        const line_items = cartItems.map((item) => ({
            item_id: item.item_id,
            quantity: item.quantity,
            rate: item.rate,
        }));
        const response = await api.post('/salesorders', {
            customer_id: customerId,
            line_items,
            salesperson_name: contact.owner_name || 'Admin',
        });

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('Sales order request failed:', error.response?.data?.message || error.message);
        return res.status(500).json({ error: error.response?.data?.message || error.response?.data || error.message });
    }
}