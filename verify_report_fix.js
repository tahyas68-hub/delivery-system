const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('f:\\New folder (8)\\server\\delivery_system.db');

db.all("SELECT id, order_number, status, branch_warehouse_id, main_warehouse_id FROM orders WHERE status = 'Delivered' LIMIT 10", (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log("=== Delivered Orders Sample ===");
    console.table(rows);
    
    db.all("SELECT o.id, o.order_number, b.name as branch_name FROM orders o LEFT JOIN branches b ON o.branch_warehouse_id = b.id WHERE o.status = 'Delivered' LIMIT 10", (err, rowsWithJoin) => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        console.log("=== Delivered Orders with Branch Join ===");
        console.table(rowsWithJoin);
        db.close();
    });
});
