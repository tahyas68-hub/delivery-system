const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // 1. Insert Role
    const roleId = uuidv4();
    const roleName = 'Branch Manager';
    
    db.run("INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)", [roleId, roleName], function(err) {
        if (err) console.error("Error inserting role:", err);
        else console.log(`Role '${roleName}' inserted or verified.`);
        
        // 2. Refresh Role Permissions (simplified, just verify presence)
        // In a real scenario we'd loop permissions, but for now just existence of role is key for UI.
    });

});
// db.close();
