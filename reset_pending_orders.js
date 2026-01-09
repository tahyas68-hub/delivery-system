const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Resetting Pending orders to Main Warehouse (Unassigned)...");

db.serialize(() => {
    // Debug: Check total orders
    db.all("SELECT id, order_number, status FROM orders", (err, rows) => {
        if(err) console.error(err);
        console.log("Debug: All Orders Status:");
        if(rows) rows.forEach(r => console.log(`${r.order_number}: '${r.status}'`));
    });


    // 1. Identify orders to reset
    const targetStatuses = "'Pending', 'In Warehouse'";
    db.all(`SELECT id, order_number, status FROM orders WHERE status IN (${targetStatuses})`, (err, rows) => {
        if (err) {
            console.error("Error fetching orders to reset:", err);
            return;
        }
        
        console.log(`Found ${rows.length} orders to reset (Pending/In Warehouse).`);
        if(rows.length > 0) console.log(rows.map(r => `${r.order_number} (${r.status})`).join(', '));
        
        if (rows.length > 0) {
            // 2. Update them
            // Set status to 'In Warehouse' to be consistent? Or keep as is? 
            // User said "return... to Main Warehouse". 
            // Usually means status 'In Warehouse' and main_warehouse_id='MAIN'.
            // And unassign courier.
            
            const stmt = db.prepare(`UPDATE orders SET delivery_courier_id = NULL, main_warehouse_id = 'MAIN', branch_warehouse_id = NULL, status = 'In Warehouse' WHERE status IN (${targetStatuses})`);
            stmt.run(function(err) {
                if (err) console.error("Update failed:", err);
                console.log(`Successfully updated ${this.changes} orders.`);
            });
            stmt.finalize();
        }
    });
    
    // Verify results
    db.all("SELECT id, order_number, status, delivery_courier_id, main_warehouse_id FROM orders WHERE status = 'Pending' LIMIT 5", (err, rows) => {
        if(err) console.error(err);
        console.log("\nVerification Sample:");
        if(rows) rows.forEach(r => console.log(JSON.stringify(r)));
    });
});
