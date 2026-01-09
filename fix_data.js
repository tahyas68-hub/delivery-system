const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

db.run('UPDATE orders SET status = \'In Warehouse\' WHERE id = \'073db013-f155-4246-b0e9-ea532c21c23d\' OR status IS NULL OR status = \'\' OR status = \'null\'', [], (err) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Successfully updated rogue statuses to [In Warehouse]');
    }
    db.close();
});
