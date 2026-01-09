const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

const tables = ['company_financials', 'expenses', 'branch_financials', 'branch_payments', 'fund_transactions'];

db.serialize(() => {
    tables.forEach(table => {
        db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`, (err, row) => {
            if (err) console.error(err);
            if (row) {
                console.log(`Table: ${table}`);
                console.log(row.sql);
                console.log('---');
            } else {
                console.log(`Table ${table} NOT FOUND`);
            }
        });
    });
});
