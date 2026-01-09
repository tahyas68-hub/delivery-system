const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

db.all("SELECT id, order_number, status, notes, main_warehouse_id, branch_warehouse_id FROM orders", [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log(`Total orders: ${rows.length}`);
        rows.forEach(r => {
            console.log(`ID: ${r.id} | No: ${r.order_number} | Status: ${r.status} | Main: ${r.main_warehouse_id} | Branch: ${r.branch_warehouse_id} | Notes: ${r.notes}`);
        });
    }
    db.close();
});
