const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const XLSX = require('xlsx');
const cron = require('node-cron');
const path = require('path');
require('dotenv').config();

const flightService = require('./flightService');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Middleware Configuration
// ============================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      frameSrc: ["'none'"]
    }
  }
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Compression
app.use(compression());

// Request logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// Static files
app.use(express.static('public'));

// ============================================
// In-Memory Data Store (Replace with DB later)
// ============================================

let flights = [];
let nextId = 1;

// ============================================
// Multer Configuration for File Uploads
// ============================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel files (.xlsx, .xls) are allowed.'));
    }
  }
});

// ============================================
// Helper Functions
// ============================================

/**
 * Update flight status by calling FlightAware API
 */
async function updateFlightStatus(flightId) {
  const flight = flights.find(f => f.id === flightId);
  
  if (!flight) {
    console.error(`Flight ${flightId} not found`);
    return;
  }

  try {
    flight.status = 'checking';
    
    const statusData = await flightService.getFlightStatus(
      flight.flightNumber,
      flight.departureTime
    );

    flight.status = statusData.status;
    flight.statusDetails = statusData.details;
    flight.lastChecked = new Date().toISOString();
    flight.updatedAt = new Date().toISOString();

    console.log(`✅ Updated flight ${flight.flightNumber}: ${flight.status}`);
  } catch (error) {
    console.error(`❌ Error updating flight ${flight.flightNumber}:`, error.message);
    flight.status = 'error';
    flight.statusDetails = { message: error.message };
    flight.lastChecked = new Date().toISOString();
  }
}

/**
 * Update all flights' statuses
 */
async function updateAllFlights() {
  console.log(`🔄 Starting status update for ${flights.length} flights...`);
  
  for (const flight of flights) {
    await updateFlightStatus(flight.id);
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('✅ Status update complete');
}

/**
 * Clean up old flights (older than 24 hours after arrival)
 */
function cleanupOldFlights() {
  const now = new Date();
  const before = flights.length;
  
  flights = flights.filter(flight => {
    if (!flight.departureTime) return true;
    
    const departureTime = new Date(flight.departureTime);
    const hoursSinceDeparture = (now - departureTime) / (1000 * 60 * 60);
    
    return hoursSinceDeparture < 48; // Keep flights from last 48 hours
  });
  
  const removed = before - flights.length;
  if (removed > 0) {
    console.log(`🗑️  Cleaned up ${removed} old flights`);
  }
}

// ============================================
// API Routes
// ============================================

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    flightsTracked: flights.length
  });
});

/**
 * Get all flights
 */
app.get('/api/flights', (req, res) => {
  res.json({
    success: true,
    count: flights.length,
    flights: flights
  });
});

/**
 * Get single flight by ID
 */
app.get('/api/flights/:id', (req, res) => {
  const flight = flights.find(f => f.id === parseInt(req.params.id));
  
  if (!flight) {
    return res.status(404).json({
      success: false,
      error: 'Flight not found'
    });
  }
  
  res.json({
    success: true,
    flight: flight
  });
});

/**
 * Add a new flight
 */
app.post('/api/flights', async (req, res) => {
  try {
    const { employeeName, flightNumber, departureTime, origin, destination } = req.body;

    // Validation
    if (!employeeName || !flightNumber) {
      return res.status(400).json({
        success: false,
        error: 'Employee name and flight number are required'
      });
    }

    // Create new flight object
    const newFlight = {
      id: nextId++,
      employeeName,
      flightNumber: flightNumber.toUpperCase().replace(/\s/g, ''),
      departureTime: departureTime || new Date().toISOString(),
      origin: origin?.toUpperCase() || null,
      destination: destination?.toUpperCase() || null,
      status: 'checking',
      statusDetails: {},
      lastChecked: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    flights.push(newFlight);

    // Fetch initial status (async, don't wait)
    updateFlightStatus(newFlight.id).catch(err => {
      console.error('Error updating initial flight status:', err);
    });

    res.status(201).json({
      success: true,
      flight: newFlight,
      message: 'Flight added successfully'
    });
  } catch (error) {
    console.error('Error adding flight:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add flight'
    });
  }
});

/**
 * Update a flight
 */
app.put('/api/flights/:id', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id);
    const flight = flights.find(f => f.id === flightId);

    if (!flight) {
      return res.status(404).json({
        success: false,
        error: 'Flight not found'
      });
    }

    const { employeeName, flightNumber, departureTime, origin, destination } = req.body;

    // Update fields
    if (employeeName) flight.employeeName = employeeName;
    if (flightNumber) flight.flightNumber = flightNumber.toUpperCase().replace(/\s/g, '');
    if (departureTime) flight.departureTime = departureTime;
    if (origin) flight.origin = origin.toUpperCase();
    if (destination) flight.destination = destination.toUpperCase();
    
    flight.updatedAt = new Date().toISOString();

    // Refresh status if flight number changed
    if (flightNumber) {
      await updateFlightStatus(flightId);
    }

    res.json({
      success: true,
      flight: flight,
      message: 'Flight updated successfully'
    });
  } catch (error) {
    console.error('Error updating flight:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update flight'
    });
  }
});

/**
 * Delete a flight
 */
app.delete('/api/flights/:id', (req, res) => {
  const flightId = parseInt(req.params.id);
  const index = flights.findIndex(f => f.id === flightId);

  if (index === -1) {
    return res.status(404).json({
      success: false,
      error: 'Flight not found'
    });
  }

  const deletedFlight = flights.splice(index, 1)[0];

  res.json({
    success: true,
    flight: deletedFlight,
    message: 'Flight deleted successfully'
  });
});

/**
 * Refresh flight status manually
 */
app.post('/api/flights/:id/refresh', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id);
    const flight = flights.find(f => f.id === flightId);

    if (!flight) {
      return res.status(404).json({
        success: false,
        error: 'Flight not found'
      });
    }

    await updateFlightStatus(flightId);

    res.json({
      success: true,
      flight: flight,
      message: 'Flight status refreshed'
    });
  } catch (error) {
    console.error('Error refreshing flight:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh flight status'
    });
  }
});

/**
 * Upload Excel file with flights
 */
app.post('/api/flights/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Excel file is empty'
      });
    }

    const addedFlights = [];
    const errors = [];

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      try {
        // Expected columns: Employee Name, Flight Number, Departure Time, Origin, Destination
        const employeeName = row['Employee Name'] || row['employee_name'] || row['name'];
        const flightNumber = row['Flight Number'] || row['flight_number'] || row['flight'];
        const departureTime = row['Departure Time'] || row['departure_time'] || row['departure'];
        const origin = row['Origin'] || row['origin'] || row['from'];
        const destination = row['Destination'] || row['destination'] || row['to'];

        if (!employeeName || !flightNumber) {
          errors.push(`Row ${i + 1}: Missing required fields (Employee Name or Flight Number)`);
          continue;
        }

        const newFlight = {
          id: nextId++,
          employeeName,
          flightNumber: String(flightNumber).toUpperCase().replace(/\s/g, ''),
          departureTime: departureTime ? new Date(departureTime).toISOString() : new Date().toISOString(),
          origin: origin ? String(origin).toUpperCase() : null,
          destination: destination ? String(destination).toUpperCase() : null,
          status: 'checking',
          statusDetails: {},
          lastChecked: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        flights.push(newFlight);
        addedFlights.push(newFlight);
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    // Update statuses asynchronously (staggered to avoid rate limits)
    (async () => {
      for (const flight of addedFlights) {
        await updateFlightStatus(flight.id);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    })();

    res.json({
      success: true,
      message: `Uploaded ${addedFlights.length} flights`,
      added: addedFlights.length,
      errors: errors.length > 0 ? errors : undefined,
      flights: addedFlights
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process Excel file'
    });
  }
});

/**
 * Search flights
 */
app.get('/api/search', async (req, res) => {
  try {
    const { flightNumber, origin, destination, date } = req.query;

    if (!flightNumber && !origin && !destination) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least one search parameter'
      });
    }

    // Search in tracked flights first
    let results = flights.filter(flight => {
      let matches = true;
      
      if (flightNumber) {
        matches = matches && flight.flightNumber.includes(flightNumber.toUpperCase());
      }
      if (origin) {
        matches = matches && flight.origin === origin.toUpperCase();
      }
      if (destination) {
        matches = matches && flight.destination === destination.toUpperCase();
      }
      
      return matches;
    });

    res.json({
      success: true,
      count: results.length,
      flights: results
    });
  } catch (error) {
    console.error('Error searching flights:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
});

// ============================================
// Scheduled Tasks (Cron Jobs)
// ============================================

// Update flight statuses every 5 minutes
const updateInterval = parseInt(process.env.STATUS_UPDATE_INTERVAL) || 5;
cron.schedule(`*/${updateInterval} * * * *`, () => {
  console.log('⏰ Running scheduled flight status update...');
  updateAllFlights();
});

// Cleanup old flights every hour
cron.schedule('0 * * * *', () => {
  console.log('⏰ Running scheduled cleanup...');
  cleanupOldFlights();
});

// ============================================
// Error Handling
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║         Employee Flight Tracker - Server Running      ║
║                                                        ║
║  🌐 Server:    http://localhost:${PORT}                   ║
║  📊 API:       http://localhost:${PORT}/api/flights       ║
║  ❤️  Health:    http://localhost:${PORT}/api/health       ║
║                                                        ║
║  📝 Environment: ${process.env.NODE_ENV || 'development'}                    ║
║  ✈️  FlightAware: ${process.env.FLIGHTAWARE_API_KEY ? 'Enabled' : 'Mock Mode'}                     ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});
