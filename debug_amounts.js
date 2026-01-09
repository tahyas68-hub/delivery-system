const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('f:/New folder (8)/server/delivery_system.db');

db.serialize(() => {
    // Just dump all orders created recently to see what is going on
    db.all("SELECT id, order_number, amount, delivery_fee FROM orders LIMIT 50", (err, rows) => {
        if (err) { console.error(err); return; }
        console.log("Dumping Orders to debug:");
        rows.forEach(r => {
            console.log(`Order ${r.order_number}: Amount=${r.amount}, Fee=${r.delivery_fee}`);
        });

        // Specific fix for any amount ending in 50
        const bad = rows.filter(r => String(r.amount).endsWith('50') && !String(r.amount).endsWith('250') && !String(r.amount).endsWith('750')); // 50 but not 250/750 (quarters)
        
        if (bad.length > 0) {
            console.log("FOUND BAD ORDERS:", bad);
            bad.forEach(b => {
                 // Fix: Add 4950
                 const newAmount = b.amount + 4950;
                 console.log(`Fixing ${b.order_number}: ${b.amount} -> ${newAmount}`);
                 db.run("UPDATE orders SET amount = ? WHERE id = ?", [newAmount, b.id]);
                 db.run("UPDATE courier_accounts SET order_amount = ? WHERE order_id = ?", [newAmount, b.id]);
            });
        }
    });
});
