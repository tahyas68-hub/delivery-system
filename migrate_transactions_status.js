const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("Adding status column to financial_transactions...");
    db.run("ALTER TABLE financial_transactions ADD COLUMN status TEXT DEFAULT 'Completed'", (err) => {
        if (err && err.message.includes('duplicate column')) {
            console.log("Column 'status' already exists.");
        } else if (err) {
            console.error("Error adding column:", err);
        } else {
            console.log("Column 'status' added.");
        }
    });
});

db.close();
