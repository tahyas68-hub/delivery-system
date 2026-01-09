const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Starting forceful cleanup...");

db.serialize(() => {
    // 1. Get IDs of users to delete
    const query = `
        SELECT id, name FROM users 
        WHERE username IN ('merchant', 'merchant_test', 'courier_test')
           OR name LIKE '%API Test%'
           OR name = 'Test Merchant'
    `;
    db.all(query, (err, rows) => {
        if (err) {
            console.error("Error fetching users:", err);
            return;
        }

        if (rows.length === 0) {
            console.log("No placeholder users found.");
            return;
        }

        console.log(`Found ${rows.length} users to delete:`, rows.map(r => r.name));
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');

        // 2. Delete from merchant_details
        db.run(`DELETE FROM merchant_details WHERE user_id IN (${placeholders})`, ids, function(err) {
            if (err) console.error("Error deleting from merchant_details:", err);
            else console.log(`Deleted ${this.changes} rows from merchant_details`);

            // 3. Delete from courier_details
            db.run(`DELETE FROM courier_details WHERE user_id IN (${placeholders})`, ids, function(err) {
                if (err) console.error("Error deleting from courier_details:", err);
                else console.log(`Deleted ${this.changes} rows from courier_details`);
                
                // 4. Delete from users
                db.run(`DELETE FROM users WHERE id IN (${placeholders})`, ids, function(err) {
                    if (err) console.error("Error deleting from users:", err);
                    else console.log(`Deleted ${this.changes} rows from users`);
                    
                    db.close();
                });
            });
        });
    });
});
