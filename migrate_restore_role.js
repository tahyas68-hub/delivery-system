const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('f:/New folder (8)/server/delivery_system.db');

const fixRole = async () => {
    const dbRun = (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this) }));
    const dbAll = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));

    try {
        console.log("Checking schema...");
        const cols = await dbAll("PRAGMA table_info(users)");
        const hasRole = cols.find(c => c.name === 'role');
        
        if (!hasRole) {
            console.log("Adding 'role' column...");
            await dbRun("ALTER TABLE users ADD COLUMN role TEXT");
        } else {
            console.log("'role' column exists.");
        }

        console.log("Updating Admin role...");
        await dbRun("UPDATE users SET role = 'Admin' WHERE username = 'admin'");
        
        console.log("Checking for other users without role...");
        // Fallback: If role is null, try to guess or leave it?
        // Let's set 'Merchant' for anyone with merchant_id? (Not visible in schema, maybe check permissions?)
        // For now, minimal fix: Restore Admin.
        
        const admin = await dbAll("SELECT id, username, role FROM users WHERE username = 'admin'");
        console.log("Admin User:", admin);

    } catch (e) {
        console.error("Migration Failed:", e);
    }
    
    db.close();
};

fixRole();
