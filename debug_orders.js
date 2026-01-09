const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("Checking Partial Delivery orders...");
    db.all("SELECT id, order_number, status, delivery_courier_id, paid_amount, amount FROM orders WHERE status LIKE '%Partial%' OR order_number LIKE '%p'", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(JSON.stringify(rows, null, 2));
    });
});

db.close();
