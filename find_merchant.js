const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'school.db');
const db = new sqlite3.Database(dbPath);

db.all("SELECT u.username, u.password_hash FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'Merchant' LIMIT 1", (err, rows) => {
    if (err) {
        console.error("Error:", err);
    } else {
        console.log("Found Merchant:", rows);
    }
});
