const mongoose = require('mongoose');

// The Blueprint: What does a "Service" look like?
const ServiceSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: true 
    },
    price: { 
        type: Number, 
        required: true 
    },
    // We can add more fields later (like 'description' or 'category')
});

module.exports = mongoose.model('Service', ServiceSchema);