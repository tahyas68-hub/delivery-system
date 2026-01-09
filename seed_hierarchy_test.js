const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

const { v4: uuidv4 } = require('uuid');

db.serialize(() => {
    const subId = uuidv4();
    const branchId = uuidv4();

    console.log("Seeding Sub-Warehouse:", subId);
    
    // Create Sub-Warehouse
    db.run(`INSERT INTO branches (id, name, location, type) VALUES (?, ?, ?, ?)`, 
        [subId, 'مخزن الرصافة الفرعي', 'Baghdad - Rusafa', 'sub_warehouse'], 
        (err) => {
            if (err) console.error("Error creating sub-warehouse:", err);
            else console.log("Sub-Warehouse created.");
        }
    );

    // Create Child Branch
    db.run(`INSERT INTO branches (id, name, location, type, parent_id) VALUES (?, ?, ?, ?, ?)`, 
        [branchId, 'فرع الكرادة', 'Karrada', 'branch', subId], 
        (err) => {
            if (err) console.error("Error creating child branch:", err);
            else console.log("Child Branch created linked to Sub-Warehouse.");
        }
    );
});
