const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("Checking Financial Transactions...");
    db.all("SELECT * FROM financial_transactions", (err, rows) => {
        if (err) {
            console.error("Error fetching transactions:", err);
        } else {
            console.log(`Found ${rows.length} transactions.`);
            console.log(JSON.stringify(rows, null, 2));
        }
    });
});

db.close();
