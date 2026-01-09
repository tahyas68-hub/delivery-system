const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('f:/New folder (8)/server/delivery_system.db');

db.serialize(() => {
    // Check for orders with amount having 50 suffix (e.g. 10050, 25050) AND delivery_fee = 5000 (after fix)
    // Wait, the amount is usually Goods + Fee.
    // If Goods = 10000, OLD Fee = 50 -> Amount = 10050.
    // Fixed Fee = 5000. Note: My previous fix updated delivery_fee but not amount.
    // So current state: Amount = 10050, Delivery_Fee = 5000.
    // Expected Amount: Goods(10000) + Fee(5000) = 15000.
    // Discrepancy: 15000 - 10050 = 4950.
    // So we need to ADD 4950 to amount for orders that were fixed?
    
    // How to identify them?
    // Amount ends in 50 (modulo 100 == 50?)
    // AND Delivery Fee is 5000?
    // Let's filter by amounts like %50.
    
    db.all("SELECT id, order_number, amount, delivery_fee FROM orders WHERE amount LIKE '%50' OR amount LIKE '%50.%'", (err, rows) => {
        if (err) { console.error(err); return; }
        
        console.log("Potential candidates (Ends in 50):");
        const candidates = rows.filter(r => (r.amount - 50) % 100 === 0 || (r.amount - 50) % 1000 === 0); // Loosely check
        
        candidates.forEach(r => {
            console.log(`Order ${r.order_number}: Amount=${r.amount}, Fee=${r.delivery_fee}`);
        });

        if (candidates.length > 0) {
             console.log("Fixing candidates...");
             candidates.forEach(r => {
                 // Calculate fix
                 // Logic: User wants fee to be 5000.
                 // Current Amount = Goods + 50.
                 // New Amount should be Goods + 5000.
                 // New Amount = (Amount - 50) + 5000 = Amount + 4950.
                 const newAmount = r.amount + 4950;
                 console.log(`Updating ${r.order_number}: ${r.amount} -> ${newAmount}`);
                 
                 db.run("UPDATE orders SET amount = ? WHERE id = ?", [newAmount, r.id]);
                 
                 // Also Update Courier Accounts if exists
                 // courier_accounts has 'order_amount'
                 db.run("UPDATE courier_accounts SET order_amount = ? WHERE order_id = ?", [newAmount, r.id]);
             });
        }
    });
});
