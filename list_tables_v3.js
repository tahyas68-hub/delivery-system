
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

console.log('Checking DB at:', dbPath);

db.serialize(() => {
  db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log("Tables:", tables.map(t => t.name));

    const tablesOfInterest = ['settlements', 'courier_accounts']; 
    
    tables.forEach(t => {
        if (tablesOfInterest.includes(t.name)) {
             db.all(`PRAGMA table_info(${t.name})`, (err, columns) => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log(`\n--- Schema for ${t.name} ---`);
                console.table(columns);
            });
        }
    });

  });
});
