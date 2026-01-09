const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Checking DB:", dbPath);

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='financial_transactions'", (err, rows) => {
        if (err) {
            console.error("Error checking table:", err);
        } else {
            if (rows.length > 0) {
                console.log("Table 'financial_transactions' EXISTS.");
                // Check content
                db.all("SELECT * FROM financial_transactions", (err, data) => {
                     console.log("Row count:", data.length);
                });
            } else {
                console.log("Table 'financial_transactions' DOES NOT EXIST.");
            }
        }
    });
});

db.close();
