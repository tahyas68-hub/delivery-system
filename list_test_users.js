const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Listing all users...");

db.all("SELECT u.id, u.name, u.username, md.store_name FROM users u LEFT JOIN merchant_details md ON u.id = md.user_id", (err, rows) => {
    if (err) {
        console.error("Error:", err);
    } else {
        console.log(JSON.stringify(rows.filter(r => r.name && (r.name.includes('Test') || r.name.includes('API'))), null, 2));
    }
    db.close();
});
