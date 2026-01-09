const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log('--- Testing Merchant Update Logic ---');

const testName = 'Test User ' + Date.now();
const testStore = 'Test Store ' + Date.now();

// 1. Get a Merchant ID
db.get("SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE name = 'Merchant') LIMIT 1", (err, user) => {
    if (err) { console.error(err); return; }
    if (!user) { console.error('No merchant found'); return; }

    const id = user.id;
    console.log('Testing with User ID:', id);

    // 2. Simulate User Table Update
    const userUpdateQuery = "UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.run(userUpdateQuery, [testName, id], function(err) {
        if (err) console.error('User Update Failed:', err);
        else console.log('User Name Updated to:', testName);

        // 3. Simulate Merchant Details Upsert
        const upsertQuery = `
                INSERT INTO merchant_details (user_id, store_name, address, payment_method) 
                VALUES (?, ?, ?, ?) 
                ON CONFLICT(user_id) 
                DO UPDATE SET store_name=excluded.store_name
            `;
        
        db.run(upsertQuery, [id, testStore, 'Test Address', 'Cash'], function(err) {
            if (err) console.error('Details Update Failed:', err);
            else console.log('Store Name Updated to:', testStore);

            // 4. Verify
            db.get(`SELECT u.name, md.store_name FROM users u 
                    LEFT JOIN merchant_details md ON u.id = md.user_id 
                    WHERE u.id = ?`, [id], (err, row) => {
                console.log('Final Result:', row);
            });
        });
    });
});
