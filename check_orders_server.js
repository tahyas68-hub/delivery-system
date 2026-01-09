const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Checking DB at:", dbPath);

db.serialize(() => {
    // Check table info to see columns
    db.all("PRAGMA table_info(orders)", (err, columns) => {
        if (err) {
            console.error("PRAGMA error:", err);
            return;
        }
        console.log("Columns in orders table:");
        if (columns) {
            columns.forEach(col => console.log(col.name));
        } else {
            console.log("No columns found or table does not exist.");
        }

        // Check first 5 orders
        db.all("SELECT id, order_number, shipment_number FROM orders ORDER BY id DESC LIMIT 5", (err, rows) => {
             if (err) {
                console.error("SELECT error:", err);
                 if (err.message.includes('no such column: shipment_number')) {
                     console.log("CONFIRMED: shipment_number column is missing!");
                 }
                return;
            }
            console.log("\nRecent 5 orders:");
            console.log(rows);
        });
    });
});
