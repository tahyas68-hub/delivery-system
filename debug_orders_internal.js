const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'school.db');
const db = new sqlite3.Database(dbPath);

db.all(`
    SELECT id, order_number, status, branch_warehouse_id, delivery_courier_id, updated_at 
    FROM orders 
    ORDER BY updated_at DESC 
    LIMIT 10
`, [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("--- Recent Orders Debug ---");
    console.table(rows);
});

db.close();
