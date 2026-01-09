const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log("Running Fix for Orphaned Returned Orders...");

const run = async () => {
    db.all(`SELECT * FROM orders WHERE status = 'Returned' AND delivery_courier_id IS NULL AND notes LIKE 'المتبقي من طلب #%'`, [], async (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }

        console.log(`Found ${rows.length} orphaned returned orders.`);

        for (const returnOrder of rows) {
            // Extract original order number from notes
            // Note format: "المتبقي من طلب #123"
            const match = returnOrder.notes.match(/#(\d+)/);
            if (match && match[1]) {
                const originOrderNum = match[1];
                
                // Find original order to get the courier
                db.get(`SELECT delivery_courier_id FROM orders WHERE order_number = ? AND id != ?`, [originOrderNum, returnOrder.id], (err, originOrder) => {
                    if (err) console.error(err);
                    else if (originOrder && originOrder.delivery_courier_id) {
                        // Update the returned order
                        db.run(`UPDATE orders SET delivery_courier_id = ? WHERE id = ?`, [originOrder.delivery_courier_id, returnOrder.id], (err) => {
                            if (err) console.error(`Failed to update order ${returnOrder.order_number}`);
                            else console.log(`Fixed Order #${returnOrder.order_number} -> Assigned to Courier ${originOrder.delivery_courier_id}`);
                        });
                    } else {
                        console.log(`Could not find original courier for Order #${returnOrder.order_number} (Origin #${originOrderNum})`);
                    }
                });
            }
        }
    });
};

run();
setTimeout(() => {
    console.log("Done (waiting for async ops capabilities...)");
}, 3000);
