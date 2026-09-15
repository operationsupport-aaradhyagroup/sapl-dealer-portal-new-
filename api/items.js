import { getAccessToken, zohoApi } from './utils/zohoAuth.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const token = await getAccessToken();
        const api = await zohoApi(token);
        
        // A firm may optionally configure its own Zoho price list. Without one,
        // use the standard item rate from that firm's Zoho Books organisation.
        const pricebookId = process.env.ZOHO_PRICEBOOK_ID;
        const itemsRes = await api.get('/items');
        const pricebookRes = pricebookId ? await api.get(`/pricebooks/${pricebookId}`) : null;

        const allItems = itemsRes.data.items || [];
        const pricebookItems = pricebookRes?.data.pricebook?.pricebook_items || [];

        // 2. Pricebook rates ka map banana
        const customRates = {};
        pricebookItems.forEach(pbItem => {
            customRates[pbItem.item_id] = pbItem.pricebook_rate;
        });

        // 3. Items ke sath price list ke rates, SKU aur Name ko map karna
        const formattedItems = allItems
            .filter(item => item.status === 'active' && item.can_be_sold)
            .map(item => ({
                item_id: item.item_id,
                name: item.name,
                sku: item.sku || 'N/A',
                rate: customRates[item.item_id] !== undefined ? customRates[item.item_id] : (item.rate || 0)
            }));

        return res.status(200).json({ items: formattedItems });
    } catch (error) {
        console.error('Error fetching items catalog:', error.response?.data || error.message);
        return res.status(500).json({ 
            error: error.response?.data?.message || 'Failed to fetch items' 
        });
    }
}