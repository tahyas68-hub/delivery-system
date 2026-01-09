const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Add 'type' column (sub_warehouse, branch)
    db.run("ALTER TABLE branches ADD COLUMN type TEXT DEFAULT 'branch'", (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error("Error adding type column:", err);
        } else {
            console.log("Added 'type' column.");
        }
    });

    // Add 'parent_id' column
    db.run("ALTER TABLE branches ADD COLUMN parent_id TEXT", (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error("Error adding parent_id column:", err);
        } else {
            console.log("Added 'parent_id' column.");
        }
    });

    // Optional: Seed a "Sub-Warehouse" if none exist, for testing UI?
    // Let's not auto-seed to avoid messing up existing data, 
    // but maybe update one existing branch to be a sub-warehouse if specific names exist.
});
