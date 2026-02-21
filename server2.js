const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 1. ALLOW EVERYONE (Important for connection)
app.use(cors());
app.use(express.json());

// 2. Connect to Database
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/homeservice')
  .then(() => console.log("✅ MongoDB Connected!"))
  .catch(err => console.log(err));

// 3. Models
const Service = mongoose.model('Service', { title: String, price: Number, image: String });
const Booking = mongoose.model('Booking', { service: String, customer: String, phone: String });

// 4. Routes
app.get('/api/services', async (req, res) => {
  const services = await Service.find();
  res.json(services);
});

app.post('/api/book', async (req, res) => {
  console.log("🔥 Booking Received for:", req.body.customer);
  const newBooking = new Booking(req.body);
  await newBooking.save();
  res.json({ message: "Booking success!" });
});
// GET all bookings (For the Admin Dashboard)
app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find();
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Error fetching bookings" });
  }
});
// 5. START ON PORT 4000 (To escape the zombie)
app.listen(4000, () => {
  console.log("🚀 SERVER RUNNING ON PORT 4000");
});