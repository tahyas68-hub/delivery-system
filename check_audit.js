const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('f:/New folder (8)/server/delivery_system.db');

console.log("Checking audit_logs count...");
db.get('SELECT count(*) as count FROM audit_logs', [], (err, row) => {
    if (err) {
        console.error(err);
    } else {
        console.log(`Tuple count: ${row.count}`);
    }
    
    console.log("Checking recent logs...");
    db.all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 3', [], (err, rows) => {
         if(err) console.error(err);
         else console.log(rows);
         db.close();
    });
});
