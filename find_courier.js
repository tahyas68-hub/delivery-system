const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Checking DB at:", dbPath);

db.get("SELECT u.username FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'Delivery Courier' LIMIT 1", (err, row) => {
    if (err) return console.error(err);
    if (!row) return console.error("No courier found");
    console.log("Found Courier:", row.username);
});
