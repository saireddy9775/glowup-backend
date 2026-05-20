require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const app = express();
const PORT = process.env.PORT || 3000;

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error("❌ Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in .env");
  process.exit(1);
}

const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });

app.use(cors());
app.use(express.json());

const salons = [
  { id: 1, name: "Glamour Studio",   location: "Koramangala, Bengaluru", rating: 4.8, reviews: 312, image: "https://images.unsplash.com/photo-1560066984-138daaa0ce98?w=600&q=80" },
  { id: 2, name: "The Style Lounge", location: "Indiranagar, Bengaluru",  rating: 4.5, reviews: 189, image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&q=80" },
  { id: 3, name: "Bliss Salon",      location: "HSR Layout, Bengaluru",   rating: 4.6, reviews: 247, image: "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=600&q=80" },
];
let nextSalonId = 4;

const salonOwners = [];

const services = [
  { id: 100, salonId: 1, name: "Test Payment ₹1", duration: 5,  price: 1    },
  { id: 101, salonId: 1, name: "Haircut",        duration: 30, price: 499  },
  { id: 102, salonId: 1, name: "Hair Colouring",  duration: 90, price: 1999 },
  { id: 103, salonId: 1, name: "Facial",          duration: 60, price: 999  },
  { id: 201, salonId: 2, name: "Haircut",          duration: 30, price: 399  },
  { id: 202, salonId: 2, name: "Manicure",         duration: 45, price: 599  },
  { id: 203, salonId: 2, name: "Head Massage",     duration: 30, price: 349  },
  { id: 301, salonId: 3, name: "Haircut",          duration: 30, price: 449  },
  { id: 302, salonId: 3, name: "Pedicure",         duration: 45, price: 649  },
  { id: 303, salonId: 3, name: "Full Body Waxing", duration: 60, price: 1499 },
];

const users = [];
let nextUserId = 1;

const bookings = [];
let nextBookingId = 1;

// ── Auth ──────────────────────────────────────────────────
app.post("/auth/register", (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || !phone)
    return res.status(400).json({ success: false, message: "All fields are required" });
  if (users.find((u) => u.email === email))
    return res.status(400).json({ success: false, message: "Email already registered" });
  const user = { id: nextUserId++, name, email, password, phone, wallet: 500 };
  users.push(user);
  const { password: _, ...safe } = user;
  res.status(201).json({ success: true, user: safe });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ success: false, message: "Invalid email or password" });
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

// ── Wallet ────────────────────────────────────────────────
app.post("/wallet/deduct", (req, res) => {
  const { userId, amount } = req.body;
  const user = users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  if (user.wallet < amount) return res.status(400).json({ success: false, message: "Insufficient wallet balance" });
  user.wallet -= amount;
  res.json({ success: true, balance: user.wallet });
});

app.post("/wallet/topup", (req, res) => {
  const { userId, amount } = req.body;
  const user = users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  user.wallet += amount;
  res.json({ success: true, balance: user.wallet });
});

// ── Razorpay ──────────────────────────────────────────────
// Step 1: Frontend calls this to create an order before showing payment UI
app.post("/razorpay/create-order", async (req, res) => {
  const { amount } = req.body; // amount in INR (e.g. 499)
  if (!amount) return res.status(400).json({ success: false, message: "Amount is required" });
  try {
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Razorpay expects paise (1 INR = 100 paise)
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    });
    res.json({ success: true, order, key: RAZORPAY_KEY_ID });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create payment order" });
  }
});

// Step 2: Frontend calls this after payment to verify it's genuine
app.post("/razorpay/verify-payment", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");
  if (expected === razorpay_signature) {
    res.json({ success: true, message: "Payment verified" });
  } else {
    res.status(400).json({ success: false, message: "Payment verification failed — signature mismatch" });
  }
});

// ── Salons ────────────────────────────────────────────────
app.get("/salons", (_req, res) => {
  res.json({ success: true, data: salons });
});

app.post("/salons/register", (req, res) => {
  const { salonName, ownerName, email, phone, password, address, city, categories } = req.body;
  if (!salonName || !email || !password)
    return res.status(400).json({ success: false, message: "Salon name, email and password are required" });
  if (salonOwners.find((o) => o.email === email))
    return res.status(400).json({ success: false, message: "Email already registered" });

  const location = [address, city].filter(Boolean).join(", ") || "India";
  const defaultImages = [
    "https://images.unsplash.com/photo-1560066984-138daaa0ce98?w=600&q=80",
    "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&q=80",
    "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=600&q=80",
    "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=600&q=80",
    "https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?w=600&q=80",
  ];
  const image = defaultImages[nextSalonId % defaultImages.length];

  const salon = { id: nextSalonId++, name: salonName, location, rating: 0, reviews: 0, image };
  salons.push(salon);

  const owner = { id: salon.id, salonId: salon.id, ownerName, email, phone, password, categories };
  salonOwners.push(owner);

  res.status(201).json({ success: true, message: "Salon registered successfully", data: salon });
});

app.post("/salons/login", (req, res) => {
  const { email, password } = req.body;
  const owner = salonOwners.find((o) => o.email === email && o.password === password);
  if (!owner) return res.status(401).json({ success: false, message: "Invalid email or password" });
  const salon = salons.find((s) => s.id === owner.salonId);
  const { password: _, ...safe } = owner;
  res.json({ success: true, owner: safe, salon });
});

app.get("/services/:salonId", (req, res) => {
  const salonId = parseInt(req.params.salonId);
  const salon = salons.find((s) => s.id === salonId);
  if (!salon) return res.status(404).json({ success: false, message: "Salon not found" });
  const salonServices = services.filter((s) => s.salonId === salonId);
  res.json({ success: true, salon: salon.name, image: salon.image, data: salonServices });
});

app.post("/bookings", (req, res) => {
  const { customerName, phone, salonId, serviceId, date, time, paymentMethod, paymentId, orderId } = req.body;
  if (!customerName || !phone || !salonId || !serviceId || !date || !time) {
    return res.status(400).json({ success: false, message: "All fields are required: customerName, phone, salonId, serviceId, date, time" });
  }
  const salon = salons.find((s) => s.id === salonId);
  if (!salon) return res.status(404).json({ success: false, message: "Salon not found" });
  const service = services.find((s) => s.id === serviceId && s.salonId === salonId);
  if (!service) return res.status(404).json({ success: false, message: "Service not found for this salon" });
  const booking = {
    id: nextBookingId++,
    customerName, phone,
    salon: salon.name,
    service: service.name,
    price: service.price,
    duration: `${service.duration} mins`,
    date, time,
    paymentMethod: paymentMethod || "cash",
    paymentId:     paymentId     || null,
    orderId:       orderId       || null,
    amount:        service.price,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };
  bookings.push(booking);
  res.status(201).json({ success: true, message: "Booking confirmed!", data: booking });
});

app.get("/bookings", (req, res) => {
  res.json({ success: true, total: bookings.length, data: bookings });
});

app.listen(PORT, () => {
  console.log(`✅ Salon Booking server running at http://localhost:${PORT}`);
});
