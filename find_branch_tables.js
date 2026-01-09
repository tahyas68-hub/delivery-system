const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%branch%'", (err, rows) => {
    if (err) console.error(err);
    console.log("Branch tables:", rows);
});
