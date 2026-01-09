const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'delivery_system.db');
const db = new sqlite3.Database(dbPath);

const mapping = {
    'Baghdad': 'بغداد',
    'Basra': 'البصرة',
    'Nineveh': 'نينوى',
    'Erbil': 'أربيل',
    'Najaf': 'النجف',
    'Karbala': 'كربلاء',
    'Babylon': 'بابل',
    'Kirkuk': 'كركوك',
    'Anbar': 'الأنبار',
    'Diyala': 'ديالى',
    'Maysan': 'ميسان',
    'Muthanna': 'المثنى',
    'Qadisiyah': 'القادسية',
    'Salah al-Din': 'صلاح الدين',
    'Wasit': 'واسط',
    'Dhi Qar': 'ذي قار',
    'Sulaymaniyah': 'السليمانية',
    'Duhok': 'دهوك'
};

db.serialize(() => {
    // 1. Update existing names based on mapping
    Object.keys(mapping).forEach(enName => {
        const arName = mapping[enName];
        db.run("UPDATE locations SET name = ? WHERE name = ?", [arName, enName], function(err) {
            if (err) console.error(`Error updating ${enName}:`, err);
            else if (this.changes > 0) console.log(`Updated ${enName} to ${arName}`);
        });
    });

    // 2. Clean up duplicates (e.g., if "Baghdad" and "بغداد" both exist)
    // We'll keep one per name.
    db.all("SELECT name, COUNT(*) as count FROM locations GROUP BY name HAVING count > 1", (err, duplicates) => {
        if (err) return console.error(err);
        duplicates.forEach(dup => {
            console.log(`Cleaning up duplicates for: ${dup.name}`);
            // Keep the one with the smallest rowid (or any ID)
            db.run("DELETE FROM locations WHERE name = ? AND id NOT IN (SELECT id FROM locations WHERE name = ? LIMIT 1)", [dup.name, dup.name]);
        });
    });
});

// Close database after a delay to ensure all async operations finish
setTimeout(() => {
    db.close();
    console.log("Migration finished.");
}, 2000);
