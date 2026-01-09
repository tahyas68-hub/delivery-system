const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Cleaning up placeholder users...");

db.serialize(() => {
    // Delete users whose name ends with ' User' and are not 'Admin User'
    db.run("DELETE FROM users WHERE name LIKE '% User' AND name != 'Admin User'", function(err) {
        if (err) {
            console.error("Error deleting placeholders:", err.message);
        } else {
            console.log(`Deleted ${this.changes} placeholder users.`);
        }
        db.close();
    });
});
