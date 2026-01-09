const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('f:/New folder (8)/server/delivery_system.db');

db.serialize(() => {
    // 1. Get Table Info
    db.all("PRAGMA table_info(users)", (err, rows) => {
        if (err) {
            console.error("Schema Error:", err);
            return;
        }
        console.log("Users Table Schema:", rows);
    });

    // 2. Try selecting * to see what we get
    db.all("SELECT * FROM users LIMIT 1", (err, rows) => {
         if (err) console.error("Select Error:", err);
         else console.log("Sample User:", rows);
    });
});

db.close();
