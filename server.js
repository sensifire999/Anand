const express = require('express');
const cookieSession = require('cookie-session'); 
const bodyParser = require('body-parser');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const TelegramBot = require('node-telegram-bot-api');

const adapter = new FileSync('db.json');
const db = low(adapter);
db.defaults({ products: [], orders: [], verified_users: [] }).write();

const BOT_TOKEN = '8392502310:AAHr3dJqe-fhbm8CrTnxeJOQ5en4doNg4H8'; 
const ADMIN_TELEGRAM_ID = 8084057668; 
const ADMIN_PHONE = "9041572652"; 

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(cookieSession({
    name: 'session',
    keys: ['luxe-secret-2026'],
    maxAge: 30 * 24 * 60 * 60 * 1000 
}));

// Middlewares
app.use((req, res, next) => {
    res.locals.user = req.session.phone || null;
    res.locals.cart = req.session.cart || [];
    res.locals.cartCount = (req.session.cart || []).length;
    next();
});

const isAuth = (req, res, next) => {
    if (req.session.verified) return next();
    res.redirect('/user-login');
};

const isAdmin = (req, res, next) => {
    if (req.session.verified && String(req.session.phone) === ADMIN_PHONE) return next();
    res.status(403).send("Admin Access Denied");
};

// --- ROUTES ---

// Search
app.get('/search', isAuth, (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const results = db.get('products').value().filter(p => p.name.toLowerCase().includes(q));
    res.render('index', { products: results, searchQuery: q });
});

// Auth
app.get('/user-login', (req, res) => res.render('user-login'));
app.post('/initiate-verify', (req, res) => {
    req.session.tempPhone = req.body.phone.replace(/\D/g, '').slice(-10);
    res.redirect('/telegram-verify');
});
app.get('/telegram-verify', (req, res) => res.render('telegram-verify', { error: null }));
// Jab user /start likhega tab ye button dikhega
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Welcome to LuxeStore! 🔐\n\nPlease share your contact to verify your identity.", {
        reply_markup: {
            keyboard: [
                [{
                    text: "📲 Share Contact",
                    request_contact: true // Ye line button ko contact share karne wala banati hai
                }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    });
});

// Baaki ka contact handle karne wala code wahi rahega jo pehle tha
bot.on('contact', (msg) => {
    const phone = msg.contact.phone_number.replace(/\D/g, '').slice(-10);
    const otp = Math.floor(1000 + Math.random() * 9000);
    db.get('verified_users').remove({ phone }).write();
    db.get('verified_users').push({ phone, otp }).write();
    bot.sendMessage(msg.chat.id, `🔐 Your LuxeStore OTP is: ${otp}`);
});


app.post('/verify-otp', (req, res) => {
    const { otp } = req.body;
    const phone = req.session.tempPhone;
    const user = db.get('verified_users').find({ phone, otp: parseInt(otp) }).value();
    if (user) {
        req.session.verified = true;
        req.session.phone = phone;
        res.redirect('/');
    } else res.render('telegram-verify', { error: "Wrong OTP!" });
});

// Home & Product
app.get('/', isAuth, (req, res) => res.render('index', { products: db.get('products').value(), searchQuery: null }));
app.get('/product/:id', isAuth, (req, res) => {
    const product = db.get('products').find(p => String(p.id) === String(req.params.id)).value();
    if (product) res.render('product-detail', { product });
    else res.redirect('/');
});

// Cart
app.post('/add-to-cart', (req, res) => {
    const product = db.get('products').find(p => String(p.id) === String(req.body.productId)).value();
    if (product) {
        req.session.cart = req.session.cart || [];
        req.session.cart.push(product);
        res.json({ success: true, cartCount: req.session.cart.length });
    } else res.json({ success: false });
});
app.get('/cart', isAuth, (req, res) => res.render('cart', { items: req.session.cart || [] }));

// Checkout
app.get('/checkout', isAuth, (req, res) => {
    if (!req.session.cart || req.session.cart.length === 0) return res.redirect('/cart');
    res.render('checkout', { items: req.session.cart });
});
app.post('/process-checkout', isAuth, (req, res) => {
    const { fullname, address, paymentMethod } = req.body;
    const cart = req.session.cart;
    const total = cart.reduce((a, b) => a + parseInt(b.price), 0);
    const advance = (paymentMethod === 'Online' ? total * 0.95 : total * 0.20).toFixed(2);
    req.session.tempOrder = { fullname, address, totalPrice: total, advance, items: cart, paymentMethod, phone: req.session.phone };
    res.redirect('/payment-gateway');
});
app.get('/payment-gateway', isAuth, (req, res) => res.render('payment-gateway', { orderData: req.session.tempOrder }));

app.post('/place-order', isAuth, (req, res) => {
    const { utr } = req.body;
    const temp = req.session.tempOrder;
    if (!temp) return res.redirect('/cart');
    const orderId = Math.floor(100000 + Math.random() * 900000);
    const finalOrder = { id: orderId, ...temp, utr, status: "🕒 PENDING", date: new Date().toLocaleDateString('en-IN') };
    db.get('orders').push(finalOrder).write();

    const itemsNames = temp.items.map(i => `• ${i.name}`).join('\n');
    bot.sendMessage(ADMIN_TELEGRAM_ID, `📦 *NEW ORDER #${orderId}*\n👤 *Name:* ${temp.fullname}\n📞 *Phone:* ${temp.phone}\n🛒 *Items:*\n${itemsNames}\n💰 *Total:* ₹${temp.totalPrice}\n🔑 *UTR:* ${utr}`, { parse_mode: 'Markdown' });

    req.session.cart = [];
    req.session.tempOrder = null;
    res.render('order-success', { orderId });
});

// Profile & Order Tracking (FIXED)
app.get('/profile', isAuth, (req, res) => res.render('profile', { phone: req.session.phone }));
app.get('/my-orders', isAuth, (req, res) => {
    const orders = db.get('orders').filter({ phone: req.session.phone }).value() || [];
    res.render('my-orders', { orders: orders.reverse() });
});

// TRACKING ROUTE - Yahan fix kiya hai
app.get('/order-track/:id', isAuth, (req, res) => {
    const orderId = req.params.id;
    const order = db.get('orders').find(o => String(o.id) === String(orderId)).value();
    if (order) res.render('order-track', { order });
    else res.status(404).send("Order Not Found. Please check ID.");
});

// Admin
app.get('/admin', isAuth, isAdmin, (req, res) => {
    const orders = db.get('orders').value() || [];
    const stats = {
        sales: orders.reduce((s, o) => s + parseFloat(o.totalPrice || 0), 0).toFixed(2),
        ordersCount: orders.length,
        users: db.get('verified_users').size().value()
    };
    res.render('admin', { products: db.get('products').value(), orders: orders.reverse(), stats });
});

app.post('/admin/add-product', isAuth, isAdmin, (req, res) => {
    const { name, price, images, desc } = req.body;
    db.get('products').push({ id: Date.now().toString(), name, price: parseInt(price), images: images.split(','), desc }).write();
    res.redirect('/admin');
});

app.post('/admin/update-status', isAuth, isAdmin, (req, res) => {
    db.get('orders').find(o => String(o.id) === String(req.body.orderId)).assign({ status: req.body.status }).write();
    res.json({ success: true });
});

app.post('/admin/delete-product', isAuth, isAdmin, (req, res) => {
    db.get('products').remove({ id: String(req.body.id) }).write();
    res.json({ success: true });
});

app.get('/logout', (req, res) => { req.session = null; res.redirect('/user-login'); });

app.listen(process.env.PORT || 3000, () => console.log("🚀 LUXESTORE LIVE"));

