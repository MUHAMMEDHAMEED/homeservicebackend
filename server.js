require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();

// --- 1. MIDDLEWARE ---
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

const localOrigins = ['http://localhost:5173', 'http://localhost:5174'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || localOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS Not Allowed'));
    }
  },
  credentials: true
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, 
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// --- 2. DATABASE ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch(err => console.error("❌ DB Error:", err));

// --- 3. MODELS ---
const userSchema = new mongoose.Schema({
  googleId: String,
  name: String,
  email: { type: String, required: true },
  password: String,
  role: { type: String, default: 'client' }, 
  serviceCategory: String, 
  phone: String,
  district: String, 
  city: String    
});
const User = mongoose.model('User', userSchema);

const bookingSchema = new mongoose.Schema({
  customer: String,
  customerEmail: String,
  customerRole: { type: String, default: 'client' }, // 👈 Tracking Role
  service: String,
  phone: String,
  date: String,
  address: String,
  city: String,    
  status: { type: String, default: 'pending' }, 
  assignedWorkerId: String,
  workerDetails: Object,
  createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// --- 4. PASSPORT CONFIG ---
// --- 4. PASSPORT CONFIG ---
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

passport.use(new GoogleStrategy({
    // Calling variables from .env file
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3001/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id });
      if (!user) {
        user = new User({
          googleId: profile.id,
          name: profile.displayName,
          email: profile.emails[0].value,
          role: 'client'
        });
        await user.save();
      }
      return done(null, user);
    } catch (err) { return done(err); }
  }
));

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await User.findOne({ email });
    if (!user) return done(null, false, { message: 'Email not found' });
    if (!user.password) return done(null, false, { message: 'Please login with Google' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return done(null, false, { message: 'Incorrect password' });
    return done(null, user);
  } catch (err) { return done(err); }
}));

// --- 5. ROUTES ---

// AUTH
app.post('/api/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return res.status(500).json({ message: "Server Error" });
    if (!user) return res.status(400).json({ message: info.message || "Login failed" });
    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ message: "Session failed" });
      return res.json(user);
    });
  })(req, res, next);
});

// ✅ Add '/api' to the route to match your frontend request
app.get("/api/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    
    // Completely clear the local session
    req.session.destroy((err) => {
      if (err) console.error("Session destroy error:", err);
      res.clearCookie("connect.sid"); 
      // Redirect back to your Vite home page
      res.redirect("http://localhost:5173"); 
    });
  });
});

app.get('/api/current_user', (req, res) => {
  res.json(req.user || null);
});

// --- Make sure these are NOT inside another app.get or app.post ---

app.get('/auth/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: 'http://localhost:5173' }), 
  (req, res) => {
    res.redirect('http://localhost:5173');
  }
);

// REGISTRATION
app.post('/api/register-client', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Fields required" });
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email exists" });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ name, email, password: hashedPassword, phone, role: 'client' });
    await newUser.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

app.post('/api/register-worker', async (req, res) => {
  try {
    const { name, email, password, serviceCategory, phone, district, city } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newWorker = new User({ name, email, password: hashedPassword, role: 'worker', serviceCategory, phone, district, city });
    await newWorker.save();
    res.json({ message: "Worker registered!" });
  } catch (err) { res.status(500).json({ message: "Server error" }); }
});

// CLIENT BOOKINGS
app.post('/api/book', async (req, res) => {
  try {
    const { service, customer, email, phone, address, date } = req.body;
    const userRole = req.user ? req.user.role : 'client'; // 👈 Capture current role

    const newBooking = new Booking({
      service, customer, customerEmail: email,
      customerRole: userRole, // 👈 Save role
      phone, date, address, status: 'pending'
    });
    await newBooking.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: "Booking error" }); }
});

app.get('/api/client/bookings', async (req, res) => {
  try {
    const email = req.query.email;
    const myBookings = await Booking.find({ customerEmail: email }).sort({ _id: -1 });
    res.json(myBookings);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

// WORKER ROUTES
// server.js - Updated Worker Jobs Route
app.get('/api/worker/jobs', async (req, res) => {
  const { category, workerId } = req.query; 
  try {
    // 🛡️ Find all pending jobs (new requests)
    const pendingJobs = await Booking.find({ status: 'pending' });

    // 🛡️ Find all jobs specifically for this worker (Accepted AND Completed)
    const myJobs = await Booking.find({ assignedWorkerId: workerId });

    // Combine them and send back to the frontend
    res.json([...pendingJobs, ...myJobs].sort((a,b) => b._id.getTimestamp() - a._id.getTimestamp()));
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});
// server.js - Add this route
app.post('/api/worker/complete', async (req, res) => {
  try {
    const { bookingId } = req.body;
    await Booking.findByIdAndUpdate(bookingId, { status: 'completed' });
    res.json({ success: true });
  } catch (err) {
    console.error("Complete Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post('/api/worker/accept', async (req, res) => {
  try {
    const { bookingId, workerId } = req.body;
    const worker = await User.findById(workerId);
    await Booking.findByIdAndUpdate(bookingId, { 
      status: 'accepted', assignedWorkerId: workerId,
      workerDetails: { name: worker.name, phone: worker.phone }
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

// ADMIN ROUTES
app.get('/api/admin/bookings', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(401).json({ message: "Denied" });
    const bookings = await Booking.find().sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get('/api/admin/data', async (req, res) => {
  try {
    const users = await User.find().sort({ _id: -1 });
    const bookings = await Booking.find().sort({ _id: -1 });
    res.json({ users, bookings });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.delete('/api/admin/bookings/:id', async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`🚀 Local Server running on port ${PORT}`));