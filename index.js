const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

let database = require('./database');
let { db, initDatabase, dbPath, reconnectDatabase } = database;
const bcrypt = require('bcryptjs');

// Initialize DB
// Initialize DB
initDatabase();

// Helper: Audit Logger
const logAudit = (actorId, action, targetType, targetId, details) => {
    const { v4: uuidv4 } = require('uuid');
    const stmt = db.prepare("INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(uuidv4(), actorId, action, targetType, targetId, JSON.stringify(details || {}));
    stmt.finalize();
};

// --- Auth Routes ---

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get(`SELECT u.*, r.name as role_name FROM users u 
          LEFT JOIN roles r ON u.role_id = r.id 
          WHERE u.username = ?`, [username], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    // Get Permissions
    db.all(`SELECT permission_code FROM role_permissions WHERE role_id = ?`, [user.role_id], (err, rows) => {
      const permissions = rows.map(r => r.permission_code);
      res.json({
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role_name,
          roleId: user.role_id,
          branch_id: user.branch_id
        },
        permissions
      });
    });
  });
});

// --- RBAC Middleware ---
const requirePermission = (permissionCode) => {
    return (req, res, next) => {
        // In a real app, verify token and extract user permissions
        // For this demo, we assume the client sends a "x-role-id" or similar, 
        // OR we check the DB session. 
        // SIMPLIFICATION: We will pass. Real auth requires JWT.
        next(); 
    };
};

// --- Management Routes ---

// (Admin routes moved to User Management section below)

// Get Role Permissions
app.get('/api/roles/:roleId/permissions', (req, res) => {
    db.all(`SELECT permission_code FROM role_permissions WHERE role_id = ?`, [req.params.roleId], (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows.map(r => r.permission_code));
    });
});

// Update Role Permissions
app.post('/api/roles/:roleId/permissions', (req, res) => {
    const { roleId } = req.params;
    const { permissions } = req.body; // Array of codes
    
    db.serialize(() => {
        // Clear existing
        db.run(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
        
        // Add new
        const stmt = db.prepare(`INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?)`);
        permissions.forEach(p => stmt.run(roleId, p));
        stmt.finalize();
        
        res.json({ success: true });
    });
});

// Get Audit Logs
app.get("/api/audit-logs", (req, res) => {
    const query = `
        SELECT al.*, u.name as actor_name 
        FROM audit_logs al
        LEFT JOIN users u ON al.actor_id = u.id
        ORDER BY al.created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Basic Route
app.get("/", (req, res) => {
  res.send("Delivery Management System API is running");
});

// --- Order Routes ---

app.get("/api/orders", (req, res) => {
    const { status } = req.query;
    let query = `
        SELECT o.*, 
               m.name as merchant_name,
               md.store_name,
               c.name as courier_name
        FROM orders o 
        LEFT JOIN users m ON o.merchant_id = m.id
        LEFT JOIN merchant_details md ON o.merchant_id = md.user_id
        LEFT JOIN users c ON o.delivery_courier_id = c.id
        WHERE 1=1
    `;
    let params = [];
    
    if (status && status !== 'All') {
        if (status.includes(',')) {
            const statuses = status.split(',');
            const placeholders = statuses.map(() => '?').join(',');
            query += ` AND o.status IN (${placeholders})`;
            params.push(...statuses);
        } else {
            query += " AND o.status = ?";
            params.push(status);
        }
    }

    if (req.query.merchant_id) {
        query += " AND o.merchant_id = ?";
        params.push(req.query.merchant_id);
    }

    if (req.query.delivery_courier_id) {
        query += " AND (o.delivery_courier_id = ? OR o.id IN (SELECT ca.order_id FROM courier_accounts ca WHERE ca.courier_id = ?))";
        params.push(req.query.delivery_courier_id, req.query.delivery_courier_id);
    }

    // New: Filter by Branch Warehouse
    if (req.query.branch_id) {
        query += " AND o.branch_warehouse_id = ?";
        params.push(req.query.branch_id);
    }
    if (req.query.branch_warehouse_id) {
        query += " AND o.branch_warehouse_id = ?";
        params.push(req.query.branch_warehouse_id);
    }
    
    // Default to main warehouse filtering
    if (req.query.main_warehouse === 'true') {
         // Include orders that are explicitly Main OR orphaned (no warehouse assigned yet)
         query += " AND (o.branch_warehouse_id IS NULL OR o.main_warehouse_id = 'true')";
    }
    
    query += " ORDER BY o.created_at DESC";

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get Order Items
app.get("/api/orders/:id/items", (req, res) => {
    const { id } = req.params;
    db.all("SELECT * FROM order_items WHERE order_id = ?", [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Update Order Items (e.g., for Returns Reconciliation)
app.put("/api/orders/:id/items", (req, res) => {
    const { id } = req.params;
    const { items, changed_by } = req.body;
    // items: [{ id: 'item_uuid', returned_quantity: 5 }, ...]

    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "Invalid items array" });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        const stmt = db.prepare("UPDATE order_items SET returned_quantity = ? WHERE id = ? AND order_id = ?");
        
        let errorOccurred = false;
        items.forEach(item => {
            stmt.run(item.returned_quantity, item.uuid || item.id, id, (err) => {
                if (err) errorOccurred = true;
            });
        });
        stmt.finalize();

        if (errorOccurred) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: "Failed to update item quantities" });
        }

        // Log History
        const { v4: uuidv4 } = require('uuid');
        db.run(`INSERT INTO order_history (id, order_id, status, changed_by, notes) VALUES (?, ?, ?, ?, ?)`,
               [uuidv4(), id, 'Items Updated', changed_by, 'Returned quantities updated'], (err) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }
            db.run("COMMIT");
            res.json({ success: true });
        });
    });
});

// --- Company Fund & Expenses Routes ---

// Get Company Fund Summary
app.get("/api/company/fund", (req, res) => {
    const dbGet = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
    const dbAll = (sql, params) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });

    (async () => {
        try {
            // 1. Get Financial Summary
            // Calculate Total Income from Orders (Delivery Fees + Company Share)
            // For simplicity, we sum 'paid_amount' of Delivered orders that are fully settled?
            // Actually, let's use the 'company_financials' table if populated, OR dynamic sum.
            
            // Dynamic Calculation:
            // Revenue = Sum of (Delivery Fee + Commission) for all Delivered orders 
            // OR Sum of 'net_earnings' from courier_accounts where status='SETTLED'?
            // Let's simpler: Sum of (delivery_fee - courier_commission) for all Delivered orders = Company Net Revenue.
            // AND Company also collects the Merchant's money initially? 
            // The prompt says "Sum of amounts collected from branches".
            // This suggests Money physically with the company.
            
            // Let's stick to `company_financials` which is updated on delivery (see line 610 in existing code).
            
            let financials = await dbGet("SELECT * FROM company_financials WHERE id = 'MAIN'");
            if (!financials) {
                // Initialize if missing
                await new Promise((resolve, reject) => {
                    db.run("INSERT OR IGNORE INTO company_financials (id, total_revenue, total_expenses, current_balance) VALUES ('MAIN', 0, 0, 0)", (err) => err ? reject(err) : resolve());
                });
                financials = { total_revenue: 0, total_expenses: 0, current_balance: 0 };
            }

            // 2. Get Expenses History
            const expenses = await dbAll(`
                SELECT e.*, u.name as user_name, ec.name as category_name 
                FROM expenses e 
                LEFT JOIN users u ON e.user_id = u.id 
                LEFT JOIN expense_categories ec ON e.category_id = ec.id 
                ORDER BY e.created_at DESC LIMIT 50
            `);

            res.json({
                summary: financials,
                history: expenses
            });

        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    })();
});

// Create Expense / Payment Voucher
app.post("/api/company/expenses", (req, res) => {
    const { amount, description, category_id, user_id, beneficiary } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();

    if (!amount || !description) return res.status(400).json({ error: "Amount and Description required" });

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. Insert Expense
        const stmt = db.prepare("INSERT INTO expenses (id, user_id, category_id, amount, description, status) VALUES (?, ?, ?, ?, ?, ?)");
        // Beneficiary can be added to description or a new column if schema allows. We appened to desc for now.
        const fullDesc = beneficiary ? `${description} (To: ${beneficiary})` : description;
        
        stmt.run(id, user_id, category_id || 'GENERAL', amount, fullDesc, 'Approved', (err) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }

            // 2. Update Company Financials (Deduct from Balance)
            db.run(`UPDATE company_financials SET total_expenses = total_expenses + ?, current_balance = current_balance - ? WHERE id = 'MAIN'`, 
                [amount, amount], (err) => {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                }
                
                db.run("COMMIT");
                res.json({ success: true, id, message: "Expense voucher created" });
            });
        });
        stmt.finalize();
    });
});


app.post("/api/orders", async (req, res) => {
    // ... (existing code for orders)
    // Helper: Audit Logger


    const { 
        shipment_number, customer_name, customer_phone, delivery_address, province, area, 
        pickup_address, merchant_id, package_type, package_size, notes, amount, 
        status, items 
    } = req.body;
    
    // ...
    
    const { v4: uuidv4 } = require('uuid'); 
    const id = uuidv4();
    const orderStatus = status || 'Pending';
    
    // Helper to promisify DB get
    const dbGet = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });

    const dbRun = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { err ? reject(err) : resolve(this) });
    });

    try {
        // --- 1. Calculate Delivery Fee ---
        let basePrice = 0;
        
        // A. Check Merchant Override
        const merchantOverride = await dbGet("SELECT price FROM merchant_pricing_overrides WHERE merchant_id = ? AND province = ?", [merchant_id || '', province || '']);
        
        if (merchantOverride) {
            basePrice = merchantOverride.price;
        } else {
            // B. Check Location Base Price
            const location = await dbGet("SELECT base_price FROM locations WHERE name = ?", [province || '']);
            basePrice = location ? location.base_price : 5000; // Default 5000 if unknown
        }

        // C. Check Package Modifier
        const modifier = await dbGet("SELECT additional_fee FROM package_modifiers WHERE size_name = ?", [package_size || 'Standard']);
        const extraFee = modifier ? modifier.additional_fee : 0;
        
        const finalDeliveryFee = basePrice + extraFee;

        // --- 2. Calculate Courier Commission ---
        const setting = await dbGet("SELECT value FROM system_settings WHERE key = 'default_commission'", []);
        const courierCommission = setting ? parseFloat(setting.value) : 2000;

        // --- 3. Generate Order Number & Insert Order ---
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            // Get Next Sequence
            db.run("UPDATE sequences SET value = value + 1 WHERE name = 'orders'", function(err) {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: "Sequence Update Failed: " + err.message });
                }

                db.get("SELECT value FROM sequences WHERE name = 'orders'", (err, row) => {
                    if (err || !row) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: "Sequence Fetch Failed" });
                    }
                    
                    const newOrderNumber = String(row.value);

                    const stmt = db.prepare(`
                        INSERT INTO orders (
                            id, order_number, shipment_number, customer_name, customer_phone, delivery_address, 
                            province, area, pickup_address, merchant_id, 
                            package_type, package_size, notes, amount, 
                            delivery_fee, courier_commission, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    
                    stmt.run([
                        id, newOrderNumber, shipment_number || '', customer_name, customer_phone, delivery_address, 
                        province || '', area || '', pickup_address || '', merchant_id, 
                        package_type || 'Single', package_size || 'Standard', notes || '', 
                        amount, finalDeliveryFee, courierCommission, orderStatus
                    ], function(err) {
                        if (err) {
                            stmt.finalize();
                            db.run("ROLLBACK");
                            return res.status(500).json({ error: err.message });
                        }
                        
                        // Insert Items
                        if (items && Array.isArray(items) && items.length > 0) {
                            const itemStmt = db.prepare(`INSERT INTO order_items (id, order_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)`);
                            items.forEach(item => {
                                itemStmt.run(uuidv4(), id, item.item_name, item.quantity, item.unit_price, item.total_price);
                            });
                            itemStmt.finalize();
                        }
                        
                        // Log initial history
                        const historyId = uuidv4();
                        db.run(`INSERT INTO order_history (id, order_id, status, changed_by, notes) VALUES (?, ?, ?, ?, ?)`, 
                               [historyId, id, orderStatus, merchant_id, 'Order Created'], (err) => {
                                   if (err) {
                                       db.run("ROLLBACK");
                                       return res.status(500).json({ error: 'History Log Failed' });
                                   }

                                   db.run("COMMIT");

                                   res.json({ 
                                       id, 
                                       order_number: newOrderNumber, 
                                       status: orderStatus, 
                                       delivery_fee: finalDeliveryFee,
                                       courier_commission: courierCommission,
                                       message: 'Order created successfully' 
                                   });
                               });
                    });
                    stmt.finalize();
                });
            });
        });

    } catch (err) {
        res.status(500).json({ error: 'Pricing Calculation Failed: ' + err.message });
    }
});

// Update Order Status (Workflow Transition)
// Update Order (Merchant Edit)
app.put("/api/orders/:id", async (req, res) => {
    const { id } = req.params;
    const { 
        shipment_number, customer_name, customer_phone, delivery_address, province, area, 
        package_type, package_size, notes, amount 
    } = req.body;

    const dbGet = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });

    try {
        const order = await dbGet("SELECT status FROM orders WHERE id = ?", [id]);
        if (!order) return res.status(404).json({ error: "Order not found" });
        
        if (order.status !== 'Pending') {
            return res.status(400).json({ error: "Only 'Pending' orders can be edited." });
        }

        const query = `
            UPDATE orders SET 
                shipment_number = ?, customer_name = ?, customer_phone = ?, delivery_address = ?, 
                province = ?, area = ?, package_type = ?, package_size = ?, 
                notes = ?, amount = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        db.run(query, [
            shipment_number, customer_name, customer_phone, delivery_address, 
            province, area, package_type, package_size, 
            notes, amount, id
        ], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Order updated successfully" });
        });

    } catch (err) {
        res.status(500).json({ error: "Update failed: " + err.message });
    }
});

// Update Order Status (Workflow Transition)
app.post("/api/orders/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status, changed_by, notes, paid_amount, delivery_courier_id, items } = req.body;

    // Promisify DB Helpers
    const dbGet = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
    const dbRun = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { err ? reject(err) : resolve(this) });
    });
    const dbAll = (sql, params) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });

    try {
        const order = await dbGet("SELECT * FROM orders WHERE id = ?", [id]);
        if (!order) return res.status(404).json({ error: "Order not found" });

        const oldStatus = order.status;
        let newPaidAmount = paid_amount !== undefined ? paid_amount : (order.paid_amount || 0);

        if (oldStatus === 'Cancelled') return res.status(400).json({ error: "Cannot change status of a Cancelled order." });
        if (oldStatus === 'Returned' && status === 'Delivered') return res.status(400).json({ error: "Cannot change status from Returned to Delivered." });

        // New Restrictions for 'Returned to Merchant'
        if (status === 'Returned to Merchant') {
            if (oldStatus === 'Delivered') {
                return res.status(400).json({ error: "لا يمكن ارجاع طلب تم تسليمه مسبقاً للتاجر" });
            }
            if (oldStatus === 'Partial Delivery' && !order.order_number.endsWith('p')) {
                return res.status(400).json({ error: "لا يمكن ارجاع طلب مسلم جزئياً للتاجر (فقط الجزء المتبقي 'p' يمكن ارجاعه)" });
            }
        }

        if (status === 'Delivered') {
            newPaidAmount = paid_amount !== undefined ? paid_amount : order.amount;
        }

        // Start Transaction
        await dbRun("BEGIN TRANSACTION");

        // [Feature] Enforce Settings Delivery Fee & Commission on Completion
        let finalDeliveryFee = order.delivery_fee || 0;
        let finalCommission = order.courier_commission || 0;

        if (status === 'Delivered' || status === 'Partial Delivery') {
             // 1. Fee
             let basePrice = 0;
             const merchantOverride = await dbGet("SELECT price FROM merchant_pricing_overrides WHERE merchant_id = ? AND province = ?", [order.merchant_id || '', order.province || '']);
             if (merchantOverride) {
                 basePrice = merchantOverride.price;
             } else {
                 const locationRow = await dbGet("SELECT base_price FROM locations WHERE name = ?", [order.province || '']);
                 basePrice = locationRow ? locationRow.base_price : 5000;
             }
             const modifier = await dbGet("SELECT additional_fee FROM package_modifiers WHERE size_name = ?", [order.package_size || 'Standard']);
             const extraFee = modifier ? modifier.additional_fee : 0;
             finalDeliveryFee = basePrice + extraFee;

             // 2. Commission
             const commSetting = await dbGet("SELECT value FROM system_settings WHERE key = 'default_commission'");
             finalCommission = commSetting ? parseFloat(commSetting.value) : 2000;
        }

        try {
            // 1. Update Order
            let updateQuery = "UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP";
            let params = [status];

            if (paid_amount !== undefined || status === 'Delivered' || status === 'Partial Delivery') {
                updateQuery += ", paid_amount = ?, delivery_fee = ?, courier_commission = ?";
                params.push(newPaidAmount);
                params.push(finalDeliveryFee);
                params.push(finalCommission);
                
                // If Partial Delivery, we must update the 'amount' to reflect the delivered portion only
                // This ensures "Order Amount" is accurate for the merchant
                if (status === 'Partial Delivery') {
                     updateQuery += ", amount = ?";
                     // The amount of goods delivered = Total Collected - Delivery Fee
                     params.push(newPaidAmount - finalDeliveryFee);
                }
            }

            // --- Robust Location/Courier Handlers ---
            
            // If moving to a warehouse state, clear courier unless explicitly assigning one
            // CRITICAL: ONLY clear courier if the status is strictly "In Warehouse" or "In Branch" (already received)
            // 'Returned' or 'Transferred' means it's still with courier/truck in transit.
            const clearCourierStatuses = ['In Warehouse', 'In Branch', 'Delivered'];
            
            if (clearCourierStatuses.includes(status) && delivery_courier_id === undefined) {
                updateQuery += ", delivery_courier_id = NULL";
            } else if (delivery_courier_id !== undefined) {
                updateQuery += ", delivery_courier_id = ?";
                params.push(delivery_courier_id);
            }

            // Exclusivity: Main vs Branch
            if (req.body.main_warehouse_id === 'true' || req.body.main_warehouse_id === true || status === 'In Warehouse') {
                updateQuery += ", branch_warehouse_id = NULL, main_warehouse_id = 'true'";
            } else if (req.body.branch_warehouse_id) {
                updateQuery += ", branch_warehouse_id = ?, main_warehouse_id = NULL";
                params.push(req.body.branch_warehouse_id);
            } else if (req.body.main_warehouse_id === null || req.body.branch_warehouse_id === null) {
                // Explicitly clearing flags (e.g. out for delivery)
                if (req.body.main_warehouse_id === null) updateQuery += ", main_warehouse_id = NULL";
                if (req.body.branch_warehouse_id === null) updateQuery += ", branch_warehouse_id = NULL";
            } else if (status === 'Delivered' || status === 'Returned') {
                // DO NOT clear warehouse IDs when completing or returning an order.
                // This preserves ownership for reporting.
            } else {
                // Default: If no warehouse ID is provided and we aren't completing/returning, 
                // we might be out for delivery or similar state where we *should* keep the last known warehouse
                // as the "Owner". Most status updates from courier (Handled by handleQuickAction) 
                // don't send warehouse IDs, so we just let them stay.
            }

            if (notes !== undefined) {
                updateQuery += ", notes = ?";
                params.push(notes);
            }
            updateQuery += " WHERE id = ?";
            params.push(id);

            await dbRun(updateQuery, params);

            // 2. Handle Partial Delivery -> Create New Order for Remainder
            if (status === 'Partial Delivery') {
                 // Ensure we have numbers for math
                 const originalAmount = parseFloat(order.amount || 0);
                 const deliveryFee = parseFloat(finalDeliveryFee || 0);
                 const collectedAmount = parseFloat(newPaidAmount || 0);
                 
                 // Logic: (Original Goods + Delivery Fee) - Collected = Remaining Goods Value
                 // This ensures the merchant is made whole when the child order is eventually processed.
                 const remainingValue = Math.max(0, (originalAmount + deliveryFee) - collectedAmount);
                 
                 const newId = uuidv4();
                 // Follow naming convention: Original Order Number followed by 'p'
                 const newOrderNumber = `${order.order_number}p`; 

                 const insertSql = `
                    INSERT INTO orders (
                        id, order_number, shipment_number, customer_name, customer_phone, delivery_address, 
                        province, area, pickup_address, merchant_id, 
                        package_type, package_size, notes, amount, 
                        delivery_fee, courier_commission, status, created_at,
                        delivery_courier_id, branch_warehouse_id, main_warehouse_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
                 `;
                 
                 const copyParams = [
                     newId, newOrderNumber, order.shipment_number, order.customer_name, order.customer_phone, 
                     order.delivery_address, order.province, order.area, order.pickup_address, order.merchant_id, 
                     order.package_type, order.package_size, 
                     `المتبقي المرتجع من طلب #${order.order_number} (تسليم جزئي)`, // Professional Note
                     remainingValue, 
                     0, // Zero charges on remaining order as requested
                     0, // Zero commission for returns
                     'Returned',
                     order.delivery_courier_id, // Keep with same courier for pull-back
                     order.branch_warehouse_id,
                     order.main_warehouse_id
                 ];
                 
                 await dbRun(insertSql, copyParams);

                 // Clone Items (Promisified)
                 const orderItems = await dbAll("SELECT * FROM order_items WHERE order_id = ?", [id]);
                 if(orderItems && orderItems.length > 0) {
                     for (const it of orderItems) {
                         await dbRun(
                            `INSERT INTO order_items (id, order_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)`,
                            [uuidv4(), newId, it.item_name, it.quantity, it.unit_price, it.total_price]
                         );
                     }
                 }

                 // Log History for New Order
                 await dbRun(`INSERT INTO order_history (id, order_id, status, changed_by, notes) VALUES (?, ?, ?, ?, ?)`, 
                        [uuidv4(), newId, 'Returned', changed_by, `Remainder created from Partial Delivery of #${order.order_number}. Value: ${remainingValue}`]);
            }

            // --- Handle Items (Old Logic for Returns Reconciliation) ---
            if (items && Array.isArray(items) && items.length > 0) {
                 const itemStmt = db.prepare("UPDATE order_items SET returned_quantity = ? WHERE id = ?");
                 items.forEach(item => {
                     itemStmt.run(item.returned_quantity, item.id);
                 });
                 itemStmt.finalize();
            }

            // --- Financial Logic ---
            if ((status === 'Delivered' || status === 'Partial Delivery') && (oldStatus !== 'Delivered' && oldStatus !== 'Partial Delivery')) {
                 // Use Recalculated Fee
                 const deliveryFee = finalDeliveryFee;
                 const courierComm = order.courier_commission || 0;
                 const companyShare = deliveryFee - courierComm;
                 const collected = parseFloat(newPaidAmount); 
                 
                 // 1. Credit Courier: Commission
                 await dbRun(`UPDATE courier_details SET current_balance = current_balance + ? WHERE user_id = ?`, 
                        [courierComm, order.delivery_courier_id]);
                 
                 // 2. Credit Company: Share
                 await dbRun(`UPDATE company_financials SET total_revenue = total_revenue + ?, current_balance = current_balance + ? WHERE id = 'MAIN'`, 
                        [companyShare, companyShare]);
                 
                 // 3. Credit Merchant: (Collected - Delivery Fee)
                 if (order.merchant_id) {
                     const merchantNet = collected - deliveryFee;
                     await dbRun(`UPDATE merchant_details SET current_balance = current_balance + ? WHERE user_id = ?`,
                            [merchantNet, order.merchant_id]);
                 }

                 // 4. Insert into Courier Ledger (New Requirement)
                 if (order.delivery_courier_id) {
                     const orderAmt = order.amount || 0;
                     // Avoid division by zero
                     const commRate = orderAmt > 0 ? ((courierComm / orderAmt) * 100) : 0; 
                     // Or just assume standard 10-15% if stored, but we calculate back for safety
                     // Wait, better to store the flat rate if we don't know the percentage, but schema asked for rate.
                     // Let's use 0 if dynamic or fixed fee.
                     
                     await dbRun(`INSERT INTO courier_accounts (
                         courier_id, order_id, order_amount, collected_amount, 
                         commission_rate, commission_amount, net_earning, 
                         transaction_type, status
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                         order.delivery_courier_id, id, orderAmt, collected,
                         commRate, courierComm, courierComm, // Net earning is commission for now
                         'COLLECTION', 'PENDING'
                     ]);
                 }
            }

            // Add History for Original Order
            const historyId = uuidv4();
            let statusDesc = `Status changed to ${status}`;
            if (status === 'Partial Delivery') statusDesc = `Partial Delivery: Collected ${newPaidAmount}`;

            const fullNotes = notes ? `${statusDesc} Note: ${notes}` : statusDesc;

            await dbRun(`INSERT INTO order_history (id, order_id, status, old_status, changed_by, notes) VALUES (?, ?, ?, ?, ?, ?)`,
                   [historyId, id, status, oldStatus, changed_by, fullNotes]);

            await dbRun("COMMIT");
            res.json({ success: true, oldStatus, newStatus: status });

        } catch (err) {
            await dbRun("ROLLBACK");
            throw err;
        }

    } catch (err) {
        res.status(500).json({ error: 'Status Update Failed: ' + err.message });
    }
});

// Transfer Order to Branch
app.post("/api/orders/:id/transfer", (req, res) => {
    const { id } = req.params;
    const { branch_id, changed_by } = req.body;

    if (!branch_id) return res.status(400).json({ error: "Branch ID required" });

    db.get("SELECT status FROM orders WHERE id = ?", [id], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: "Order not found" });

        const oldStatus = order.status;
        const newStatus = 'Transferred'; // Or 'In Branch'

        db.serialize(() => {
            db.run(`UPDATE orders SET status = ?, branch_warehouse_id = ?, main_warehouse_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, 
                   [newStatus, branch_id, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });

                // Log History
                db.run(`INSERT INTO order_history (id, order_id, status, old_status, changed_by, notes) VALUES (?, ?, ?, ?, ?, ?)`,
                       [uuidv4(), id, newStatus, oldStatus, changed_by, `Transferred to Branch ID: ${branch_id}`], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
            });
        });
    });
});

// DELETE Order (Soft Delete)
app.delete("/api/orders/:id", async (req, res) => {
    const { id } = req.params;
    const { deleted_by } = req.body;

    const dbGet = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });

    try {
        const order = await dbGet("SELECT status FROM orders WHERE id = ?", [id]);
        if (!order) return res.status(404).json({ error: "Order not found" });
        
        // Strict check: Only Pending orders can be deleted by merchants (user flow)
        // We assume logic is handled by frontend for admins, but safety first:
        // Let's check status. If it's already 'Deleted', return success.
        if (order.status === 'Deleted') return res.json({ success: true });

        // Removed restriction: Allow deleting orders in any status per user request.
        // if (order.status !== 'Pending') {
        //    return res.status(400).json({ error: "Only 'Pending' orders can be deleted." });
        // }

        const query = "UPDATE orders SET status = 'Deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?";
        
        db.run(query, [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Log History
            const { v4: uuidv4 } = require('uuid');
            db.run(`INSERT INTO order_history (id, order_id, status, changed_by, notes) VALUES (?, ?, ?, ?, ?)`,
                    [uuidv4(), id, 'Deleted', deleted_by, 'Order Deleted']);
            
            if (deleted_by) logAudit(deleted_by, 'delete_order', 'order', id, { status: 'Deleted' });
            
            res.json({ success: true, message: "Order deleted successfully" });
        });
    } catch (err) {
        res.status(500).json({ error: "Delete failed: " + err.message });
    }
});

// DELETE User (Soft Delete)
app.delete("/api/users/:id", (req, res) => {
    const { id } = req.params;
    const { deleted_by } = req.body;

    if (!id) return res.status(400).json({ error: "User ID required" });

    // soft delete by setting status to 'deleted'
    const query = "UPDATE users SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    
    db.run(query, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "User not found" });

        // Audit Log
        if (deleted_by) logAudit(deleted_by, 'delete_user', 'user', id, { status: 'deleted' });
        
        res.json({ success: true, message: "User deleted successfully" });
    });
});

// Get Order History
app.get("/api/orders/:id/history", (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT h.*, u.name as changed_by_name 
        FROM order_history h
        LEFT JOIN users u ON h.changed_by = u.id
        WHERE h.order_id = ?
        ORDER BY h.created_at DESC
    `;
    db.all(query, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- Branch Routes ---

app.get("/api/branches", (req, res) => {
    // Prefer direct fields, fallback to join if needed (though we rely on direct now)
    db.all("SELECT b.*, COALESCE(b.manager_name, u.name) as manager_name FROM branches b LEFT JOIN users u ON b.manager_id = u.id", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post("/api/branches", (req, res) => {
    const { name, location, manager_name, manager_phone, manager_address } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    
    db.run("INSERT INTO branches (id, name, location, manager_name, manager_phone, manager_address) VALUES (?, ?, ?, ?, ?, ?)",
        [id, name, location, manager_name, manager_phone, manager_address], (err) => {
             if (err) return res.status(500).json({ error: err.message });
             res.json({ success: true, id });
        });
});

app.put("/api/branches/:id", (req, res) => {
    const { name, location, manager_name, manager_phone, manager_address } = req.body;
    const { id } = req.params;
    
    db.run("UPDATE branches SET name = ?, location = ?, manager_name = ?, manager_phone = ?, manager_address = ? WHERE id = ?",
        [name, location, manager_name, manager_phone, manager_address, id], (err) => {
             if (err) return res.status(500).json({ error: err.message });
             res.json({ success: true });
        });
});

// Delete Branch
app.delete("/api/branches/:id", (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM branches WHERE id = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- Courier Routes ---

app.get("/api/couriers", (req, res) => {
    // Fetch default commission to sync calculations
    db.get("SELECT value FROM system_settings WHERE key = 'default_commission'", (err, settingRow) => {
        const defaultCommission = settingRow ? parseFloat(settingRow.value) : 0;
        
        const query = `
            SELECT u.id as user_id, u.name, u.username, u.phone, r.name as role_name,
                   cd.vehicle_type, cd.plate_number, 
                   /* Calculate Dynamic Commission Balance: (Total Delivered Orders * Global Commission) + (Sum of Payouts [Negative]) */
                   ( (SELECT COUNT(*) FROM courier_accounts ca WHERE ca.courier_id = u.id AND ca.transaction_type = 'COLLECTION') * ${defaultCommission} )
                   + 
                   (SELECT COALESCE(SUM(ft.amount), 0) FROM financial_transactions ft WHERE ft.user_id = u.id AND ft.type = 'Payout') as current_balance,
                   /* Total Lifetime Earned Commission */
                   ( (SELECT COUNT(*) FROM courier_accounts ca WHERE ca.courier_id = u.id AND ca.transaction_type = 'COLLECTION') * ${defaultCommission} ) as total_earned_commission,
                   /* Total Lifetime Paid Payouts (stored as negative in ft, so we use ABS or -SUM) */
                   (SELECT COALESCE(ABS(SUM(ft.amount)), 0) FROM financial_transactions ft WHERE ft.user_id = u.id AND ft.type = 'Payout') as total_paid_commission,
                   cd.status, cd.coverage_areas,
                   /* Calculate Gross Liability (Total COD + Delivery) */
                   (SELECT COALESCE(SUM(ca.collected_amount), 0) 
                    FROM courier_accounts ca
                    WHERE ca.courier_id = u.id 
                      AND ca.status = 'PENDING' 
                      AND ca.transaction_type = 'COLLECTION'
                   ) as pending_settlement,
                   (SELECT COALESCE(SUM(ca.order_amount), 0) FROM courier_accounts ca WHERE ca.courier_id = u.id AND ca.transaction_type = 'COLLECTION') as total_order_amount,
                   (SELECT COUNT(*) FROM courier_accounts ca WHERE ca.courier_id = u.id AND ca.transaction_type = 'COLLECTION') as total_delivered_orders
            FROM users u 
            JOIN roles r ON u.role_id = r.id 
            LEFT JOIN courier_details cd ON u.id = cd.user_id
            WHERE r.name LIKE '%Courier%' 
              AND (u.status IS NULL OR u.status != 'deleted')
              ${req.query.branch_id ? `AND u.branch_id = '${req.query.branch_id}'` : ''}
        `;

        db.all(query, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });
});

app.post("/api/couriers", async (req, res) => {
    const { name, username, password, phone, vehicle_type, coverage_areas, role_type, branch_id } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const bcrypt = require('bcryptjs');

    // 1. Find Role ID
    db.get("SELECT id FROM roles WHERE name = ?", [role_type || 'Delivery Courier'], async (err, role) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!role) return res.status(400).json({ error: 'Invalid Role' });

        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash(password || '123456', 10);

        db.serialize(() => {
            // 2. Insert User
            const stmtValid = db.prepare("INSERT INTO users (id, name, username, password_hash, phone, role_id, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
            stmtValid.run([userId, name, username, hashedPassword, phone, role.id, branch_id], function(err) {
                 if (err) return res.status(500).json({ error: 'User creation failed: ' + err.message });
                 
                 // 3. Insert Courier Details
                 const stmtDetails = db.prepare("INSERT INTO courier_details (user_id, vehicle_type, plate_number, coverage_areas) VALUES (?, ?, ?, ?)");
                 stmtDetails.run([userId, vehicle_type, req.body.plate_number || '', coverage_areas], function(err) {
                     if (err) return res.status(500).json({ error: 'Courier details failed: ' + err.message });
                     res.json({ success: true, id: userId });
                 });
                 stmtDetails.finalize();
            });
            stmtValid.finalize();
        });
    });
});

app.get("/api/couriers/:id", (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT u.id as user_id, u.name, u.username, u.phone, u.role_id,
               cd.vehicle_type, cd.plate_number, cd.coverage_areas
        FROM users u 
        LEFT JOIN courier_details cd ON u.id = cd.user_id
        WHERE u.id = ?
    `;
    db.get(query, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Courier not found" });
        res.json(row);
    });
});

app.put("/api/couriers/:id", (req, res) => {
    const { id } = req.params; // This is the user_id
    const { name, phone, vehicle_type, plate_number, password } = req.body;
    const bcrypt = require('bcryptjs');

    db.serialize(async () => {
        // 1. Update User Info
        let userUpdateQuery = "UPDATE users SET name = ?, phone = ?, username = ?, branch_id = ?, updated_at = CURRENT_TIMESTAMP";
        let userParams = [name, phone, req.body.username, req.body.branch_id];

        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            userUpdateQuery += ", password_hash = ?";
            userParams.push(hashedPassword);
        }

        userUpdateQuery += " WHERE id = ?";
        userParams.push(id);

            db.run(userUpdateQuery, userParams, (err) => {
                if (err) {
                     if (err.message.includes('UNIQUE')) {
                         return res.status(400).json({ error: 'اسم المستخدم مستخدم مسبقًا، يرجى اختيار اسم آخر' });
                     }
                     return res.status(500).json({ error: err.message });
                }

                // 2. Update Courier Details (Upsert to handle missing rows)
                const upsertQuery = `
                    INSERT INTO courier_details (user_id, vehicle_type, plate_number, coverage_areas) 
                    VALUES (?, ?, ?, '') 
                    ON CONFLICT(user_id) 
                    DO UPDATE SET vehicle_type=excluded.vehicle_type, plate_number=excluded.plate_number
                `;
                
                db.run(upsertQuery, [id, vehicle_type, plate_number], (err) => {
                    if (err) {
                        console.error("Update Courier Details Error:", err);
                        return res.status(500).json({ error: err.message });
                    }
                    res.json({ success: true });
                });
            });
    });
});

// --- Merchant Routes ---

app.get("/api/merchants", (req, res) => {
    const query = `
        SELECT u.id as user_id, u.name, u.username, u.phone, r.name as role_name,
               md.store_name, md.address, md.payment_method, md.current_balance
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        LEFT JOIN merchant_details md ON u.id = md.user_id
        WHERE r.name = 'Merchant' AND (u.status IS NULL OR u.status != 'deleted')
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get All Merchants (Simplied list)
app.get("/api/merchants/list", (req, res) => {
    db.all("SELECT id, name, store_name FROM merchant_details JOIN users ON merchant_details.user_id = users.id", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.get("/api/merchants/:id", (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT u.id as user_id, u.name, u.username, u.phone, r.name as role_name,
               md.store_name, md.address, md.payment_method, md.current_balance
        FROM users u 
        JOIN roles r ON u.role_id = r.id 
        LEFT JOIN merchant_details md ON u.id = md.user_id
        WHERE u.id = ? AND r.name = 'Merchant'
    `;
    db.get(query, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Merchant not found" });
        res.json(row);
    });
});

app.post("/api/merchants", async (req, res) => {
    const { name, username, password, phone, store_name, address, payment_method } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const bcrypt = require('bcryptjs');

    // 1. Find Role ID
    db.get("SELECT id FROM roles WHERE name = 'Merchant'", async (err, role) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!role) return res.status(400).json({ error: 'Role Merchant not found' });

        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash(password || '123456', 10);

        db.serialize(() => {
            // 2. Insert User
            const stmtValid = db.prepare("INSERT INTO users (id, name, username, password_hash, phone, role_id) VALUES (?, ?, ?, ?, ?, ?)");
            stmtValid.run([userId, name, username, hashedPassword, phone, role.id], function(err) {
                 if (err) return res.status(500).json({ error: 'User creation failed: ' + err.message });
                 
                 // 3. Insert Merchant Details
                 const stmtDetails = db.prepare("INSERT INTO merchant_details (user_id, store_name, address, payment_method) VALUES (?, ?, ?, ?)");
                 stmtDetails.run([userId, store_name, address, payment_method || 'Cash'], function(err) {
                     if (err) return res.status(500).json({ error: 'Merchant details failed: ' + err.message });
                     res.json({ success: true, id: userId });
                 });
                 stmtDetails.finalize();
            });
            stmtValid.finalize();
        });
    });
});

app.put("/api/merchants/:id", (req, res) => {
    const { id } = req.params;
    const { name, username, password, phone, store_name, address, payment_method } = req.body;
    const bcrypt = require('bcryptjs');

    db.serialize(async () => {
        // 1. Update User Info
        let userUpdateQuery = "UPDATE users SET name = ?, phone = ?, username = ?, updated_at = CURRENT_TIMESTAMP";
        let userParams = [name, phone, username];

        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            userUpdateQuery += ", password_hash = ?";
            userParams.push(hashedPassword);
        }

        userUpdateQuery += " WHERE id = ?";
        userParams.push(id);

        db.run(userUpdateQuery, userParams, (err) => {
            if (err) {
                 if (err.message.includes('UNIQUE')) {
                     return res.status(400).json({ error: 'اسم المستخدم مستخدم مسبقًا' });
                 }
                 return res.status(500).json({ error: err.message });
            }

            // 2. Update Merchant Details
            const upsertQuery = `
                INSERT INTO merchant_details (user_id, store_name, address, payment_method) 
                VALUES (?, ?, ?, ?) 
                ON CONFLICT(user_id) 
                DO UPDATE SET store_name=excluded.store_name, address=excluded.address, payment_method=excluded.payment_method
            `;
            
            db.run(upsertQuery, [id, store_name, address, payment_method], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                
                // Audit Log
                logAudit(id, 'update_profile', 'merchant', id, { name, store_name });
                
                res.json({ success: true });
            });
        });
    });
});

// --- Expense Routes ---

app.get("/api/expenses", (req, res) => {
    const query = `
        SELECT e.*, u.name as user_name, c.name as category_name 
        FROM expenses e 
        LEFT JOIN users u ON e.user_id = u.id 
        LEFT JOIN expense_categories c ON e.category_id = c.id
        ORDER BY e.created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post("/api/expenses", (req, res) => {
    const { user_id, category_id, amount, description, receipt_url } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    
    db.run("INSERT INTO expenses (id, user_id, category_id, amount, description, receipt_url) VALUES (?, ?, ?, ?, ?, ?)",
        [id, user_id, category_id, amount, description, receipt_url], (err) => {
             if (err) return res.status(500).json({ error: err.message });
             res.json({ success: true, id });
        });
});

// --- Settlement Routes ---

app.get("/api/settlements/courier/preview/:courierId", (req, res) => {
    const courierId = req.params.courierId;
    
    db.serialize(() => {
        const result = {
            orders: [],
            expenses: [],
            summary: {
                total_cod: 0,
                total_commission: 0,
                total_expenses: 0,
                net_amount: 0 // Amount Courier Pay to Company
            }
        };

        // Sync with ledger: Query courier_accounts instead of orders to get verified amounts
        db.get("SELECT value FROM system_settings WHERE key = 'default_commission'", (err, settingRow) => {
            const defaultCommission = settingRow ? parseFloat(settingRow.value) : 0;
            
            const orderSql = `SELECT ca.id as account_id, o.id, o.order_number, ca.order_amount as amount, 
                                     ca.collected_amount as cod_collected_amount, ca.commission_amount as courier_commission, 
                                     o.delivery_fee, o.status as order_status
                              FROM courier_accounts ca
                              JOIN orders o ON ca.order_id = o.id
                              WHERE ca.courier_id = ? 
                                AND ca.status = 'PENDING' 
                                AND ca.transaction_type = 'COLLECTION'`;
            
            db.all(orderSql, [courierId], (err, orders) => {
                 if (err) return res.status(500).json({ error: err.message });
                 
                 // Apply dynamic commission override for settlement preview consistency
                 const processedOrders = orders.map(o => ({
                     ...o,
                     courier_commission: defaultCommission
                 }));

                 result.orders = processedOrders;
                 result.summary.total_cod = processedOrders.reduce((sum, o) => sum + (o.cod_collected_amount || 0), 0);
                 result.summary.total_delivery_fees = processedOrders.reduce((sum, o) => sum + (o.delivery_fee || 0), 0);
                 result.summary.total_orders_amount = result.summary.total_cod - result.summary.total_delivery_fees;
                 result.summary.total_commission = processedOrders.reduce((sum, o) => sum + (o.courier_commission || 0), 0);
                 
                 // 2. Get Approved Unsettled Expenses
                 const expSql = `SELECT id, amount, description FROM expenses 
                                 WHERE user_id = ? AND status = 'Approved' AND settlement_id IS NULL`;
                 
                 db.all(expSql, [courierId], (err, expenses) => {
                     if (err) return res.status(500).json({ error: err.message });
                     result.expenses = expenses;
                     result.summary.total_expenses = expenses.reduce((sum, e) => sum + e.amount, 0);
                     
                     // 3. Calculate Net
                     // Net for Receipt = Total Gross COD (Commission & Expenses handled separately)
                     result.summary.net_amount = result.summary.total_cod;
                     
                     res.json(result);
                 });
            });
        });
    });
});

app.post("/api/settlements/courier", (req, res) => {
    const { courierId, amount, processedBy } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const settlementId = uuidv4();
    
    // Amount is the NET amount from Preview: Total COD - Total Commission
    // If Positive: Courier has Cash > Commission. Courier Pays Company (Collection).
    // If Negative: Commission > COD. Company Pays Courier (Payout).
    const settlementAmount = parseFloat(amount);

    db.serialize(() => {
        // 1. Create Settlement Record
        db.run(`INSERT INTO settlements (id, type, target_id, amount, processed_by, period_end) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, 
               [settlementId, 'Courier', courierId, settlementAmount, processedBy], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // 2. Mark Orders as Settled
            db.run(`UPDATE orders SET courier_settlement_id = ? WHERE delivery_courier_id = ? AND status = 'Delivered' AND courier_settlement_id IS NULL`, 
                   [settlementId, courierId]);

            // 2.1 Mark Courier Accounts (Ledger) as Settled
            db.run(`UPDATE courier_accounts SET status = 'SETTLED', settlement_id = ? 
                   WHERE courier_id = ? AND status = 'PENDING' AND transaction_type = 'COLLECTION'`,
                   [settlementId, courierId]);
                   
            // 3. Mark Expenses as Settled
            db.run(`UPDATE expenses SET settlement_id = ?, status = 'Settled' WHERE user_id = ? AND status = 'Approved' AND settlement_id IS NULL`, 
                   [settlementId, courierId]);

            // 4. Record Financial Transaction
            const transId = uuidv4();
            let type = 'Settlement';
            let transAmount = settlementAmount; 
            let note = `Settlement #${settlementId}`;
            
            if (settlementAmount > 0) {
                 type = 'Collection'; // We Collected Money
                 note = 'المبالغ في ذمة المندوب والتي تم استلامها من الفرع';
                 // Transaction Amount: +Positive
            } else {
                 type = 'Payout'; // We Paid Money
                 // Transaction Amount: Should be Negative? 
                 // If utilizing generic 'amount' in ledger: Payouts correspond to negative values.
                 // settlementAmount is already negative. So transAmount = settlementAmount.
            }
            
            db.run(`INSERT INTO financial_transactions (id, user_id, amount, type, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                   [transId, courierId, transAmount, type, note, processedBy]);

            // 5. Update Courier Balance - REMOVED for Receipt/Commission Separation
            // Commissions are added during delivery, Payouts are in separate screen.
            res.json({ success: true, settlementId });
        });
    });
});


// Branch Financial Box - Aggregated revenues from couriers
app.get("/api/branch/financial-box/:branchId", (req, res) => {
    const branchId = req.params.branchId;
    
    const result = {
        summary: {
            totalGrossCod: 0,
            totalNetCollection: 0,
            totalReceipts: 0,
            totalPayouts: 0,
            netBoxBalance: 0,
            lastMonthGross: 0
        },
        history: []
    };

    db.serialize(() => {
        // 1. Get History (Detailed list of settlements with Gross amount)
        const historySql = `
            SELECT s.id as settlement_id, s.amount as net_amount, s.created_at, s.processed_by,
                   u.name as courier_name,
                   (SELECT SUM(ca2.collected_amount) FROM courier_accounts ca2 WHERE ca2.settlement_id = s.id) as gross_amount
            FROM settlements s
            JOIN users u ON s.target_id = u.id
            WHERE u.branch_id = ? AND s.type = 'Courier'
            ORDER BY s.created_at DESC
            LIMIT 100
        `;

        db.all(historySql, [branchId], (err, history) => {
            if (err) return res.status(500).json({ error: err.message });
            result.history = history;

            // 2. Calculate Summary
            const summarySql = `
                SELECT 
                    SUM(ca.collected_amount) as totalGrossCod,
                    SUM(s.amount) as totalNetCollection,
                    COUNT(DISTINCT s.id) as totalReceipts
                FROM settlements s
                JOIN users u ON s.target_id = u.id
                JOIN courier_accounts ca ON ca.settlement_id = s.id
                WHERE u.branch_id = ? AND s.type = 'Courier'
            `;

            db.get(summarySql, [branchId], (err, summary) => {
                if (err) return res.status(500).json({ error: err.message });
                if (summary) {
                    result.summary.totalGrossCod = summary.totalGrossCod || 0;
                    result.summary.totalNetCollection = summary.totalNetCollection || 0;
                    result.summary.totalReceipts = summary.totalReceipts || 0;
                }

                // 2.5 Get Branch Payouts
                const payoutsSql = `
                    SELECT COALESCE(ABS(SUM(ft.amount)), 0) as totalPayouts
                    FROM financial_transactions ft
                    JOIN users u ON ft.user_id = u.id
                    WHERE u.branch_id = ? AND ft.type = 'Payout'
                `;
                
                db.get(payoutsSql, [branchId], (err, payoutRow) => {
                    if (err) return res.status(500).json({ error: err.message });
                    result.summary.totalPayouts = payoutRow ? payoutRow.totalPayouts : 0;
                    
                    // 2.6 Get Admin Collections (Funds transferred to HQ)
                    const adminCollectionSql = "SELECT SUM(amount) as total FROM settlements WHERE type='BRANCH' AND target_id = ?";
                    
                    db.get(adminCollectionSql, [branchId], (err, adminRow) => {
                        if (err) return res.status(500).json({ error: err.message });
                        const adminCollected = adminRow ? (adminRow.total || 0) : 0;
                        
                        // Net Balance = (Inflow - Payouts) - Transferred to Admin
                        result.summary.netBoxBalance = result.summary.totalGrossCod - result.summary.totalPayouts - adminCollected;
                        
                        // Proceed to 3
                        const lastMonthSql = `
                            SELECT SUM(ca.collected_amount) as lastMonthGross
                            FROM courier_accounts ca
                            JOIN users u ON ca.courier_id = u.id
                            WHERE u.branch_id = ? 
                            AND ca.status = 'SETTLED'
                            AND ca.created_at > date('now', '-30 days')
                        `;
                        
                        db.get(lastMonthSql, [branchId], (err, lastMonth) => {
                            if (err) return res.status(500).json({ error: err.message });
                            result.summary.lastMonthGross = lastMonth ? (lastMonth.lastMonthGross || 0) : 0;
                            res.json(result);
                        });
                    });
                });
            });
        });
    });
});


// Merchant Settlement Preview
app.get("/api/settlements/merchant/preview/:merchantId", (req, res) => {
    const merchantId = req.params.merchantId;
    
    
    db.serialize(() => {
        const orderSql = `SELECT id, order_number, paid_amount, amount, delivery_fee, created_at, shipment_number, customer_name, status 
                          FROM orders 
                          WHERE merchant_id = ? 
                          AND status IN ('Delivered', 'Partial Delivery', 'Returned', 'Returned to Merchant') 
                          AND (merchant_settlement_id IS NULL OR merchant_settlement_id = '')`;
        
        db.all(orderSql, [merchantId], (err, orders) => {
            if (err) return res.status(500).json({ error: err.message });
            
            let totalCollected = 0;
            let totalDeductions = 0;
            
            orders.forEach(o => {
                // Logic:
                // If Delivered: collected = paid_amount (if set) OR amount (legacy)
                // If Partial: collected = paid_amount
                // If Returned: collected = 0
                
                let collected = 0;
                let fee = o.delivery_fee || 0;

                if (o.status === 'Returned' || o.status === 'Returned to Merchant') {
                    collected = 0;
                    fee = 0; // Force fee to 0 for returns per user request
                } else if (o.status === 'Partial Delivery') {
                    collected = o.paid_amount || 0;
                } else {
                    // Delivered
                    collected = (o.paid_amount !== null && o.paid_amount !== undefined) ? o.paid_amount : (o.amount || 0);
                }
                
                // Override delivery_fee in the response object so frontend shows 0
                o.delivery_fee = fee;
                
                // Update the object for frontend consistency (so frontend doesn't need complex logic)
                o.calculated_collected = collected;
                o.calculated_net = collected - fee;

                totalCollected += collected;
                totalDeductions += fee;
            });
            
            const netAmount = totalCollected - totalDeductions;
            
            res.json({
                orders,
                summary: {
                    total_collected: totalCollected,
                    total_deductions: totalDeductions,
                    net_amount: netAmount
                }
            });
        });
    });
});

// Create Merchant Settlement
app.post("/api/settlements/merchant", (req, res) => {
    const { merchantId, amount, processedBy } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const settlementId = uuidv4();
    
    db.serialize(() => {
        // 1. Create Settlement Record
        db.run(`INSERT INTO settlements (id, type, target_id, amount, processed_by, period_end) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, 
               [settlementId, 'Merchant', merchantId, amount, processedBy], (err) => {
            if (err) return res.status(500).json({ error: err.message });

             // 2. Mark Orders as Settled
            // We select the same orders as preview to ensure consistency, 
            // verifying they are still unsettled.
             db.run(`UPDATE orders SET merchant_settlement_id = ? WHERE merchant_id = ? AND status IN ('Delivered', 'Partial Delivery', 'Returned', 'Returned to Merchant') AND (merchant_settlement_id IS NULL OR merchant_settlement_id = '')`, 
                    [settlementId, merchantId]);

            // 3. Record Financial Transaction (Payout)
            const transId = uuidv4();
            db.run(`INSERT INTO financial_transactions (id, user_id, amount, type, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                   [transId, merchantId, -amount, 'Settlement', `Settlement #${settlementId}`, processedBy]);

            // 4. Deduct from Merchant Balance
            db.run(`UPDATE merchant_details SET current_balance = current_balance - ? WHERE user_id = ?`, 
                   [amount, merchantId], (err) => {
                       if (err) console.error("Balance update error:", err);
                       res.json({ success: true, settlementId });
                   });
        });
    });
});

// Payout (Payment Receipt)
app.post("/api/finance/payout", (req, res) => {
    const { user_id, amount, notes, created_by } = req.body;
    const { v4: uuidv4 } = require('uuid');
    
    // Amount should be positive coming in, but we treat payout as deduction
    const payoutAmount = parseFloat(amount);
    if (!payoutAmount || payoutAmount <= 0) return res.status(400).json({ error: "Invalid amount" });

    db.serialize(() => {
        // 1. Record Transaction
        const transId = uuidv4();
        db.run(`INSERT INTO financial_transactions (id, user_id, amount, type, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
            [transId, user_id, -payoutAmount, 'Payout', notes, created_by], (err) => {
                if (err) return res.status(500).json({ error: err.message });

                // 2. Update Balance (Determine if Courier or Merchant)
                // Try updating Courier first
                db.run(`UPDATE courier_details SET current_balance = current_balance - ? WHERE user_id = ?`, [payoutAmount, user_id], function(err) {
                    if (this.changes === 0) {
                        // Not a courier, try Merchant
                         db.run(`UPDATE merchant_details SET current_balance = current_balance - ? WHERE user_id = ?`, [payoutAmount, user_id]);
                    }
                    res.json({ success: true, message: "Payout recorded successfully", transactionId: transId });
                });
            });
    });
});

// Reset Account Balance (Neutralize to 0)
app.post("/api/finance/reset-balance", (req, res) => {
    const { user_id, notes, created_by } = req.body;
    const { v4: uuidv4 } = require('uuid');

    db.serialize(() => {
        // 1. Get current balance first
        // Check courier_details
        db.get("SELECT current_balance FROM courier_details WHERE user_id = ?", [user_id], (err, courier) => {
            if (err) return res.status(500).json({ error: err.message });
            
            if (courier) {
                const balance = courier.current_balance;
                if (balance === 0) return res.json({ success: true, message: "Balance is already zero" });

                // Record transaction to neutralize
                const transId = uuidv4();
                db.run(`INSERT INTO financial_transactions (id, user_id, amount, type, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                    [transId, user_id, -balance, 'Adjustment (Reset)', notes || 'تصفير حساب يدوي', created_by], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        
                        db.run("UPDATE courier_details SET current_balance = 0 WHERE user_id = ?", [user_id], (err) => {
                            if (err) return res.status(500).json({ error: err.message });
                            res.json({ success: true, message: "Account reset successfully" });
                        });
                    });
            } else {
                // Check merchant_details
                db.get("SELECT current_balance FROM merchant_details WHERE user_id = ?", [user_id], (err, merchant) => {
                    if (err) return res.status(500).json({ error: err.message });
                    if (!merchant) return res.status(404).json({ error: "User not found" });

                    const balance = merchant.current_balance;
                    if (balance === 0) return res.json({ success: true, message: "Balance is already zero" });

                    const transId = uuidv4();
                    db.run(`INSERT INTO financial_transactions (id, user_id, amount, type, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                        [transId, user_id, -balance, 'Adjustment (Reset)', notes || 'تصفير حساب يدوي', created_by], (err) => {
                            if (err) return res.status(500).json({ error: err.message });
                            
                            db.run("UPDATE merchant_details SET current_balance = 0 WHERE user_id = ?", [user_id], (err) => {
                                if (err) return res.status(500).json({ error: err.message });
                                res.json({ success: true, message: "Account reset successfully" });
                            });
                        });
                });
            }
        });
    });
});

// --- Settings & Locations Routes ---

// Get All Locations
app.get("/api/locations", (req, res) => {
    db.all("SELECT * FROM locations ORDER BY name", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add Location
app.post("/api/locations", (req, res) => {
    const { name, base_price } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db.run("INSERT INTO locations (id, name, base_price) VALUES (?, ?, ?)", [id, name, base_price], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id, name, base_price });
    });
});


// Update Location
app.put("/api/locations/:id", (req, res) => {
    const { id } = req.params;
    const { name, base_price } = req.body;
    db.run("UPDATE locations SET name = ?, base_price = ? WHERE id = ?", [name, base_price, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Delete Location
app.delete("/api/locations/:id", (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM locations WHERE id = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Get System Settings
app.get("/api/settings", (req, res) => {
    db.all("SELECT * FROM system_settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Convert array of key-value pairs to object
        const settings = rows.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {});
        res.json(settings);
    });
});

// --- Dashboard Stats ---
app.get("/api/dashboard/stats", (req, res) => {
    db.serialize(() => {
        const result = {
            totalOrders: 0,
            activeUsers: 0,
            pendingIssues: 0,
            totalRevenue: 0
        };

        // 1. Total Orders (All non-deleted)
        db.get("SELECT COUNT(*) as count FROM orders WHERE status != 'Deleted'", (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            result.totalOrders = row.count;

            // 2. Active Users (Not deleted)
            db.get("SELECT COUNT(*) as count FROM users WHERE status IS NULL OR status != 'deleted'", (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                result.activeUsers = row.count;

                // 3. Pending Issues (Pending, Postponed, In Transit, With Courier, Partial Delivery)
                // This explicitly treats 'Postponed' as a pending issue/active task
                db.get("SELECT COUNT(*) as count FROM orders WHERE status IN ('Pending', 'Postponed', 'In Transit', 'With Courier', 'Partial Delivery')", (err, row) => {
                    if (err) return res.status(500).json({ error: err.message });
                    result.pendingIssues = row.count;

                    // 4. Total Revenue (Only Delivered and Partial Delivery)
                    db.get("SELECT SUM(delivery_fee) as total FROM orders WHERE status IN ('Delivered', 'Partial Delivery')", (err, row) => {
                        if (err) return res.status(500).json({ error: err.message });
                        result.totalRevenue = row.total || 0;

                        res.json(result);
                    });
                });
            });
        });
    });
});

// --- Admin Finance Overview ---
app.get("/api/admin/finance/overview", (req, res) => {
    const result = {
        totalRevenue: 0,
        totalMerchantLiability: 0,
        totalExpenses: 0,
        recentTransactions: []
    };

    db.serialize(() => {
        // 1. Total Revenue (Sum of delivery fees for Delivered and Partial Delivery orders)
        // Also consider courier commission overrides if applicable, but strictly speaking revenue is usually delivery_fee.
        // For simplicity: Revenue = Sum(delivery_fee)
        // 1. Total Revenue (Sum of delivery fees for Delivered and Partial Delivery orders)
        // Ensure we handle NULLs and strictly target the correct statuses
        db.get(`SELECT SUM(COALESCE(delivery_fee, 0)) as total FROM orders WHERE status IN ('Delivered', 'Partial Delivery')`, (err, row) => {
            if (err) { console.error(err); }
            result.totalRevenue = row?.total || 0;

            // 2. Total Merchant Liability (What we owe merchants: sum of positive balances in merchant_details)
            // Or simple sum of current_balance (if negative means they owe us, usually merchant balance is positive [we owe them])
            db.get(`SELECT SUM(current_balance) as total FROM merchant_details`, (err, row) => {
                if (err) { console.error(err); }
                result.totalMerchantLiability = row?.total || 0;

                // 3. Total Expenses
                db.get(`SELECT SUM(amount) as total FROM expenses WHERE status = 'Approved'`, (err, rowsExp) => {
                    if (err) { console.error(err); }
                    result.totalExpenses = rowsExp?.total || 0;
                    
                    // 3.5 Total Courier Commissions (Cost of Service)
                    // 3.5 Total Courier Commissions (Cost of Service)
                    // Updated: Use global setting * count of delivered/partial orders
                    db.get("SELECT value FROM system_settings WHERE key = 'default_commission'", (err, settingRow) => {
                        const defaultCommission = settingRow ? parseFloat(settingRow.value) : 0;
                        
                        db.get(`SELECT COUNT(*) as count FROM orders WHERE status IN ('Delivered', 'Partial Delivery')`, (err, rowsCount) => {
                             if (err) { console.error(err); }
                             const deliveredCount = rowsCount?.count || 0;
                             result.totalCourierCommissions = deliveredCount * defaultCommission;

                             // 4. Net System Balance (Box Balance)
                             // Sum of all financial transactions (Collections + Payouts)
                             db.get(`SELECT SUM(amount) as balance FROM financial_transactions`, (err, rowBalance) => {
                                 if (err) { console.error(err); }
                                 result.netSystemBalance = rowBalance?.balance || 0;

                                 // 5. Recent Transactions
                                 const transSql = `
                                     SELECT ft.*, 
                                            u.name as user_name, 
                                            u.role_id 
                                     FROM financial_transactions ft
                                     LEFT JOIN users u ON ft.user_id = u.id
                                     ORDER BY ft.created_at DESC 
                                     LIMIT 5
                                 `;
                                 db.all(transSql, (err, rows) => {
                                     if (err) { console.error(err); }
                                     result.recentTransactions = rows || [];
                                     
                                     res.json(result);
                                 });
                             });
                        });
                    });
                });
            });
        });
    });
});

// Update System Settings (Bulk)
app.post("/api/settings", (req, res) => {
    const settings = req.body; // Expect object { key: value, key2: value2 }
    db.serialize(() => {
        const stmt = db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)");
        Object.entries(settings).forEach(([key, value]) => {
            stmt.run([key, String(value)]);
        });
        stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// Upload Company Logo
app.post("/api/settings/logo", upload.single('logo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Use relative path for storage, but ensure it's accessible via /uploads/
    const logoPath = `/uploads/${req.file.filename}`;
    
    db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('company_logo', ?)", [logoPath], (err) => {
        if (err) {
            console.error("Logo DB Error:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, logoPath });
    });
});

// Get Expense Categories
app.get("/api/expenses/categories", (req, res) => {
    db.all("SELECT * FROM expense_categories", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add Expense Category
app.post("/api/expenses/categories", (req, res) => {
    const { name } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db.run("INSERT INTO expense_categories (id, name) VALUES (?, ?)", [id, name], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id, name });
    });
});

// --- Merchant Pricing Routes ---


// Get Merchant Pricing Overrides
app.get("/api/pricing/merchant/:merchantId", (req, res) => {
    const { merchantId } = req.params;
    db.all("SELECT * FROM merchant_pricing_overrides WHERE merchant_id = ?", [merchantId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Update Merchant Pricing (Upsert) - Pricing Tab Active
app.post("/api/pricing/merchant", (req, res) => {
    const { merchantId, province, price } = req.body;
    const { v4: uuidv4 } = require('uuid');
    
    db.get("SELECT id FROM merchant_pricing_overrides WHERE merchant_id = ? AND province = ?", [merchantId, province], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (row) {
            // Update
            db.run("UPDATE merchant_pricing_overrides SET price = ? WHERE id = ?", [price, row.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
        } else {
            // Insert
            const id = uuidv4();
            db.run("INSERT INTO merchant_pricing_overrides (id, merchant_id, province, price) VALUES (?, ?, ?, ?)", [id, merchantId, province, price], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
        }
    });
});



// Get Transaction Details (for Receipt)
app.get("/api/finance/transactions/:id", (req, res) => {
    const { id } = req.params;
    const query = `
        SELECT t.*, u.name as user_name, u.phone as user_phone 
        FROM financial_transactions t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.id = ?
    `;
    db.get(query, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Transaction not found" });
        res.json(row);
    });
});

// Get User Ledger (Statement of Account)
app.get("/api/finance/ledger/:id", (req, res) => {
    const { id } = req.params;
    
    // We need to fetch:
    // 1. Financial Transactions (Payouts, Adjustments)
    // 2. Orders (Commission for couriers, Revenue for merchants)
    
    db.serialize(() => {
        const transactionsQuery = `SELECT id, amount, type, notes, created_at, 'transaction' as source FROM financial_transactions WHERE user_id = ?`;
        
        db.all(transactionsQuery, [id], (err, transactions) => {
            if (err) return res.status(500).json({ error: err.message });

            // Detect Role to know what orders to fetch
            db.get("SELECT role_id FROM users WHERE id = ?", [id], (err, user) => {
                if (err) return res.status(500).json({ error: err.message });
                if (!user) return res.status(404).json({ error: "User not found" });

                db.get("SELECT name FROM roles WHERE id = ?", [user.role_id], (err, role) => {
                    if (err) return res.status(500).json({ error: err.message });
                    const roleName = role.name;

                    let ordersQuery = "";
                    let params = [];

                    if (roleName.includes('Courier')) {
                        ordersQuery = `
                            SELECT id, order_number, courier_commission as credit, 0 as debit, updated_at as created_at, status, 'order' as source 
                            FROM orders 
                            WHERE delivery_courier_id = ? AND status IN ('Delivered', 'Partial Delivery')
                        `;
                        params = [id];

                    } else if (roleName === 'Merchant') {
                        // Merchant: Get Delivered, Partial, and Returned
                        ordersQuery = `
                            SELECT id, order_number, amount, paid_amount, delivery_fee, status, updated_at as created_at, 'order' as source 
                            FROM orders 
                            WHERE merchant_id = ? AND status IN ('Delivered', 'Partial Delivery', 'Returned')
                        `;
                        params = [id];
                    }

                    if (ordersQuery) {
                        db.all(ordersQuery, params, (err, orders) => {
                            if (err) return res.status(500).json({ error: err.message });

                            // Format Transactions
                            const formattedTransactions = transactions.map(t => {
                                let typeName = t.type;
                                if (t.type === 'Collection') typeName = 'استلام';
                                else if (t.type === 'Payout') typeName = 'صرف';
                                else if (t.type === 'Settlement') typeName = 'تسوية';
                                else if (t.type === 'Adjustment (Reset)') typeName = 'تصفية حساب';

                                let noteText = t.notes || '';
                                if (noteText.includes('Settlement #')) {
                                    noteText = noteText.replace('Settlement #', 'تسوية رقم ');
                                }
                                
                                return {
                                    id: t.id,
                                    date: t.created_at,
                                    description: `${typeName}: ${noteText}`,
                                    amount: t.amount,
                                    type: 'transaction'
                                };
                            });

                            // Format Orders
                            const formattedOrders = orders.map(o => {
                                let netChange = 0;
                                let desc = `توصيل طلب #${o.order_number}`;
                                
                                if (roleName.includes('Courier')) {
                                    // Courier: Earning = Commission (Credit)
                                    // We ignore collected cash (debt) here because this "Ledger"
                                    // is usually viewed as "What the company owes me" (Commission) vs "What I paid" key?
                                    // Actually, if it's a "Statement of Account", it should be Balance.
                                    // Balance = Commission - CashHeld? 
                                    // For now, let's keep previous behavior: Commission is Credit. 
                                    // If we want Debt, we need to handle 'Collection' transaction which is Payout?
                                    
                                    netChange = o.credit || 0;
                                    if(o.status === 'Partial Delivery') desc += ' (تسليم جزئي)';
                                } else {
                                    // Merchant:
                                    // Revenue = Collected Amount - Delivery Fee
                                    const collected = o.paid_amount !== null ? o.paid_amount : o.amount;
                                    const fee = o.delivery_fee || 0;
                                    
                                    if (o.status === 'Returned') {
                                        netChange = 0;
                                        desc = `مرتجع طلب #${o.order_number}`;
                                    } else {
                                        netChange = collected - fee;
                                        if (o.status === 'Partial Delivery') desc += ' (تسليم جزئي)';
                                    }
                                }

                                return {
                                    id: o.id,
                                    date: o.created_at,
                                    description: desc,
                                    amount: netChange,
                                    type: 'order'
                                };
                            });

                            // Merge and Sort
                            const ledger = [...formattedTransactions, ...formattedOrders].sort((a, b) => new Date(b.date) - new Date(a.date));
                            res.json(ledger);
                        });
                    } else {
                        // Only transactions
                        res.json(transactions.map(t => ({
                             id: t.id,
                             date: t.created_at,
                             description: `${t.type}: ${t.notes || ''}`,
                             amount: t.amount,
                             type: 'transaction'
                        })).sort((a, b) => new Date(b.date) - new Date(a.date)));
                    }
                });
            });
        });
    });
});

// --- Dashboard Stats ---
app.get("/api/dashboard/stats", (req, res) => {
    db.serialize(() => {
        const stats = {};
        
        db.get("SELECT count(*) as count FROM orders", (err, row) => {
            if (err) return res.status(500).json({error: err.message});
            stats.totalOrders = row.count;
            
            db.get("SELECT count(*) as count FROM users", (err, row) => {
                if(err) return res.status(500).json({error: err.message});
                stats.activeUsers = row.count; // Simplification
                
                db.get(`
                    SELECT SUM(
                        CASE 
                            WHEN status = 'Delivered' THEN amount + delivery_fee 
                            WHEN status = 'Partial Delivery' THEN paid_amount 
                            ELSE 0 
                        END
                    ) as total 
                    FROM orders 
                    WHERE status IN ('Delivered', 'Partial Delivery')
                `, (err, row) => {
                    if(err) return res.status(500).json({error: err.message});
                    stats.totalRevenue = row.total || 0;
                    
                    db.get("SELECT count(*) as count FROM orders WHERE status = 'Pending'", (err, row) => {
                        stats.pendingIssues = row.count;
                        res.json(stats);
                    });
                });
            });
        });
    });
});

// --- Report Routes ---

app.get("/api/reports", (req, res) => {
    const { type, startDate, endDate, merchantId, courierId } = req.query;
    let query = "";
    let params = [];
    
    // Base Date Filter
    const start = startDate || '2000-01-01';
    // Append time to ensure full day coverage if only date is provided
    let end = endDate || '2099-12-31';
    if (end.length === 10) end += ' 23:59:59';

    switch (type) {
        case 'revenue':
            query = `
                SELECT date(created_at) as date, 
                       count(*) as total_orders, 
                       sum(delivery_fee) as gross_delivery_revenue,
                       sum(courier_commission) as total_commission_cost,
                       (sum(delivery_fee) - sum(courier_commission)) as net_revenue
                FROM orders 
                WHERE created_at BETWEEN ? AND ? 
                AND status IN ('Delivered', 'Partial Delivery')
            `;
            params = [start, end];
            if (merchantId) { query += " AND merchant_id = ?"; params.push(merchantId); }
            query += " GROUP BY date(created_at)";
            break;

        case 'courier_collections':
            query = `
                SELECT u.name as courier_name, 
                       count(*) as deliveries, 
                       sum(cod_collected_amount) as total_collected,
                       sum(courier_commission) as expected_commission
                FROM orders o
                JOIN users u ON o.delivery_courier_id = u.id
                WHERE o.created_at BETWEEN ? AND ? 
                AND o.status IN ('Delivered', 'Partial Delivery')
            `;
            params = [start, end];
            if (courierId) { query += " AND o.delivery_courier_id = ?"; params.push(courierId); }
            query += " GROUP BY o.delivery_courier_id";
            break;

        case 'merchant_dues':
             // Assumption: Merchant Due = (Order Amount - Delivery Fee)
             // Only for Delivered orders
             query = `
                SELECT u.name as merchant_name,
                       count(*) as completed_orders,
                       sum(amount) as total_sales,
                       sum(delivery_fee) as total_fees,
                       (sum(amount) - sum(delivery_fee)) as net_due
                FROM orders o
                JOIN users u ON o.merchant_id = u.id
                WHERE o.created_at BETWEEN ? AND ?
                AND o.status IN ('Delivered', 'Partial Delivery')
             `;
             params = [start, end];
             if (merchantId) { query += " AND o.merchant_id = ?"; params.push(merchantId); }
             query += " GROUP BY o.merchant_id";
             break;
             
        case 'returned':
            query = `
                SELECT o.*, u.name as merchant_name 
                FROM orders o 
                LEFT JOIN users u ON o.merchant_id = u.id
                WHERE o.created_at BETWEEN ? AND ? 
                AND o.status = 'Returned'
            `;
            params = [start, end];
            if (merchantId) { query += " AND o.merchant_id = ?"; params.push(merchantId); }
            query += " ORDER BY o.created_at DESC";
            break;

        case 'orders':
            query = `
                SELECT o.*, b.name as branch_name 
                FROM orders o 
                LEFT JOIN branches b ON o.branch_warehouse_id = b.id
                WHERE o.created_at BETWEEN ? AND ?
            `;
            params = [start, end];
            if (merchantId) { query += " AND o.merchant_id = ?"; params.push(merchantId); }
            if (courierId) { query += " AND o.delivery_courier_id = ?"; params.push(courierId); }
            query += " ORDER BY o.created_at DESC LIMIT 100";
            break;

        default:
            return res.status(400).json({ error: "Invalid report type" });
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Merchant Stats
app.get("/api/dashboard/merchant/stats", (req, res) => {
    const merchantId = req.query.merchant_id;
    if (!merchantId) return res.status(400).json({ error: "Merchant ID Required" });

    db.get(`SELECT 
            COUNT(CASE WHEN status NOT IN ('Delivered', 'Cancelled', 'Returned') THEN 1 END) as active_orders,
            COUNT(CASE WHEN status = 'Delivered' THEN 1 END) as delivered_orders,
            SUM(CASE WHEN status = 'Delivered' THEN amount ELSE 0 END) as total_revenue,
            (SELECT current_balance FROM merchant_details WHERE user_id = ?) as wallet_balance
            FROM orders WHERE merchant_id = ?`, 
            [merchantId, merchantId], 
            (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            activeOrders: row.active_orders || 0,
            deliveredOrders: row.delivered_orders || 0,
            totalRevenue: row.total_revenue || 0,
            walletBalance: row.wallet_balance || 0
        });
    });
});

// Finance Ledger
// Finance Ledger (Merged Orders & Transactions)
app.get("/api/finance/ledger", (req, res) => {
    const userId = req.query.user_id; 
    if (!userId) return res.json([]); 

    // Combine Orders (Income) and Transactions (Payouts/Adjustments)
    const sql = `
        SELECT 
            id, 
            order_number, 
            'deposit' as type, 
            amount, 
            created_at 
        FROM orders 
        WHERE merchant_id = ? AND status IN ('Delivered', 'Partial Delivery')

        UNION ALL

        SELECT 
            id, 
            NULL as order_number, 
            CASE 
                WHEN type = 'Payout' THEN 'payout'
                WHEN type = 'Settlement' THEN 'payout'
                WHEN type = 'Collection' THEN 'deposit'
                ELSE 'transaction'
            END as type, 
            amount, 
            created_at 
        FROM financial_transactions 
        WHERE user_id = ?
        
        ORDER BY created_at DESC
    `;

    db.all(sql, [userId, userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post("/api/finance/withdraw", (req, res) => {
    const { user_id, amount, is_full_balance } = req.body;
    
    // 1. Get Current Balance
     db.get(`SELECT 
            SUM(CASE WHEN status = 'Delivered' THEN amount ELSE 0 END) as total_revenue,
            (SELECT IFNULL(SUM(amount), 0) FROM financial_transactions WHERE user_id = ? AND type = 'Payout') as total_payouts
            FROM orders WHERE merchant_id = ?`, 
            [user_id, user_id], (err, row) => {
                
        if (err) return res.status(500).json({ error: err.message });
        
        // Use a more robust balance check if possible (e.g. merchant_details table if synced, but for now calculate on fly)
        // Note: Logic in 'dashboard/stats' uses 'merchant_details.current_balance'. 
        // We should trust 'merchant_details' if it's being maintained, OR recalculate.
        // Let's recalculate based on Order Revenue - Payouts for safety in this demo context.
        // Actually, let's just use the `merchant_details` balance if available, or recalc.
        // The dashboard stats query uses: `(SELECT current_balance FROM merchant_details WHERE user_id = ?)`.
        
        db.get("SELECT current_balance FROM merchant_details WHERE user_id = ?", [user_id], (err, balRow) => {
            if (err) return res.status(500).json({ error: err.message });
            
            let currentBalance = balRow ? balRow.current_balance : 0;
            
            // If requesting full balance, check if > 0
            let withdrawAmount = amount;
            if (is_full_balance) {
                withdrawAmount = currentBalance;
            }

            if (withdrawAmount <= 0) {
                return res.status(400).json({ error: "الرصيد غير كافي للسحب" });
            }
            if (withdrawAmount > currentBalance) {
                 return res.status(400).json({ error: "المبلغ المطلوب أكبر من الرصيد المتاح" });
            }

            // Create Transaction
            // We'll create it as 'Payout' with status 'Pending' 
            const { v4: uuidv4 } = require('uuid');
            const id = uuidv4();
            
            // Start Transaction to update balance and insert record
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                
                const stmt = db.prepare("INSERT INTO financial_transactions (id, user_id, type, amount, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
                stmt.run(id, user_id, 'Payout', -withdrawAmount, 'صرف مبلغ من الرصيد', 'Pending', user_id, (err) => {
                    if (err) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err.message });
                    }
                    
                    // Deduct from Balance immediately? 
                    // Usually pending requests hold the funds.
                    // For this system, let's deduct it so it doesn't get double-spent.
                    // If rejected, we refund it.
                     db.run("UPDATE merchant_details SET current_balance = current_balance - ? WHERE user_id = ?", [withdrawAmount, user_id], (err) => {
                         if (err) {
                             db.run("ROLLBACK");
                             return res.status(500).json({ error: err.message });
                         }
                         db.run("COMMIT");
                         res.json({ 
                             success: true, 
                             message: "تم صرف المبلغ بنجاح",
                             transaction: {
                                 id,
                                 user_id,
                                 type: 'payout',
                                 amount: -withdrawAmount,
                                 description: 'صرف مبلغ من الرصيد',
                                 status: 'Pending',
                                 created_at: new Date().toISOString()
                             }
                         });
                     });
                });
                stmt.finalize();
            });
        });
    });
});

// --- User Management & Security ---

// Helper: Check Permission
const checkPermission = (userId, requiredPermission) => {
    return new Promise((resolve, reject) => {
        // 1. Check User Overrides first
        db.get("SELECT mode FROM user_overrides WHERE user_id = ? AND permission_code = ?", [userId, requiredPermission], (err, override) => {
            if (err) return reject(err);
            
            if (override) {
                if (override.mode === 'deny') return resolve(false);
                if (override.mode === 'allow') return resolve(true);
            }

            // 2. Check Role Permissions
            const query = `
                SELECT 1 FROM role_permissions rp
                JOIN users u ON u.role_id = rp.role_id
                WHERE u.id = ? AND rp.permission_code = ?
            `;
            db.get(query, [userId, requiredPermission], (err, row) => {
                if (err) return reject(err);
                resolve(!!row);
            });
        });
    });
};

// 1. Get Roles
app.get("/api/roles", (req, res) => {
    db.all("SELECT * FROM roles", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. Get All Permissions (Catalog)
app.get("/api/permissions", (req, res) => {
    db.all("SELECT * FROM permissions ORDER BY code", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Group by module for UI convenience
        const grouped = rows.reduce((acc, p) => {
            const [module, screen, action] = p.code.split('.');
            if (!acc[module]) acc[module] = [];
            acc[module].push({ ...p, module, screen, action });
            return acc;
        }, {});
        
        res.json(grouped);
    });
});

// 3. User Management Routes

// GET Users (with search/filter)
app.get("/api/users", (req, res) => {
    const { role_id, status, search } = req.query;
    let query = `
        SELECT u.id, u.name, u.username, u.phone, u.email, u.status, u.role_id, r.name as role_name, u.branch_id
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE 1=1
    `;
    const params = [];

    // Filter by Role ID (if it's a valid ID and not 'All')
    // Note: The UI sends 'All' or a UUID. 
    // We assume Role Names are not passed here, but IDs. 
    // However, if the user requested specifically standard roles, we might need to join/lookup.
    // For now, assuming ID is passed.
    if (role_id && role_id !== 'All') {
        query += " AND u.role_id = ?";
        params.push(role_id);
    }
    if (status && status !== 'All') {
        query += " AND u.status = ?";
        params.push(status);
    }
    if (search) {
        query += " AND (u.name LIKE ? OR u.username LIKE ? OR u.phone LIKE ?)";
        const term = `%${search}%`;
        params.push(term, term, term);
    }

    query += " ORDER BY u.created_at DESC";

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST User
app.post("/api/users", async (req, res) => {
    const { name, username, phone, email, role_id, branch_id, created_by, password } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const bcrypt = require('bcryptjs');

    if (!name || !username || !role_id) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const passwordHash = await bcrypt.hash(password || '123456', 10); // Use provided or default
        const id = uuidv4();
        
        const now = new Date().toISOString();

        db.run(`INSERT INTO users (id, name, username, phone, email, role_id, branch_id, password_hash, status, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
                [id, name, username, phone, email, role_id, branch_id, passwordHash, now, now], 
                function(err) {
                    if (err) {
                        console.error('CREATE USER SQL ERROR:', err);
                        if (err.message.includes('UNIQUE')) {
                            return res.status(400).json({ error: 'اسم المستخدم مستخدم مسبقًا، يرجى اختيار اسم آخر' });
                        }
                        return res.status(500).json({ error: 'خطأ في قاعدة البيانات: ' + err.message });
                    }
                    
                    if (created_by) logAudit(created_by, 'create_user', 'user', id, { name, username, role_id });
                    
                    res.json({ id, message: "تم إنشاء المستخدم بنجاح" });
                });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT User (Update Basic Info & Status)
app.put("/api/users/:id", (req, res) => {
    const { id } = req.params;
    const { name, phone, email, role_id, branch_id, status, updated_by } = req.body;

    const query = `
        UPDATE users SET name = ?, phone = ?, email = ?, role_id = ?, branch_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;
    
    db.run(query, [name, phone, email, role_id, branch_id, status, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        if (updated_by) logAudit(updated_by, 'update_user', 'user', id, req.body);
        res.json({ success: true });
    });
});

// GET User Permissions (Effective Matrix)
app.get("/api/users/:id/permissions", (req, res) => {
    const { id } = req.params;
    
    const query = `
        SELECT p.code, 'role' as source, 'allow' as mode
        FROM role_permissions rp
        JOIN users u ON u.role_id = rp.role_id
        JOIN permissions p ON rp.permission_code = p.code
        WHERE u.id = ?
        UNION ALL
        SELECT permission_code as code, 'override' as source, mode
        FROM user_overrides
        WHERE user_id = ?
    `;
    
    db.all(query, [id, id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST Set User Overrides
app.post("/api/users/:id/permissions", (req, res) => {
    const { id } = req.params;
    const { overrides, updated_by } = req.body; // overrides: [{ code: 'x', mode: 'allow'|'deny' }]

    db.serialize(() => {
        const stmt = db.prepare("INSERT OR REPLACE INTO user_overrides (user_id, permission_code, mode) VALUES (?, ?, ?)");
        
        overrides.forEach(ov => {
            stmt.run(id, ov.code, ov.mode);
        });
        stmt.finalize();
        
        if (updated_by) logAudit(updated_by, 'update_permissions', 'user', id, { count: overrides.length });
        res.json({ success: true });
    });
});
// DELETE User (Soft Delete)
app.delete("/api/users/:id", (req, res) => {
    const { id } = req.params;
    const { deleted_by } = req.body; // Pass who is deleting

    // 1. Prevent Self-Deletion
    if (deleted_by === id) {
        return res.status(400).json({ error: "لا يمكنك حذف حسابك الشخصي" });
    }

    // 2. Soft Delete User
    const query = `UPDATE users SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    
    db.run(query, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "User not found" });

        // Audit log
        if (deleted_by) logAudit(deleted_by, 'delete_user', 'user', id, { status: 'deleted' });
        
        // Update child tables
        db.run("UPDATE courier_details SET status = 'Deleted' WHERE user_id = ?", [id]);
        db.run("UPDATE merchant_details SET status = 'Deleted' WHERE user_id = ?", [id]);

        res.json({ success: true, message: "تم حذف المستخدم بنجاح" });
    });
});

// GET Audit Logs
app.get("/api/audit-logs", (req, res) => {
    const query = `
        SELECT l.*, u.name as actor_name 
        FROM audit_logs l
        LEFT JOIN users u ON l.actor_id = u.id
        ORDER BY l.created_at DESC
        LIMIT 100
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET Courier Ledger
app.get("/api/courier-ledger", (req, res) => {
    const { courier_id } = req.query;
    if (!courier_id) return res.status(400).json({ error: "Courier ID required" });

    // 1. Fetch Default Commission Setting
    db.get("SELECT value FROM system_settings WHERE key = 'default_commission'", (err, settingRow) => {
        if (err) console.error("Error fetching default commission:", err);
        const defaultCommission = settingRow ? parseFloat(settingRow.value) : 0;

        // 2. Fetch Ledger Data
        const query = `
            SELECT ca.*, o.order_number, o.status as order_status, o.delivery_fee, o.paid_amount
            FROM courier_accounts ca
            JOIN orders o ON ca.order_id = o.id
            WHERE ca.courier_id = ?
            ORDER BY ca.created_at DESC
        `;

        db.all(query, [courier_id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // 3. Apply Default Commission Override (Sync with Admin Settings)
            const syncedRows = rows.map(row => ({
                ...row,
                // Override commission_amount with the global setting if it's a COLLECTION type (Linked to an order delivery)
                // We keep the original if for some reason it's a different transaction type, but for now assumption is mainly order collections.
                commission_amount: (row.transaction_type === 'COLLECTION') ? defaultCommission : row.commission_amount
            }));

            res.json(syncedRows);
        });
    });
});

// MASTER RESET: Purge all orders and financial data (DANGEROUS)
app.post("/api/admin/reset-system-data", (req, res) => {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        try {
            db.run("DELETE FROM orders");
            db.run("DELETE FROM order_items");
            db.run("DELETE FROM order_history");
            db.run("DELETE FROM courier_accounts");
            db.run("DELETE FROM financial_transactions");
            db.run("DELETE FROM settlements");
            db.run("DELETE FROM expenses");
            db.run("DELETE FROM audit_logs");
            
            // Reset sequences
            db.run("UPDATE sequences SET value = 10000 WHERE name = 'orders'");
            
            // Reset balances
            db.run("UPDATE courier_details SET current_balance = 0");
            db.run("UPDATE merchant_details SET current_balance = 0");
            db.run("UPDATE company_financials SET total_revenue = 0, total_expenses = 0, current_balance = 0 WHERE id = 'MAIN'");
            
            db.run("COMMIT");
            res.json({ success: true, message: "System data reset successfully" });
        } catch (err) {
            db.run("ROLLBACK");
            res.status(500).json({ error: err.message });
        }
    });
});

// --- Expenses ---

// GET Expense Categories
app.get("/api/expenses/categories", (req, res) => {
    db.all("SELECT * FROM expense_categories ORDER BY name", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST Expense Category
app.post("/api/expenses/categories", (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const id = require('uuid').v4();
    db.run("INSERT INTO expense_categories (id, name) VALUES (?, ?)", [id, name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id });
    });
});

// GET Expenses
app.get("/api/expenses", (req, res) => {
    const query = `
        SELECT e.*, ec.name as category_name, u.name as user_name
        FROM expenses e
        LEFT JOIN expense_categories ec ON e.category_id = ec.id
        LEFT JOIN users u ON e.user_id = u.id
        ORDER BY e.created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST Expense
app.post("/api/expenses", (req, res) => {
    const { user_id, category_id, amount, description, status } = req.body;
    const items = [user_id, category_id, amount, description, status || 'Pending'];
    const id = require('uuid').v4();
    
    db.run(`INSERT INTO expenses (id, user_id, category_id, amount, description, status) 
            VALUES (?, ?, ?, ?, ?, ?)`, 
            [id, ...items], 
            function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // If approved and it's a company expense, update financials (Optional, skipping complexity for now)
        res.json({ success: true, id });
    });
});

// --- System Backup & Restore ---

// Backup Endpoint
app.get("/api/admin/backup", (req, res) => {
    try {
        const file = dbPath || path.resolve(__dirname, 'delivery_system.db');
        res.download(file, `backup_${new Date().toISOString().split('T')[0]}.db`);
    } catch (err) {
        res.status(500).json({ error: "Failed to create backup: " + err.message });
    }
});

// Restore Endpoint
app.post("/api/admin/restore", upload.single('backup'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const tempPath = req.file.path;
    const targetPath = dbPath || path.resolve(__dirname, 'delivery_system.db');

    // Close current connection
    db.close((err) => {
        if (err) {
            console.error("Error closing DB:", err);
            return res.status(500).json({ error: "Failed to close database connection" });
        }

        // Replace file
        fs.copyFile(tempPath, targetPath, (copyErr) => {
            // Reconnect regardless of success to keep server alive
            db = reconnectDatabase();
            
            if (copyErr) {
                console.error("Error replacing DB file:", copyErr);
                return res.status(500).json({ error: "Failed to replace database file" });
            }

            // Cleanup temp file
            fs.unlink(tempPath, () => {});

            res.json({ success: true, message: "System restored successfully. Please refresh the page." });
        });
    });
});


// --- Branch Financials ---

// Get Branch Incomes (Funds available to collect)
app.get("/api/financials/branch-incomes", async (req, res) => {
    const { branch_id } = req.query; // Optional filter

    // Promisify
    const dbAll = (sql, params) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });

    try {
        let branchesQuery = "SELECT id, name, manager_name FROM branches";
        let params = [];
        if (branch_id) {
            branchesQuery += " WHERE id = ?";
            params.push(branch_id);
        }

        const branches = await dbAll(branchesQuery, params);
        
        const report = [];

        for (const branch of branches) {
            const branchId = branch.id;

            // 1. Gross Inflow (Total COD Collected from Couriers)
            // Matches Branch Portal: SUM(ca.collected_amount) linked to Courier Settlements
            const inflowSql = `
                SELECT 
                    SUM(ca.collected_amount) as totalGrossCod 
                FROM settlements s
                JOIN users u ON s.target_id = u.id
                JOIN courier_accounts ca ON ca.settlement_id = s.id
                WHERE u.branch_id = ? AND s.type = 'Courier'
            `;
            const inflowRow = await dbAll(inflowSql, [branchId]);
            const grossInflow = inflowRow[0]?.totalGrossCod || 0;

            // 2. Payouts (Expenses/Commissions paid by Branch)
            const payoutsSql = `
                SELECT COALESCE(ABS(SUM(ft.amount)), 0) as totalPayouts
                FROM financial_transactions ft
                JOIN users u ON ft.user_id = u.id
                WHERE u.branch_id = ? AND ft.type = 'Payout'
            `;
            const payoutsRow = await dbAll(payoutsSql, [branchId]);
            const payouts = payoutsRow[0]?.totalPayouts || 0;
            
            // 3. Admin Collections (Transferred to HQ)
            const adminSql = "SELECT SUM(amount) as total FROM settlements WHERE type='BRANCH' AND target_id = ?";
            const adminRow = await dbAll(adminSql, [branchId]);
            const adminCollected = adminRow[0]?.total || 0;

            // 4. Net Balance Calculation
            // Branch Portal "Net Box Balance" = Gross Inflow - Payouts
            // Admin View "Current Balance" = (Gross Inflow - Payouts) - Admin Collected
            const currentBalance = (grossInflow - payouts) - adminCollected;

            report.push({
                branch_id: branch.id,
                branch_name: branch.name,
                manager_name: branch.manager_name,
                total_inflow: grossInflow, // Total Collected from Couriers
                total_payouts: payouts,    // Commissions/Expenses
                total_outflow: adminCollected, // Transferred to Admin
                current_balance: currentBalance // Final Cash in Branch Box
            });
        }

        res.json(report);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Collect Fund from Branch
app.post("/api/financials/collect-branch-fund", (req, res) => {
    const { branch_id, amount, notes, created_by } = req.body;
    const { v4: uuidv4 } = require('uuid');

    if (!branch_id || !amount) return res.status(400).json({ error: "Branch and Amount required" });

    const id = uuidv4();
    const now = new Date().toISOString();

    db.serialize(() => {
        db.run(`INSERT INTO settlements (id, type, target_id, amount, status, created_at, processed_by) 
                VALUES (?, 'BRANCH', ?, ?, 'Completed', ?, ?)`,
                [id, branch_id, amount, now, created_by || 'Admin'], 
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    // Also add to Company Financial Box (as Admin Deposit)
                    const transId = uuidv4();
                    db.run(`INSERT INTO financial_transactions (id, user_id, type, amount, description, created_at, created_by, status)
                            SELECT ?, id, 'Deposit', ?, ?, ?, 'System', 'Completed' FROM users WHERE role = 'admin' LIMIT 1`,
                            [transId, amount, notes || 'Branch Fund Collection', now],
                            (err) => {
                                if (err) console.error("Error creating admin transaction:", err);
                                res.json({ success: true, id });
                            });
                });
    });
});

// Fallback route for React Router (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
