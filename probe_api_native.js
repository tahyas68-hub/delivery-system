const http = require('http');

const endpoints = [
    '/api/orders',
    '/api/users',
    '/api/branches'
];

async function probe() {
    for (const path of endpoints) {
        console.log(`Probing http://localhost:3001${path}...`);
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        console.log(`SUCCESS! Count: ${Array.isArray(json) ? json.length : 'object'}`);
                    } catch (e) {
                        console.log(`SUCCESS but invalid JSON: ${data.substring(0, 50)}...`);
                    }
                } else {
                    console.log(`FAILED! Status: ${res.statusCode}`);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`ERROR: ${e.message}`);
        });
        req.end();
        await new Promise(r => setTimeout(r, 500));
    }
}

probe();
