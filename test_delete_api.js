// Native fetch used

// Order ID from the browser test (approximate, or I need to query it first to get UUID)
// ID is likely a UUID, not '10012'. "10012" is order_number.
// I need to find the UUID for order_number '10012'.

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db'); // Use correct DB
const db = new sqlite3.Database(dbPath);

const deleteOrder = async (orderNumber) => {
    db.get("SELECT id FROM orders WHERE order_number = ?", [orderNumber], async (err, row) => {
        if (err) {
             console.error("DB Error:", err);
             return;
        }
        if (!row) {
            console.error(`Order ${orderNumber} not found in DB`);
            // List all orders to help debugging
            db.all("SELECT order_number, status FROM orders", (e, r) => {
                console.log("Existing Orders:", r);
            });
            return;
        }

        const uuid = row.id;
        console.log(`Found Order ${orderNumber} with UUID: ${uuid}`);
        
        // Call API
        try {
            const response = await fetch(`http://localhost:3001/api/orders/${uuid}`, {
                method: 'DELETE'
            });
            const text = await response.text();
            console.log(`API Response (${response.status}):`, text);
        } catch (e) {
            console.error("Fetch Error:", e);
        }
    });
};

deleteOrder('10012');
