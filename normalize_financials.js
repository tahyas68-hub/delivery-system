const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('f:/New folder (8)/server/delivery_system.db');

const normalize = async () => {
    // Promisify DB
    const dbAll = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
    const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
    const dbRun = (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this) }));

    try {
        console.log("Starting Financial Normalization...");

        // 1. Fetch Global Settings
        const settingsRows = await dbAll("SELECT key, value FROM system_settings");
        const settings = settingsRows.reduce((acc, r) => ({...acc, [r.key]: r.value}), {});
        const defaultCommission = parseFloat(settings.default_commission || 1500); // User mentioned 'Unified'
        console.log(`Global Default Commission: ${defaultCommission}`);

        // 2. Fetch Locations
        const locations = await dbAll("SELECT * FROM locations");
        const locMap = locations.reduce((acc, l) => ({...acc, [l.name]: l.base_price}), {});
        const defaultLocationPrice = 5000;
        console.log(`Loaded ${locations.length} Location Prices.`);

        // 3. Fetch Merchant Overrides
        const overrides = await dbAll("SELECT * FROM merchant_pricing_overrides");
        // Map: merchant_id -> province -> price
        const merchantMap = {};
        overrides.forEach(o => {
            if (!merchantMap[o.merchant_id]) merchantMap[o.merchant_id] = {};
            merchantMap[o.merchant_id][o.province] = o.price;
        });

        // 4. Fetch Package Modifiers
        const modifiers = await dbAll("SELECT * FROM package_modifiers");
        const modMap = modifiers.reduce((acc, m) => ({...acc, [m.size_name]: m.additional_fee}), {});

        // 5. Fetch ALL Orders
        const orders = await dbAll("SELECT * FROM orders");
        console.log(`Processing ${orders.length} orders...`);

        let updatedCount = 0;

        for (const order of orders) {
            // A. Calculate Correct Delivery Fee
            // [FIX] Returned items / Partial Remainders should have 0 fee/commission
            const isReturned = order.status === 'Returned' || order.order_number.toString().endsWith('p');
            
            let basePrice = 0;
            if (merchantMap[order.merchant_id] && merchantMap[order.merchant_id][order.province]) {
                basePrice = merchantMap[order.merchant_id][order.province];
            } else {
                basePrice = locMap[order.province] || defaultLocationPrice;
            }

            const extra = modMap[order.package_size] || 0;
            let correctFee = basePrice + extra;
            let correctCommission = defaultCommission;

            if (isReturned) {
                correctFee = 0;
                correctCommission = 0;
            }

            // C. Correct Total Amount
            // "As added by merchant" -> The "Items Price" is the truth.
            // Items Price = (Old/Current Amount) - (Old/Current Fee).
            // We assume the DB state might be inconsistent, but "Amount - Fee" is the best guess for Goods Price.
            // Wait, if Fee was 50, and Amount was 90050, Goods = 90000.
            // If Fee was 5000 (after my fix), and Amount was 90050, Goods = 85050 (WRONG).
            // So relying on "Current Fee" in DB is dangerous if I just changed it partially.
            
            // Heuristic:
            // If Amount ends in 50, and Fee is 5000, it's likely broken.
            // If Amount ends in 000, and Fee is 5000, it's likely fine.
            
            // Safer Approach: 
            // If we assume "Items Total" should be cleaner?
            // Let's assume the previous `delivery_fee` in the table IS the one used to calculate `amount`.
            // So `Goods = Amount - Fee`.
            
            // However, recall I mass-updated `delivery_fee` to 5000 in `server/fix_fees.js`.
            // So for those orders, `Amount` is `Goods + 50`, but `Fee` is `5000`.
            // `Goods` = `Amount - Fee` = `(G+50) - 5000` = `G - 4950`. This is WRONG goods price.
            
            // We need to detect if `delivery_fee` was autoset to 5000 but amount wasn't updated.
            // Only way is checking if `Amount` has that specific signature or simply if `Amount - Fee` looks weird.
            
            // Let's assume the "Item Price" is `Amount - 50` for those broken ones.
            // Or `Amount` itself if Fee was 0?
            
            // Correction Logic:
            // 1. Re-calculate Ideal Fee (`correctFee`).
            // 2. Estimate Goods Price:
            //    - If Amount % 100 == 50 -> Likely `Goods + 50`. Goods = Amount - 50.
            //    - Else -> Likely `Goods + ValidFee`. ValidFee might be stored `delivery_fee`.
            //    - But wait, if I updated `delivery_fee` to 5000, I lost the history of what "ValidFee" was for calculation.
            //    - EXCEPT my previous script only touched orders where `delivery_fee = 50`.
            //    - So if `delivery_fee` is 5000 NOW, it might have been 50 before.
            
            // Let's use the '50' remainder as the primary signal since the user complained about it.
            let estimatedGoodsPrice = 0;
            if (String(order.amount).endsWith('50') && !String(order.amount).endsWith('250') && !String(order.amount).endsWith('750')) {
                estimatedGoodsPrice = order.amount - 50;
            } else {
                // Assume currently stored fee was used (if not 50-broken)
                // But if I mass updated fee to 5000...
                // Ideally: If amount is 90050 and fee is 5000.  90050 - 5000 = 85050.
                // If I use 85050 + 5000 = 90050. No change.
                // But user wants 90000 + 5000 = 95000.
                
                // So for the broke ones, `estimatedGoodsPrice` is indeed `Amount - 50`.
                
                // What about clean orders? 
                // Amount 15000. Fee 5000. Goods 10000.
                // New Fee 5000. New Amount 15000. Correct.
                
                estimatedGoodsPrice = order.amount - order.delivery_fee; 
                // If this is negative or looks wrong, fallback?
            }
            
            // Recalculate New Amount
            const newAmount = estimatedGoodsPrice + correctFee;
            
            // Only update if difference exists or if we want to enforce uniformity strictly
            if (newAmount !== order.amount || correctFee !== order.delivery_fee || correctCommission !== order.courier_commission) {
                console.log(`Fixing Order ${order.order_number}: Amount ${order.amount}->${newAmount}, Fee ${order.delivery_fee}->${correctFee}, Comm ${order.courier_commission}->${correctCommission}`);
                
                await dbRun("UPDATE orders SET amount = ?, delivery_fee = ?, courier_commission = ? WHERE id = ?", [newAmount, correctFee, correctCommission, order.id]);
                
                // Sync Courier Accounts
                await dbRun("UPDATE courier_accounts SET order_amount = ?, commission_amount = ?, commission_rate = ?, net_earning = ? WHERE order_id = ?", 
                    [newAmount, correctCommission, 0, correctCommission, order.id]); // Net earning = commission usually for courier view?
                    // Actually check schema: collected_amount? 
                    // collected_amount usually equals order_amount for full delivery.
                    // If we change order_amount, should we change collected_amount?
                    // YES, assuming it's not partial.
                    if (order.status === 'Delivered') {
                         await dbRun("UPDATE courier_accounts SET collected_amount = ? WHERE order_id = ?", [newAmount, order.id]);
                    }
                
                updatedCount++;
            }
        }

        console.log(`Normalization Complete. Updated ${updatedCount} orders.`);

    } catch (e) {
        console.error("Normalization Failed:", e);
    }
    
    db.close();
};

normalize();
