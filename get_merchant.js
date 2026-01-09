const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'delivery_system.db'));

db.get("SELECT user_id FROM merchant_details LIMIT 1", [], (err, row) => {
    if (err) console.error(err);
    else console.log("Merchant ID:", row ? row.user_id : "None");
});
