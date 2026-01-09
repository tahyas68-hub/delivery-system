const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('f:/New folder (8)/server/delivery_system.db');

db.serialize(() => {
    // 1. Check for bad data
    db.all("SELECT id, order_number, delivery_fee FROM orders WHERE delivery_fee = 50", (err, rows) => {
        if(rows && rows.length > 0) {
            console.log("Found bad orders:", rows);
            
            // 2. Fix Orders
            db.run("UPDATE orders SET delivery_fee = 5000 WHERE delivery_fee = 50", function(err) {
                 if(err) console.error(err);
                 else console.log(`Updated ${this.changes} orders.`);
            });
            
            // 3. Fix Courier Accounts (if they copy the fee)
            // Note: courier_accounts might not store delivery_fee directly in all versions, but `Finance.jsx` uses it.
            // Wait, checking schema in database.js: `courier_accounts` doesn't have `delivery_fee` column explicitly shown in schema line 320, 
            // BUT index.js query JOINs orders. 
            // Let's check `courier_accounts` table itself for safety? 
            // The schema line 320 says: `order_amount`, `collected_amount`, `commission_rate` etc.
            // It does NOT have delivery_fee. The Finance.jsx fetches it via JOIN.
            // Meaning fixing `orders` table is sufficient!
            
        } else {
            console.log("No orders with delivery_fee = 50 found.");
        }
    });
});
