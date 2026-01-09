const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("SELECT id, username, role_id, branch_id FROM users", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log("Users:", JSON.stringify(rows, null, 2));
    });
    
    db.all("SELECT * FROM roles", (err, rows) => {
         console.log("Roles:", JSON.stringify(rows, null, 2));
    });
});

db.close();
