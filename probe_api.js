const fetch = require('node-fetch');

async function probe() {
    try {
        const endpoints = [
            'http://localhost:3001/api/orders',
            'http://localhost:3001/api/users',
            'http://localhost:3001/api/branches'
        ];
        for (const url of endpoints) {
            console.log(`Probing ${url}...`);
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                console.log(`Success! Count: ${Array.isArray(data) ? data.length : 'object'}`);
            } else {
                console.log(`Failed! Status: ${res.status}`);
            }
        }
    } catch (err) {
        console.error('Connection Error:', err.message);
    }
}

probe();
