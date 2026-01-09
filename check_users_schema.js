const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'school.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run("PRAGMA table_info(users)", function(err) {
        if (err) {
            console.error("Error getting table info", err);
            return;
        }
    });
    
    db.all("PRAGMA table_info(users)", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log("Users Table Schema:", JSON.stringify(rows, null, 2));
    });
});

db.close();
