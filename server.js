const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// --- 1. MIDDLEWARE ---
app.use(cors({
  origin: 'https://homeserviceconnect.netlify.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());
app.use(session({
  secret: 'mysecretkey123',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));
app.use(passport.initialize());
app.use(passport.session());

// --- 2. DATABASE ---
// Comment out the old one just in case
// mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/homeservice')

// Paste your cloud link directly in the code (just for this test!)
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ CLOUD MongoDB Connected!"))
  .catch(err => console.log("❌ DB Error:", err));

// --- 3. MODELS ---

// User Model
const userSchema = new mongoose.Schema({
  googleId: String,
  name: String,
  email: String,
  password: String,
  role: { type: String, default: 'client' }, 
  serviceCategory: String, 
  phone: String,
  district: String, 
  city: String    
});
const User = mongoose.model('User', userSchema);

// Booking Model (Updated with customerEmail)
const bookingSchema = new mongoose.Schema({
  customer: String,
  customerEmail: String, // 👈 ADDED THIS to link bookings to users
  service: String,
  phone: String,
  date: String,
  address: String,
  city: String,    // Used for location matching
  status: { type: String, default: 'pending' }, 
  assignedWorkerId: String, // ID of worker
  workerDetails: Object     // Store name/phone of worker
});
const Booking = mongoose.model('Booking', bookingSchema);

// --- 4. PASSPORT CONFIG (AUTH) ---

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

// Google Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
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
    } catch (err) {
      return done(err);
    }
  }
));

// Local Strategy
passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await User.findOne({ email });
    if (!user) return done(null, false, { message: 'Email not found' });
    if (!user.password) return done(null, false, { message: 'Please login with Google' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return done(null, false, { message: 'Incorrect password' });

    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

// --- 5. ROUTES ---

// --> REGISTER CLIENT
app.post('/api/register-client', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    // Hash password for security
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ 
      name, email, password: hashedPassword, phone, 
      role: 'client' 
    });
    await newUser.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// --> REGISTER WORKER
app.post('/api/register-worker', async (req, res) => {
  const { name, email, password, serviceCategory, phone, district, city } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newWorker = new User({ 
      name, email, password: hashedPassword, role: 'worker', 
      serviceCategory, phone, district, city 
    });
    await newWorker.save();
    res.json({ message: "Worker registered successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// --> LOGIN
app.post('/api/login', passport.authenticate('local'), (req, res) => {
  res.json(req.user);
});

// --> LOGOUT
app.get('/api/logout', (req, res) => {
  req.logout((err) => {
    if (err) return next(err);
res.redirect('https://homeserviceconnect.netlify.app');
  });
});

// --> GET USER
app.get('/api/current_user', (req, res) => {
  res.json(req.user || null);
});

// --> GOOGLE AUTH
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
res.redirect('https://homeserviceconnect.netlify.app')
});

// --> BOOKING ROUTE 📅 (Now Saves Email)
app.post('/api/book', async (req, res) => {
  const { service, customer, email, phone, location, address, date } = req.body;

  try {
    const newBooking = new Booking({
      service, 
      customer, 
      customerEmail: email, // 👈 Save Email
      phone, 
      date, 
      address,
      city: (location || "").toLowerCase(), 
      status: 'pending'
    });
    await newBooking.save();

    res.json({ message: "Booked", workerFound: 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// --> CLIENT: Get My Bookings 📅 (New Route)
app.get('/api/client/bookings', async (req, res) => {
  const { email } = req.query; 
  try {
    if (!email) return res.json([]);
    // Find bookings for this email
    const bookings = await Booking.find({ customerEmail: email }).sort({ _id: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: "Error fetching bookings" });
  }
});

// --> WORKER: Get Jobs (Pending + Accepted) 🧠
// --> WORKER: Get Jobs (Strict Filter) 🧠
// --> WORKER: Get Jobs (Final Strict Fix) 🔒
app.get('/api/worker/jobs', async (req, res) => {
  const { category, workerId } = req.query; 

  console.log(`🔎 Filtering for: ${category}`); // Check your terminal for this!

  try {
    // 1. Get ALL Pending Jobs (Temporary)
    const allPending = await Booking.find({ status: 'pending' });

    // 2. 🛑 JAVASCRIPT FILTER (The "Foolproof" Check)
    //    We manually check each job. If the service name doesn't match, we toss it out.
    const filteredPending = allPending.filter(job => {
      // Safety check: if job has no service name, hide it
      if (!job.service) return false;
      
      // Compare names (Case Insensitive: "Plumber" == "plumber")
      return job.service.toLowerCase().trim() === (category || "").toLowerCase().trim();
    });

    // 3. Get Jobs Assigned Specifically to ME (Accepted/Completed)
    const myJobs = await Booking.find({ assignedWorkerId: workerId });

    // 4. Combine Both Lists
    const finalJobs = [...filteredPending, ...myJobs].sort((a, b) => {
      return new Date(b._id.getTimestamp()) - new Date(a._id.getTimestamp());
    });

    res.json(finalJobs);

  } catch (err) {
    console.error("❌ Error fetching jobs:", err);
    res.status(500).json({ message: "Server Error" });
  }
});
// --> WORKER: Mark Completed ✅
app.post('/api/worker/complete', async (req, res) => {
  const { bookingId } = req.body;
  try {
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    booking.status = 'completed';
    await booking.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Complete Error:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});
// --> ADMIN: Get All Data 👮‍♂️
app.get('/api/admin/data', async (req, res) => {
  try {
    const users = await User.find().sort({ _id: -1 });
    const bookings = await Booking.find().sort({ _id: -1 });
    
    res.json({ users, bookings });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// --> ADMIN: Delete Booking 🗑️
app.delete('/api/admin/booking/:id', async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Error deleting" });
  }
});
// --> WORKER: Accept a Job ✅ (PASTE THIS IN SERVER.JS)
app.post('/api/worker/accept', async (req, res) => {
  const { bookingId, workerId } = req.body;
  
  console.log(`📥 Accepting Job: ${bookingId} for Worker: ${workerId}`);

  try {
    // 1. Find the Worker to get their name/phone
    const worker = await User.findById(workerId);
    if (!worker) return res.status(404).json({ message: "Worker profile not found." });

    // 2. Update the Booking
    await Booking.findByIdAndUpdate(bookingId, { 
      status: 'accepted',
      assignedWorkerId: workerId,
      workerDetails: {
        name: worker.name,
        phone: worker.phone
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Accept Error:", err);
    res.status(500).json({ message: "Server error while accepting job." });
  }
});
// 👇 START THE SERVER
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});