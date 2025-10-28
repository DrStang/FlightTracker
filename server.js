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

// Database integration (optional - falls back to in-memory)
let db = null;
let FlightModel, EmployeeModel, FlightStatusHistoryModel, AuditModel;
const USE_DATABASE = !!process.env.DATABASE_URL;

if (USE_DATABASE) {
  try {
    db = require('./database');
    const models = require('./models');
    FlightModel = models.FlightModel;
    EmployeeModel = models.EmployeeModel;
    FlightStatusHistoryModel = models.FlightStatusHistoryModel;
    AuditModel = models.AuditModel;
    console.log('✅ Database mode enabled');
  } catch (error) {
    console.warn('⚠️  Database connection failed, using in-memory storage:', error.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ============================================
// Middleware Configuration
// ============================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick)
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
 * Determine if a flight should be actively monitored
 * Only monitor flights that are:
 * - Within 7 days before departure
 * - Not yet landed (or within 6 hours after scheduled arrival)
 */
function shouldMonitorFlight(flight) {
  const now = new Date();
  const departureTime = new Date(flight.departure_time || flight.departureTime);
  
  // Check if flight is more than 7 days in the future
  const daysUntilDeparture = (departureTime - now) / (1000 * 60 * 60 * 24);
  if (daysUntilDeparture > 7) {
    return false; // Too far in the future
  }
  
  // Check if flight has landed (use actual arrival if available, otherwise estimate)
  const statusDetails = flight.status_details || flight.statusDetails || {};
  
  // If we have actual arrival time, check if it's more than 6 hours ago
  if (statusDetails.actualArrival) {
    const actualArrival = new Date(statusDetails.actualArrival);
    const hoursSinceLanding = (now - actualArrival) / (1000 * 60 * 60);
    if (hoursSinceLanding > 6) {
      return false; // Flight landed more than 6 hours ago
    }
  }
  
  // If we have estimated arrival, check if it's in the past
  if (statusDetails.estimatedArrival) {
    const estimatedArrival = new Date(statusDetails.estimatedArrival);
    const hoursSinceEstimatedArrival = (now - estimatedArrival) / (1000 * 60 * 60);
    if (hoursSinceEstimatedArrival > 6) {
      return false; // Estimated arrival was more than 6 hours ago
    }
  }
  
  // If flight is cancelled, stop monitoring after 24 hours
  if (flight.status === 'cancelled') {
    const hoursSinceLastCheck = flight.last_checked || flight.lastChecked 
      ? (now - new Date(flight.last_checked || flight.lastChecked)) / (1000 * 60 * 60)
      : 0;
    if (hoursSinceLastCheck > 24) {
      return false; // Cancelled flight, no need to keep checking
    }
  }
  
  return true; // Flight should be monitored
}

/**
 * Check if a flight is in the past (landed and completed)
 */
function isFlightInPast(flight) {
  const now = new Date();
  const statusDetails = flight.status_details || flight.statusDetails || {};
  
  // If we have actual arrival time and it's more than 2 hours ago
  if (statusDetails.actualArrival) {
    const actualArrival = new Date(statusDetails.actualArrival);
    const hoursSinceLanding = (now - actualArrival) / (1000 * 60 * 60);
    return hoursSinceLanding > 2;
  }
  
  // If we have estimated arrival and it's more than 2 hours ago
  if (statusDetails.estimatedArrival) {
    const estimatedArrival = new Date(statusDetails.estimatedArrival);
    const hoursSinceEstimated = (now - estimatedArrival) / (1000 * 60 * 60);
    return hoursSinceEstimated > 2;
  }
  
  // If scheduled arrival is more than 4 hours ago, consider it past
  if (statusDetails.scheduledArrival) {
    const scheduledArrival = new Date(statusDetails.scheduledArrival);
    const hoursSinceScheduled = (now - scheduledArrival) / (1000 * 60 * 60);
    return hoursSinceScheduled > 4;
  }
  
  // If departure time is more than 8 hours ago and we have no arrival info
  // (assuming most domestic flights are under 6 hours)
  const departureTime = new Date(flight.departure_time || flight.departureTime);
  if (!isNaN(departureTime.getTime())) {
    const hoursSinceDeparture = (now - departureTime) / (1000 * 60 * 60);
    return hoursSinceDeparture > 8;
  }
  
  return false;
}

/**
 * Update flight status by calling FlightAware API
 */
async function updateFlightStatus(flightId) {
  let flight;
  
  // Get flight from database or memory
  if (USE_DATABASE && FlightModel) {
    flight = await FlightModel.getById(flightId);
  } else {
    flight = flights.find(f => f.id === flightId);
  }
  
  if (!flight) {
    console.error(`Flight ${flightId} not found`);
    return;
  }

  try {
    // Update to checking status
    if (USE_DATABASE && FlightModel) {
      await FlightModel.update(flightId, { status: 'checking' });
    } else {
      flight.status = 'checking';
    }
    
    const statusData = await flightService.getFlightStatus(
      flight.flight_number || flight.flightNumber,
      flight.departure_time || flight.departureTime
    );

    const updateData = {
      status: statusData.status,
      status_details: statusData.details,
      last_checked: new Date().toISOString()
    };

    // Save to database or memory
    if (USE_DATABASE && FlightModel) {
      await FlightModel.update(flightId, updateData);
    } else {
      flight.status = statusData.status;
      flight.statusDetails = statusData.details;
      flight.lastChecked = new Date().toISOString();
      flight.updatedAt = new Date().toISOString();
    }

    console.log(`✅ Updated flight ${flight.flight_number || flight.flightNumber}: ${statusData.status}`);
  } catch (error) {
    console.error(`❌ Error updating flight ${flight.flight_number || flight.flightNumber}:`, error.message);
    
    const errorData = {
      status: 'error',
      status_details: { message: error.message },
      last_checked: new Date().toISOString()
    };

    if (USE_DATABASE && FlightModel) {
      await FlightModel.update(flightId, errorData);
    } else {
      flight.status = 'error';
      flight.statusDetails = { message: error.message };
      flight.lastChecked = new Date().toISOString();
    }
  }
}

/**
 * Update all flights' statuses
 */
async function updateAllFlights() {
  let allFlights;
  
  if (USE_DATABASE && FlightModel) {
    allFlights = await FlightModel.getAll({ recentOnly: true });
  } else {
    allFlights = flights;
  }
  
  // Filter to only flights that should be actively monitored
  const activeFlights = allFlights.filter(flight => shouldMonitorFlight(flight));
  const skippedCount = allFlights.length - activeFlights.length;
  
  console.log('Starting status update for ' + allFlights.length + ' flights...');
  if (skippedCount > 0) {
    console.log('  Skipping ' + skippedCount + ' flights (too far out or already landed)');
  }
  console.log('  Monitoring ' + activeFlights.length + ' active flights');
  
  for (const flight of activeFlights) {
    const departureTime = new Date(flight.departure_time || flight.departureTime);
    const now = new Date();
    const daysUntil = ((departureTime - now) / (1000 * 60 * 60 * 24)).toFixed(1);
    
    console.log('    Checking ' + (flight.flight_number || flight.flightNumber) + ' (' + daysUntil + ' days until departure)');
    
    await updateFlightStatus(flight.id);
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('Status update complete');
}

/**
 * Clean up old flights (older than 48 hours after departure)
 */
async function cleanupOldFlights() {
  let removed = 0;
  
  if (USE_DATABASE && FlightModel) {
    removed = await FlightModel.cleanupOld(48);
  } else {
    const now = new Date();
    const before = flights.length;
    
    flights = flights.filter(flight => {
      if (!flight.departureTime) return true;
      
      const departureTime = new Date(flight.departureTime);
      const hoursSinceDeparture = (now - departureTime) / (1000 * 60 * 60);
      
      return hoursSinceDeparture < 48; // Keep flights from last 48 hours
    });
    
    removed = before - flights.length;
  }
  
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
app.get('/api/health', async (req, res) => {
  let flightsCount = 0;
  let databaseStatus = 'not configured';
  
  try {
    if (USE_DATABASE && FlightModel) {
      const allFlights = await FlightModel.getAll({ recentOnly: false, limit: 1000 });
      flightsCount = allFlights.length;
      databaseStatus = 'connected';
    } else {
      flightsCount = flights.length;
      databaseStatus = 'in-memory mode';
    }
  } catch (error) {
    databaseStatus = 'error: ' + error.message;
  }
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    flightsTracked: flightsCount,
    database: databaseStatus,
    usingDatabase: USE_DATABASE
  });
});

/**
 * Get all flights
 */
app.get('/api/flights', async (req, res) => {
  try {
    const includePast = req.query.includePast === 'true';
    let allFlights;
    
    if (USE_DATABASE && FlightModel) {
      allFlights = await FlightModel.getAll({ recentOnly: true });
    } else {
      allFlights = flights;
    }
    
    // Separate active and past flights
    const activeFlights = includePast ? allFlights : allFlights.filter(f => !isFlightInPast(f));
    const pastFlights = allFlights.filter(f => isFlightInPast(f));
    
    res.json({
      success: true,
      count: activeFlights.length,
      flights: activeFlights,
      pastFlightCount: pastFlights.length,
      usingDatabase: USE_DATABASE
    });
  } catch (error) {
    console.error('Error fetching flights:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch flights'
    });
  }
});

/**
 * Get single flight by ID
 */
app.get('/api/flights/:id', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id);
    let flight;
    
    if (USE_DATABASE && FlightModel) {
      flight = await FlightModel.getById(flightId);
    } else {
      flight = flights.find(f => f.id === flightId);
    }
    
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
  } catch (error) {
    console.error('Error fetching flight:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch flight'
    });
  }
});

/**
 * Get past flights
 */
app.get('/api/flights/past', async (req, res) => {
  try {
    let allFlights;
    
    if (USE_DATABASE && FlightModel) {
      allFlights = await FlightModel.getAll({ recentOnly: false });
    } else {
      allFlights = flights;
    }
    
    // Filter to only past flights
    const pastFlights = allFlights.filter(f => isFlightInPast(f));
    
    res.json({
      success: true,
      count: pastFlights.length,
      flights: pastFlights
    });
  } catch (error) {
    console.error('Error fetching past flights:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch past flights'
    });
  }
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

    let newFlight;
    
    if (USE_DATABASE && FlightModel) {
      // Use database
      newFlight = await FlightModel.create({
        employeeName,
        flightNumber: flightNumber.toUpperCase().replace(/\s/g, ''),
        departureTime: departureTime || new Date().toISOString(),
        origin: origin?.toUpperCase() || null,
        destination: destination?.toUpperCase() || null,
        status: 'checking',
        statusDetails: {}
      });
    } else {
      // Use in-memory storage
      newFlight = {
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
    }

    // Fetch initial status (async, don't wait)
    updateFlightStatus(newFlight.id).catch(err => {
      console.error('Error updating initial flight status:', err);
    });

    res.status(201).json({
      success: true,
      flight: newFlight,
      message: 'Flight added successfully',
      usingDatabase: USE_DATABASE
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
    
    if (USE_DATABASE && FlightModel) {
      const flight = await FlightModel.getById(flightId);
      
      if (!flight) {
        return res.status(404).json({
          success: false,
          error: 'Flight not found'
        });
      }

      const { employeeName, flightNumber, departureTime, origin, destination } = req.body;
      
      const updateData = {};
      if (employeeName) updateData.employee_name = employeeName;
      if (flightNumber) updateData.flight_number = flightNumber.toUpperCase().replace(/\s/g, '');
      if (departureTime) updateData.departure_time = departureTime;
      if (origin) updateData.origin = origin.toUpperCase();
      if (destination) updateData.destination = destination.toUpperCase();

      const updatedFlight = await FlightModel.update(flightId, updateData);

      // Refresh status if flight number changed
      if (flightNumber) {
        await updateFlightStatus(flightId);
      }

      res.json({
        success: true,
        flight: updatedFlight,
        message: 'Flight updated successfully'
      });
    } else {
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
    }
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
app.delete('/api/flights/:id', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id);
    let deletedFlight;
    
    if (USE_DATABASE && FlightModel) {
      deletedFlight = await FlightModel.delete(flightId);
      
      if (!deletedFlight) {
        return res.status(404).json({
          success: false,
          error: 'Flight not found'
        });
      }
    } else {
      const index = flights.findIndex(f => f.id === flightId);

      if (index === -1) {
        return res.status(404).json({
          success: false,
          error: 'Flight not found'
        });
      }

      deletedFlight = flights.splice(index, 1)[0];
    }

    res.json({
      success: true,
      flight: deletedFlight,
      message: 'Flight deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting flight:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete flight'
    });
  }
});

/**
 * Refresh flight status manually
 */
app.post('/api/flights/:id/refresh', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id);
    let flight;
    
    if (USE_DATABASE && FlightModel) {
      flight = await FlightModel.getById(flightId);
    } else {
      flight = flights.find(f => f.id === flightId);
    }

    if (!flight) {
      return res.status(404).json({
        success: false,
        error: 'Flight not found'
      });
    }

    await updateFlightStatus(flightId);

    // Get updated flight
    if (USE_DATABASE && FlightModel) {
      flight = await FlightModel.getById(flightId);
    } else {
      flight = flights.find(f => f.id === flightId);
    }

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

        let newFlight;
        
        if (USE_DATABASE && FlightModel) {
          newFlight = await FlightModel.create({
            employeeName,
            flightNumber: String(flightNumber).toUpperCase().replace(/\s/g, ''),
            departureTime: departureTime ? new Date(departureTime).toISOString() : new Date().toISOString(),
            origin: origin ? String(origin).toUpperCase() : null,
            destination: destination ? String(destination).toUpperCase() : null,
            status: 'checking',
            statusDetails: {}
          });
        } else {
          newFlight = {
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
        }

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
      flights: addedFlights,
      usingDatabase: USE_DATABASE
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

    let results;
    
    if (USE_DATABASE && FlightModel) {
      // Use database search with filters
      const filters = {};
      if (flightNumber) filters.flightNumber = flightNumber;
      if (origin) filters.origin = origin.toUpperCase();
      if (destination) filters.destination = destination.toUpperCase();
      
      results = await FlightModel.getAll(filters);
    } else {
      // Search in tracked flights
      results = flights.filter(flight => {
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
    }

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
╔══════════════════════════════════════════════════════╗
║                                                      ║
║       Employee Flight Tracker - Server Running      ║
║                                                      ║
║  🌐 Server:    http://localhost:${PORT}                 ║
║  📊 API:       http://localhost:${PORT}/api/flights     ║
║  ❤️  Health:    http://localhost:${PORT}/api/health     ║
║                                                      ║
║  📝 Environment: ${process.env.NODE_ENV || 'development'}                  ║
║  ✈️  FlightAware: ${process.env.FLIGHTAWARE_API_KEY ? 'Enabled' : 'Mock Mode'}                   ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
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
