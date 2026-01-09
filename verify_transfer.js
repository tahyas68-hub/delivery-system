const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const dbPath = path.join(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

const runTest = async () => {
    const orderId = uuidv4();
    console.log("1. Creating Test Order:", orderId);
    
    // Create Order in 'Returned' state in Branch 
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            const stmt = db.prepare(`INSERT INTO orders (id, order_number, status, branch_warehouse_id, main_warehouse_id) VALUES (?, 'TRANSFER-TEST-${Date.now()}', 'Returned', 'BRANCH-1', NULL)`);
            stmt.run(orderId, (err) => {
                 if(err) reject(err);
                 else resolve();
            });
            stmt.finalize();
        });
    });

    console.log("2. Simulating Transfer to Main Warehouse API Call");
    
    // Payload matches the button onClick in Warehouse.jsx
    const postData = JSON.stringify({
        status: 'Returned', 
        changed_by: 'Admin',
        notes: 'Transferred from Branch to Main Warehouse',
        main_warehouse_id: true,
        branch_warehouse_id: null
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
            db.get(`SELECT status, branch_warehouse_id, main_warehouse_id FROM orders WHERE id = ?`, [orderId], (err, order) => {
                if(err) console.error(err);
                console.log('Order State:', order);
                
                if(order.branch_warehouse_id === null && order.main_warehouse_id === 'true') {
                    console.log("SUCCESS: Order transferred to Main Warehouse correctly.");
                } else {
                    console.log("FAILURE: DB updates incorrect.");
                }
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
