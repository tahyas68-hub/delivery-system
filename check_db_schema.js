const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
console.log('Opening DB at:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to the database.');
});

db.serialize(() => {
    console.log('\n--- Checking USERS Table Schema ---');
    console.log('\n--- Checking Permissions Table ---');
    db.all("SELECT * FROM permissions LIMIT 5", (err, rows) => {
        if (err) console.error(err);
        else {
            console.log(`Total Permissions: ${rows.length} (showing first 5)`);
            console.table(rows);
        }
    });

    console.log('\n--- Checking Role Permissions ---');
    db.all("SELECT * FROM role_permissions LIMIT 5", (err, rows) => {
        if (err) console.error(err);
        else console.table(rows);
    });

    console.log('\n--- Checking Existing Users ---');
    db.all("SELECT id, name, username, role_id, status FROM users LIMIT 5", (err, rows) => {
        if (err) console.error(err);
        else console.table(rows);
    });

    console.log('\n--- Checking Roles ---');
    db.all("SELECT * FROM roles", (err, rows) => {
        if (err) console.error(err);
        else console.table(rows);
    });
});

db.close();
