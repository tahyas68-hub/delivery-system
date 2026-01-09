const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Get Manager User ID
    db.get("SELECT id FROM users WHERE username = 'manager'", (err, user) => {
        if (err) console.error(err);
        if (user) {
            console.log(`Manager User ID: ${user.id}`);
            
            // Get Rusafa Branch ID
            db.get("SELECT id FROM branches WHERE name LIKE '%الرصافة%'", (err, branch) => {
                 if (err) console.error(err);
                 if (branch) {
                     console.log(`Rusafa Branch ID: ${branch.id}`);
                     
                     // Update User
                     db.run("UPDATE users SET branch_id = ? WHERE id = ?", [branch.id, user.id], function(err) {
                         if (err) console.error(err);
                         else console.log(`Offsets: ${this.changes}. Linked manager to branch.`);
                     });
                 } else {
                     console.log("Rusafa branch not found.");
                 }
            });
        } else {
            console.log("Manager user not found.");
        }
    });
});
// Close in callback? No, verify async flow roughly ok for script.
// db.close(); // might close before async content
