const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./delivery_system.db');

db.all("SELECT id, order_number, status, amount, delivery_fee FROM orders", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Total Orders:", rows.length);
    console.log("Status Counts:");
    const counts = {};
    rows.forEach(r => {
        counts[r.status] = (counts[r.status] || 0) + 1;
    });
    console.log(counts);

    const partials = rows.filter(r => r.status === 'Partial Delivery');
    if (partials.length > 0) {
        console.log("\nPartial Delivery Orders:");
        console.log(partials);
    } else {
        console.log("\nNo 'Partial Delivery' orders found.");
    }
});
