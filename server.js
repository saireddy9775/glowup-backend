require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const crypto     = require("crypto");
const mongoose   = require("mongoose");
const bcrypt     = require("bcryptjs");
const Razorpay   = require("razorpay");
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL || "bokcut.app@gmail.com";
const FROM_EMAIL    = "bokcut.app@gmail.com";
const FROM_NAME     = "Bokcut";

if (BREVO_API_KEY) {
  console.log("✅ Brevo email ready");
} else {
  console.warn("⚠️  BREVO_API_KEY missing — emails disabled");
}

async function sendMail(to, subject, html) {
  if (!BREVO_API_KEY) return;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender:  { name: FROM_NAME, email: FROM_EMAIL },
        to:      [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    const data = await res.json();
    if (res.ok) console.log(`✅ Email sent → ${to}`);
    else console.error("❌ Email error:", JSON.stringify(data));
  } catch (e) { console.error("❌ Email error:", e.message); }
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MongoDB ───────────────────────────────────────────────
if (!process.env.MONGODB_URI) {
  console.error("❌  MONGODB_URI is missing from .env — add it and restart");
  process.exit(1);
}
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => { console.error("❌ MongoDB connection failed:", err.message); process.exit(1); });

// ── Razorpay (warn only, don't crash) ─────────────────────
const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
let razorpay = null;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  console.log("✅ Razorpay initialised");
} else {
  console.warn("⚠️  Razorpay keys missing — payment routes will return 503");
}

app.use(cors());
app.use(express.json());

// ── Schemas ───────────────────────────────────────────────
const toJ = {
  virtuals: true,
  transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; },
};

const SalonSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  location:   { type: String, default: "India" },
  rating:     { type: Number, default: 0 },
  reviews:    { type: Number, default: 0 },
  image:      String,
  lat:        Number,
  lng:        Number,
  categories: [String],
  teamSize:   String,
  hours:      mongoose.Schema.Types.Mixed,
  registeredServices: mongoose.Schema.Types.Mixed,
}, { toJSON: toJ });

const SalonOwnerSchema = new mongoose.Schema({
  salonId:   { type: mongoose.Schema.Types.ObjectId, ref: "Salon" },
  ownerName: String,
  email:     { type: String, unique: true, lowercase: true, required: true },
  phone:     String,
  password:  { type: String, required: true },
  categories: [String],
}, { toJSON: toJ });
SalonOwnerSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

const ServiceSchema = new mongoose.Schema({
  salonId:  { type: mongoose.Schema.Types.ObjectId, ref: "Salon", required: true },
  name:     String,
  duration: Number,
  price:    Number,
}, { toJSON: toJ });

const UserSchema = new mongoose.Schema({
  name:     String,
  email:    { type: String, unique: true, lowercase: true },
  password: String,
  phone:    String,
  wallet:   { type: Number, default: 500 },
}, { toJSON: toJ });
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

const BookingSchema = new mongoose.Schema({
  customerName:  String,
  phone:         String,
  salonId:       { type: mongoose.Schema.Types.ObjectId, ref: "Salon" },
  salon:         String,
  serviceId:     { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
  service:       String,
  price:         Number,
  duration:      String,
  date:          String,
  time:          String,
  paymentMethod: { type: String, default: "cash" },
  paymentId:     String,
  orderId:       String,
  status:        { type: String, default: "confirmed" },
  createdAt:     { type: Date, default: Date.now },
}, { toJSON: toJ });

const ReviewSchema = new mongoose.Schema({
  bookingId:    { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
  salonId:      { type: mongoose.Schema.Types.ObjectId, ref: "Salon", required: true },
  salon:        String,
  customerName: String,
  rating:       { type: Number, required: true, min: 1, max: 5 },
  comment:      String,
  createdAt:    { type: Date, default: Date.now },
}, { toJSON: toJ });

const Salon      = mongoose.model("Salon",      SalonSchema);
const SalonOwner = mongoose.model("SalonOwner", SalonOwnerSchema);
const Service    = mongoose.model("Service",    ServiceSchema);
const User       = mongoose.model("User",       UserSchema);
const Booking    = mongoose.model("Booking",    BookingSchema);
const Review     = mongoose.model("Review",     ReviewSchema);

// ── Seed 10 demo salons (5 per city) on first run ─────────
async function seed() {
  if (await Salon.countDocuments() > 0) return;
  console.log("🌱 Seeding demo salons…");
  const [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10] = await Promise.all([
    Salon.create({ name:"The Clip House",         location:"Koramangala, Bengaluru", image:"https://images.unsplash.com/photo-1621645582931-d1d3e6564943?w=600&q=80", categories:["Hair","Barber"] }),
    Salon.create({ name:"Blush & Bloom Studio",   location:"Indiranagar, Bengaluru",  image:"https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&q=80", categories:["Skin care","Makeup","Brows & Lashes"] }),
    Salon.create({ name:"Radiance Nail Bar",      location:"HSR Layout, Bengaluru",   image:"https://images.unsplash.com/photo-1602585578130-c9076e09330d?w=600&q=80", categories:["Nails","Skin care"] }),
    Salon.create({ name:"Silver Scissors Salon",  location:"Jayanagar, Bengaluru",    image:"https://images.unsplash.com/photo-1621645582931-d1d3e6564943?w=600&q=80", categories:["Hair","Skin care"] }),
    Salon.create({ name:"The Beauty Bar",         location:"Whitefield, Bengaluru",   image:"https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&q=80", categories:["Nails","Makeup","Brows & Lashes"] }),
    Salon.create({ name:"Serene Spa & Wellness",  location:"Jubilee Hills, Hyderabad", image:"https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=600&q=80", categories:["Wellness & Spa","Massage"] }),
    Salon.create({ name:"Urban Grooming Lounge",  location:"Gachibowli, Hyderabad",   image:"https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?w=600&q=80", categories:["Hair","Barber","Skin care"] }),
    Salon.create({ name:"Elite Men's Grooming",   location:"Banjara Hills, Hyderabad", image:"https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=600&q=80", categories:["Barber","Hair"] }),
    Salon.create({ name:"Glow Skin & Nails",      location:"Madhapur, Hyderabad",     image:"https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=600&q=80", categories:["Nails","Skin care"] }),
    Salon.create({ name:"Tranquil Wellness Spa",  location:"Secunderabad, Hyderabad", image:"https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?w=600&q=80", categories:["Wellness & Spa","Massage"] }),
  ]);
  await Service.insertMany([
    { salonId:s1._id, name:"Test Payment ₹1", duration:5,  price:1    },
    { salonId:s1._id, name:"Haircut",         duration:30, price:349  },
    { salonId:s1._id, name:"Beard Trim",      duration:20, price:149  },
    { salonId:s1._id, name:"Hair Colouring",  duration:90, price:1499 },
    { salonId:s2._id, name:"Facial",          duration:60, price:799  },
    { salonId:s2._id, name:"Party Makeup",    duration:60, price:1299 },
    { salonId:s2._id, name:"Eyebrow Threading", duration:15, price:99 },
    { salonId:s3._id, name:"Manicure",        duration:45, price:499  },
    { salonId:s3._id, name:"Pedicure",        duration:45, price:599  },
    { salonId:s3._id, name:"Nail Art",        duration:30, price:299  },
    { salonId:s4._id, name:"Haircut",         duration:30, price:379  },
    { salonId:s4._id, name:"Hair Spa",        duration:45, price:899  },
    { salonId:s4._id, name:"Facial",          duration:60, price:749  },
    { salonId:s5._id, name:"Manicure",        duration:45, price:549  },
    { salonId:s5._id, name:"Bridal Makeup",   duration:120,price:2499 },
    { salonId:s5._id, name:"Eyebrow Threading", duration:15, price:129 },
    { salonId:s6._id, name:"Full Body Massage", duration:60, price:1499 },
    { salonId:s6._id, name:"Foot Reflexology",  duration:30, price:699  },
    { salonId:s7._id, name:"Haircut",         duration:30, price:399  },
    { salonId:s7._id, name:"Beard Styling",   duration:20, price:199  },
    { salonId:s7._id, name:"Facial",          duration:60, price:699  },
    { salonId:s8._id, name:"Haircut",         duration:30, price:299  },
    { salonId:s8._id, name:"Beard Trim",      duration:20, price:179  },
    { salonId:s8._id, name:"Hair Colouring",  duration:60, price:899  },
    { salonId:s9._id, name:"Pedicure",        duration:45, price:649  },
    { salonId:s9._id, name:"Facial",          duration:60, price:849  },
    { salonId:s9._id, name:"Nail Extensions", duration:60, price:1199 },
    { salonId:s10._id,name:"Full Body Massage", duration:60, price:1699 },
    { salonId:s10._id,name:"Head Massage",      duration:30, price:399  },
    { salonId:s10._id,name:"Aromatherapy",      duration:75, price:1399 },
  ]);
  console.log("✅ Seed complete");
}
mongoose.connection.once("open", seed);

// ── Password helpers ─────────────────────────────────────
// Legacy accounts have plaintext passwords. Accept either form on login,
// then transparently upgrade legacy ones to a bcrypt hash.
const isBcryptHash = (v) => typeof v === "string" && /^\$2[aby]\$/.test(v);

async function checkPassword(candidate, doc) {
  if (isBcryptHash(doc.password)) return bcrypt.compare(candidate, doc.password);
  if (candidate !== doc.password) return false;
  doc.password = candidate; // pre-save hook re-hashes since isModified("password")
  await doc.save();
  return true;
}

// ── Auth ──────────────────────────────────────────────────
app.post("/auth/register", async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || !phone)
    return res.status(400).json({ success:false, message:"All fields are required" });
  try {
    const user = await User.create({ name, email, password, phone });
    const { password:_, ...safe } = user.toJSON();
    res.status(201).json({ success:true, user:safe });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success:false, message:"Email already registered" });
    res.status(500).json({ success:false, message:"Registration failed" });
  }
});

app.post("/auth/login", async (req, res) => {
  const user = await User.findOne({ email:req.body.email?.toLowerCase() });
  if (!user || !(await checkPassword(req.body.password || "", user)))
    return res.status(401).json({ success:false, message:"Invalid email or password" });
  const { password:_, ...safe } = user.toJSON();
  res.json({ success:true, user:safe });
});

// ── Wallet ────────────────────────────────────────────────
app.post("/wallet/deduct", async (req, res) => {
  const { userId, amount } = req.body;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ success:false, message:"User not found" });
  if (user.wallet < amount) return res.status(400).json({ success:false, message:"Insufficient balance" });
  user.wallet -= amount; await user.save();
  res.json({ success:true, balance:user.wallet });
});

app.post("/wallet/topup", async (req, res) => {
  const { userId, amount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!userId || !amount || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ success:false, message:"Payment verification details are required" });
  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  if (expected !== razorpay_signature)
    return res.status(400).json({ success:false, message:"Payment verification failed" });
  const user = await User.findByIdAndUpdate(userId, { $inc:{ wallet:amount } }, { new:true });
  if (!user) return res.status(404).json({ success:false, message:"User not found" });
  res.json({ success:true, balance:user.wallet });
});

// ── Razorpay ──────────────────────────────────────────────
app.post("/razorpay/create-order", async (req, res) => {
  if (!razorpay) return res.status(503).json({ success:false, message:"Payment service not configured" });
  const { amount } = req.body;
  if (!amount) return res.status(400).json({ success:false, message:"Amount required" });
  try {
    const order = await razorpay.orders.create({ amount:Math.round(amount*100), currency:"INR", receipt:`rcpt_${Date.now()}` });
    res.json({ success:true, order, key:RAZORPAY_KEY_ID });
  } catch { res.status(500).json({ success:false, message:"Failed to create order" }); }
});

app.post("/razorpay/verify-payment", (req, res) => {
  if (!razorpay) return res.status(503).json({ success:false, message:"Payment service not configured" });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  if (expected === razorpay_signature) res.json({ success:true, message:"Payment verified" });
  else res.status(400).json({ success:false, message:"Signature mismatch" });
});

// ── Salons ────────────────────────────────────────────────
app.get("/salons", async (_req, res) => {
  const salons = await Salon.find().lean();
  res.json({ success:true, data: salons.map(s => ({ ...s, id:s._id.toString() })) });
});

app.post("/salons/register", async (req, res) => {
  const { salonName, ownerName, email, phone, password,
          address, city, categories, lat, lng,
          teamSize, hours, services:svcList } = req.body;

  if (!salonName || !email || !password)
    return res.status(400).json({ success:false, message:"Salon name, email and password are required" });

  const IMAGES = [
    "https://images.unsplash.com/photo-1560066984-138daaa0ce98?w=600&q=80",
    "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&q=80",
    "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=600&q=80",
    "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=600&q=80",
    "https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?w=600&q=80",
  ];

  try {
    const salon = await Salon.create({
      name:     salonName,
      location: [address, city].filter(Boolean).join(", ") || "India",
      lat, lng, categories, teamSize, hours,
      registeredServices: svcList,
      rating:  5.0,
      reviews: 0,
      image: IMAGES[Math.floor(Math.random() * IMAGES.length)],
    });

    // Persist services so they are immediately bookable
    if (Array.isArray(svcList) && svcList.length > 0) {
      await Service.insertMany(svcList.map(sv => ({
        salonId:  salon._id,
        name:     sv.name,
        duration: (sv.durH || 0) * 60 + (sv.durM || 30),
        price:    parseFloat(sv.price) || 0,
      })));
    }

    await SalonOwner.create({ salonId:salon._id, ownerName, email, phone, password, categories });

    res.status(201).json({ success:true, message:"Salon registered successfully", data:salon.toJSON() });

    // Welcome email → salon owner
    sendMail(email, `Welcome to Bokcut — You're Listed! 🎉`, `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
        <div style="background:#7c3aed;padding:32px;text-align:center;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:26px">✦ Bokcut</h1>
        </div>
        <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb">
          <h2 style="color:#7c3aed">Welcome, ${ownerName || salonName}! 🎉</h2>
          <p>Your salon <strong>${salonName}</strong> is now live on Bokcut.</p>
          <p>Customers in your area can discover and book your services right away.</p>
          <p>If you need any help, just reply to this email.</p>
          <p style="color:#6b7280;font-size:13px;margin-top:24px">— The Bokcut Team</p>
        </div>
      </div>
    `);

    // Admin alert
    sendMail(ADMIN_EMAIL, `🎉 New Salon: ${salonName}`, `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
        <h2 style="color:#7c3aed">New Salon Registered</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#6b7280;width:100px">Salon</td><td><strong>${salonName}</strong></td></tr>
          <tr><td style="padding:8px 0;color:#6b7280">Owner</td><td>${ownerName || "—"}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280">Email</td><td><a href="mailto:${email}">${email}</a></td></tr>
          <tr><td style="padding:8px 0;color:#6b7280">Phone</td><td>${phone || "—"}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280">Location</td><td>${[address, city].filter(Boolean).join(", ") || "—"}</td></tr>
        </table>
      </div>
    `);

  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ success:false, message:"This email is already registered" });
    console.error("Register error:", err.message);
    res.status(500).json({ success:false, message:"Registration failed. Please try again." });
  }
});

app.post("/salons/login", async (req, res) => {
  const owner = await SalonOwner.findOne({ email:req.body.email?.toLowerCase() });
  if (!owner || !(await checkPassword(req.body.password || "", owner)))
    return res.status(401).json({ success:false, message:"Invalid email or password" });
  const salon = await Salon.findById(owner.salonId).lean();
  const { password:_, ...safe } = owner.toJSON();
  res.json({ success:true, owner:safe, salon: salon ? { ...salon, id:salon._id.toString() } : null });
});

// ── Services ──────────────────────────────────────────────
app.get("/services/:salonId", async (req, res) => {
  try {
    const salon = await Salon.findById(req.params.salonId).lean();
    if (!salon) return res.status(404).json({ success:false, message:"Salon not found" });
    const svcs = await Service.find({ salonId:salon._id }).lean();
    res.json({
      success: true,
      salon:   salon.name,
      image:   salon.image,
      data:    svcs.map(s => ({ ...s, id:s._id.toString(), salonId:salon._id.toString() })),
    });
  } catch {
    res.status(404).json({ success:false, message:"Salon not found" });
  }
});

// ── Bookings ──────────────────────────────────────────────

// Team size is collected as a rough range during salon registration, not an
// exact headcount. Use the lower bound of each range as the guaranteed
// concurrent-booking capacity, so we never overbook beyond what's certain.
function teamSizeToCapacity(teamSize) {
  if (!teamSize) return 1;
  if (teamSize.startsWith("Just me")) return 1;
  if (teamSize.startsWith("2")) return 2;
  if (teamSize.startsWith("5")) return 5;
  if (teamSize.startsWith("More than 10")) return 10;
  return 1;
}

// GET /availability/:salonId/:date -> how many slots are already booked per
// time, and the salon's capacity, so the client can grey out full slots.
app.get("/availability/:salonId/:date", async (req, res) => {
  try {
    const salon = await Salon.findById(req.params.salonId).lean();
    if (!salon) return res.status(404).json({ success:false, message:"Salon not found" });
    const capacity = teamSizeToCapacity(salon.teamSize);
    const bookings = await Booking.find({ salonId:salon._id, date:req.params.date, status:{ $ne:"cancelled" } }).lean();
    const bookedCounts = {};
    for (const b of bookings) bookedCounts[b.time] = (bookedCounts[b.time] || 0) + 1;
    res.json({ success:true, capacity, bookedCounts });
  } catch {
    res.status(404).json({ success:false, message:"Salon not found" });
  }
});

app.post("/bookings", async (req, res) => {
  const { customerName, phone, salonId, serviceId, date, time, paymentMethod, paymentId, orderId } = req.body;
  if (!customerName || !phone || !salonId || !serviceId || !date || !time)
    return res.status(400).json({ success:false, message:"All fields are required" });
  try {
    const [salon, service] = await Promise.all([
      Salon.findById(salonId).lean(),
      Service.findById(serviceId).lean(),
    ]);
    if (!salon)   return res.status(404).json({ success:false, message:"Salon not found" });
    if (!service) return res.status(404).json({ success:false, message:"Service not found" });
    const capacity = teamSizeToCapacity(salon.teamSize);
    const existingCount = await Booking.countDocuments({ salonId, date, time, status:{ $ne:"cancelled" } });
    if (existingCount >= capacity)
      return res.status(409).json({ success:false, message:"This time slot is fully booked. Please choose another time." });
    const booking = await Booking.create({
      customerName, phone, salonId, salon:salon.name,
      serviceId, service:service.name, price:service.price,
      duration:`${service.duration} mins`, date, time,
      paymentMethod:paymentMethod||"cash", paymentId, orderId,
    });
    res.status(201).json({ success:true, message:"Booking confirmed!", data:booking.toJSON() });
  } catch { res.status(500).json({ success:false, message:"Booking failed" }); }
});

// ── Reviews ───────────────────────────────────────────────
app.post("/reviews", async (req, res) => {
  const { bookingId, rating, comment } = req.body;
  if (!bookingId || !rating)
    return res.status(400).json({ success:false, message:"Booking and rating are required" });
  try {
    const booking = await Booking.findById(bookingId).lean();
    if (!booking) return res.status(404).json({ success:false, message:"Booking not found" });
    const review = await Review.create({
      bookingId, salonId:booking.salonId, salon:booking.salon,
      customerName:booking.customerName, rating, comment,
    });
    res.status(201).json({ success:true, review:review.toJSON() });
  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ success:false, message:"This booking has already been reviewed" });
    res.status(500).json({ success:false, message:"Failed to submit review" });
  }
});

app.get("/reviews", async (_req, res) => {
  const reviews = await Review.find().sort({ createdAt:-1 }).limit(20).lean();
  res.json({ success:true, data: reviews.map(r => ({ ...r, id:r._id.toString() })) });
});

app.listen(PORT, () => console.log(`✅ Bokcut backend running on port ${PORT}`));