const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log("Checking users in:", dbPath);

db.serialize(() => {
    db.all("SELECT u.id, u.username, r.name as role_name, u.status FROM users u JOIN roles r ON u.role_id = r.id", [], (err, rows) => {
        if (err) {
            console.error("Error fetching users:", err);
            return;
        }
        console.table(rows);
        
        // Reset passwords for all default users
        const defaultUsers = ['admin', 'manager', 'accountant', 'dispatchexport', 'reception', 'merchant', 'operationssupervisor', 'deliverycourier', 'pickupcourier'];
        
        const updates = defaultUsers.map(username => {
            return new Promise((resolve) => {
                const user = rows.find(r => r.username === username);
                if (!user) {
                    console.log(`User '${username}' not found, skipping.`);
                    return resolve();
                }

                const newPass = username + '123'; // e.g. admin123, manager123
                bcrypt.hash(newPass, 10, (err, hash) => {
                    if(err) return resolve();
                    
                    // Also reactivate if suspended/deleted
                    const stmt = db.prepare("UPDATE users SET password_hash = ?, status = 'active' WHERE username = ?");
                    stmt.run([hash, username], function(err) {
                        if (!err) {
                            console.log(`[SUCCESS] Reset '${username}' password to '${newPass}' and set status to 'active'`);
                        }
                        resolve();
                    });
                    stmt.finalize();
                });
            });
        });

        Promise.all(updates).then(() => {
            console.log("All default users updated.");
        });
    });
});
