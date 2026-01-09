const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'delivery_system.db'));

db.all("SELECT * FROM locations", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Locations:", rows);
});

db.all("SELECT * FROM merchant_pricing_overrides", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Overrides:", rows);
});
