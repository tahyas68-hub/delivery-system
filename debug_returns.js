const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("--- Checking order_items Schema ---");
    db.all("PRAGMA table_info(order_items)", (err, rows) => {
        if(err) console.error(err);
        else console.log(rows);
        
        console.log("\n--- Checking Orders with Return Status ---");
        db.all("SELECT id, order_number, status FROM orders WHERE status IN ('Partial Delivery', 'Returned')", (err, orders) => {
             if(err) console.error(err);
             else {
                 console.log(`Found ${orders.length} orders.`);
                 console.log(orders);

                 if(orders.length > 0) {
                     const ids = orders.map(o => `'${o.id}'`).join(',');
                     console.log("\n--- Checking Items for these orders ---");
                     db.all(`SELECT * FROM order_items WHERE order_id IN (${ids})`, (err, items) => {
                         if(err) console.error(err);
                         else console.log(items);
                     });
                 }
             }
        });
    });
});
