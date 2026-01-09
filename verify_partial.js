const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const dbPath = path.join(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

const runTest = async () => {
    const orderId = uuidv4();
    const itemId = uuidv4();
    
    console.log("1. Creating Test Order:", orderId);
    
    const uniqueNum = 'TEST-' + Math.floor(Math.random() * 100000);
    // Create Order directly in DB
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            const stmt = db.prepare(`INSERT INTO orders (id, order_number, customer_name, status, amount, delivery_fee) VALUES (?, ?, 'Test User', 'With Courier', 1050, 50)`);
            stmt.run(orderId, uniqueNum, (err) => {
                 if(err) reject(err);
                 else {
                     const itemStmt = db.prepare(`INSERT INTO order_items (id, order_id, item_name, quantity, unit_price, total_price, returned_quantity) VALUES (?, ?, 'Widget', 10, 100, 1000, 0)`);
                     itemStmt.run(itemId, orderId, (err) => {
                         if(err) reject(err);
                         else resolve();
                     });
                     itemStmt.finalize();
                 }
            });
            stmt.finalize();
        });
    });

    console.log("2. Simulating Partial Delivery Request via API");
    
    const postData = JSON.stringify({
        status: 'Partial Delivery',
        paid_amount: 550, // kept 5 items * 100 + 50 delivery
        notes: 'Test Partial',
        items: [
            { id: itemId, returned_quantity: 5 }
        ]
    });

    const options = {
        hostname: 'localhost',
        port: 3001,
        path: `/api/orders/${orderId}/status`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': postData.length
        }
    };

    const req = http.request(options, (res) => {
        console.log(`STATUS: ${res.statusCode}`);
        res.setEncoding('utf8');
        res.on('data', (chunk) => { console.log(`BODY: ${chunk}`); });
        res.on('end', () => {
            console.log('3. Verifying DB State');
            db.get(`SELECT status, paid_amount FROM orders WHERE id = ?`, [orderId], (err, order) => {
                if(err) console.error(err);
                console.log('Order State:', order);
                
                db.get(`SELECT returned_quantity FROM order_items WHERE id = ?`, [itemId], (err, item) => {
                    console.log('Item State:', item);
                    if(order.status === 'Partial Delivery' && item.returned_quantity === 5) {
                        console.log("SUCCESS: Partial Delivery Logic Verified!");
                    } else {
                        console.log("FAILURE: DB state incorrect");
                    }
                });
            });
        });
    });

    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
    });

    req.write(postData);
    req.end();
};

runTest();
