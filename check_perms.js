const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Checking DB at:", dbPath);

db.serialize(() => {
    // 1. Get Merchant Role ID
    db.get("SELECT id FROM roles WHERE name = 'Merchant'", (err, role) => {
        if (err) return console.error(err);
        if (!role) return console.error("Merchant role not found");
        console.log("Merchant Role ID:", role.id);

        // 2. Check Permissions for this Role
        const query = `
            SELECT p.code 
            FROM role_permissions rp 
            JOIN permissions p ON rp.permission_code = p.code 
            WHERE rp.role_id = ?
        `;
        db.all(query, [role.id], (err, perms) => {
            if (err) return console.error(err);
            console.log("Merchant Permissions:", perms.map(p => p.code));
            
            if (perms.some(p => p.code === 'orders.delete.submit')) {
                console.log("SUCCESS: Merchant HAS 'orders.delete.submit' permission.");
            } else {
                console.log("FAILURE: Merchant DOES NOT HAVE 'orders.delete.submit' permission.");
            }
        });
    });
});
