const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

const COURIER_ID = '23a0b846-4789-4ae7-833c-325d0f603cd8'; // Tahseen

console.log(`Assigning orders to courier: ${COURIER_ID}`);

db.serialize(() => {
    db.run(`UPDATE orders SET delivery_courier_id = ? WHERE delivery_courier_id IS NULL`, [COURIER_ID], function(err) {
        if (err) {
            console.error(err);
            return;
        }
        console.log(`Updated ${this.changes} orders.`);
    });
    
    // Also verify
    db.all(`SELECT id, order_number, status, delivery_courier_id FROM orders LIMIT 5`, (err, rows) => {
        if(err) console.error(err);
        rows.forEach(r => console.log(JSON.stringify(r)));
    });
});
