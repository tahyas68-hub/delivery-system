const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const createFinancialTransactionsTable = `
CREATE TABLE IF NOT EXISTS financial_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT,
    amount REAL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    order_id TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
)
`;

db.serialize(() => {
    console.log("Migrating Database...");
    
    db.run(createFinancialTransactionsTable, (err) => {
        if (err) {
            console.error("Error creating financial_transactions table:", err);
        } else {
            console.log("financial_transactions table created or already exists.");
        }
    });

});

db.close();
