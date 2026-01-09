const http = require('http');

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    try {
        console.log("1. Creating Order...");
        const createRes = await request('POST', '/api/orders', {
            order_number: 'TEST-PARTIAL-' + Date.now(),
            customer_name: 'Test Customer',
            customer_phone: '07700000000',
            amount: 50000,
            delivery_fee: 5000,
            merchant_id: 'test_merchant',
            status: 'Pending',
            delivery_address: 'Baghdad',
            province: 'Baghdad',
            package_type: 'Box'
            // items
        });
        
        if (createRes.status !== 200 && createRes.status !== 201) {
            console.error("Failed to create order:", createRes.body);
            return;
        }

        const orderId = createRes.body.id || createRes.body.orderId; // Adjust based on actual response
        console.log("Order Created:", orderId);

        console.log("2. Updating to Partial Delivery...");
        const updateRes = await request('POST', `/api/orders/${orderId}/status`, {
            status: 'Partial Delivery',
            paid_amount: 10000, // Collected part
            changed_by: 'test_courier',
            delivery_courier_id: 'test_courier',  // Explicitly set courier
            notes: 'Testing Partial Delivery flow'
        });

        if (updateRes.status !== 200) {
            console.error("Failed to update status:", updateRes.body);
            return;
        }
        console.log("Update Response:", updateRes.body);

        console.log("3. Fetching Order to Verify...");
        const checkRes = await request('GET', `/api/orders?delivery_courier_id=test_courier`); // Filter to ensure we find it
        // Or check all manually
        const allRes = await request('GET', '/api/orders');
        
        if (Array.isArray(allRes.body)) {
            const found = allRes.body.find(o => o.id === orderId);
            if (found) {
                console.log("Found Order Status:", found.status);
                console.log("Found Order Amount:", found.amount);
            } else {
                console.error("Order NOT FOUND in list!");
            }
            
            // Search for child order
            const child = allRes.body.find(o => o.order_number === createRes.body.order_number + 'p'); // Assuming response has order_number
            if(child) {
                 console.log("Found Child Order:", child.order_number, child.status);
            } else {
                 console.log("Child order not found (maybe naming convention different?)");
            }

        } else {
            console.error("Failed to list orders");
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

run();
