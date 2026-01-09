const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Since we are in server/ directory, DB is in same dir
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log(`Opening DB at: ${dbPath}`);

db.serialize(() => {
    console.log("--- Couriers ---");
    db.all(`SELECT id, name, username, role_id FROM users WHERE role_id IN (SELECT id FROM roles WHERE name LIKE '%Courier%')`, (err, rows) => {
        if (err) {
            console.error("Error fetching couriers:", err);
            return;
        }
        console.log(`Found ${rows.length} couriers:`);
        rows.forEach(r => console.log(JSON.stringify(r)));

        if (rows.length > 0) {
            let processed = 0;
            rows.forEach(courier => {
                db.all(`SELECT id, order_number, status, delivery_courier_id FROM orders WHERE delivery_courier_id = ?`, [courier.id], (err, orders) => {
                    if (err) console.error(err);
                    console.log(`\n--- Orders for ${courier.name} (${courier.username}) ---`);
                    console.log(`Found ${orders.length} orders.`);
                    if(orders.length > 0) {
                        orders.forEach(o => console.log(` - Order ${o.order_number}: ${o.status}`));
                    }
                    processed++;
                    
                    if (processed === rows.length) {
                        checkAllOrders();
                    }
                });
            });
        } else {
             console.log("No couriers found.");
             checkAllOrders();
        }
    });
});

function checkAllOrders() {
    console.log("\n--- Any Orders in System? ---");
    db.all("SELECT id, order_number, status, delivery_courier_id FROM orders LIMIT 10", (err, rows) => {
        if(err) console.error(err);
        console.log(`Sample of ${rows ? rows.length : 0} orders:`);
        if(rows) rows.forEach(r => console.log(JSON.stringify(r)));
    });
}
