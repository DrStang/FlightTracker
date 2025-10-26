# ✈️ Employee Flight Tracker

A production-ready, real-time employee flight tracking system with FlightAware API integration. Track flight statuses, receive automatic updates, and manage employee travel efficiently.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

## 🌟 Features

### Core Functionality
- ✅ **Real-time Flight Tracking** - Integration with FlightAware AeroAPI v4
- 📤 **Excel Upload** - Bulk import employee flights via Excel files
- ➕ **Manual Entry** - Add individual flights through web interface
- 🔄 **Automatic Updates** - Scheduled status checks every 5 minutes
- 🎯 **Status Monitoring** - Track on-time, delayed, and cancelled flights
- 🗑️ **Flight Management** - Edit and delete tracked flights
- 📊 **Dashboard** - Clean, modern interface with real-time updates

### Technical Features
- 🔒 **Security** - Helmet.js, CORS, rate limiting, input validation
- 🚀 **Performance** - Response compression, efficient caching
- 🐳 **Docker Ready** - Full containerization support
- 📱 **Responsive Design** - Works on desktop, tablet, and mobile
- 🔧 **Production Ready** - Error handling, logging, health checks
- ⚡ **Auto-refresh** - Frontend updates every 30 seconds

## 📋 Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** 9.0.0 or higher
- **FlightAware API Key** (optional - works with mock data)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your FlightAware API key (optional)
# The app works without an API key using mock data
```

### 3. Start the Server

```bash
# Development mode (with auto-restart)
npm run dev

# OR Production mode
npm start
```

### 4. Open in Browser

Navigate to: **http://localhost:3000**

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# FlightAware API (Get from: https://flightaware.com/commercial/aeroapi/)
FLIGHTAWARE_API_KEY=your_api_key_here
FLIGHTAWARE_USERNAME=your_username_here

# Server Configuration
PORT=3000
NODE_ENV=development

# CORS (Comma-separated list)
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000        # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100        # Max requests per window

# Flight Status Updates
STATUS_UPDATE_INTERVAL=5            # Minutes between updates
```

## 📁 Project Structure

```
employee-flight-tracker/
├── server.js                 # Main Express server
├── flightService.js          # FlightAware API integration
├── package.json              # Dependencies and scripts
├── .env.example              # Environment variables template
├── .gitignore                # Git ignore rules
├── Dockerfile                # Docker container definition
├── docker-compose.yml        # Docker orchestration
├── create-sample-excel.js    # Sample Excel generator
├── public/                   # Frontend files
│   ├── index.html            # Main HTML page
│   ├── styles.css            # Styles
│   └── app.js                # Frontend JavaScript
└── README.md                 # This file
```

## 🎯 Usage

### Adding Flights Manually

1. Fill in the "Add Flight Manually" form:
   - **Employee Name** (required)
   - **Flight Number** (required, e.g., AA1234)
   - **Departure Time** (optional)
   - **Origin** (optional, airport code)
   - **Destination** (optional, airport code)

2. Click "Add Flight"

3. The flight will appear in the dashboard with real-time status

### Uploading Excel Files

1. Prepare an Excel file with these columns:
   - Employee Name
   - Flight Number
   - Departure Time (optional)
   - Origin (optional)
   - Destination (optional)

2. Click the upload area or drag and drop the file

3. Click "Upload File"

4. Flights will be imported and status checks will begin

#### Generate Sample Excel

```bash
npm run create-sample
```

This creates `sample_flights.xlsx` with example data.

### Managing Flights

- **Refresh** - Manually update a flight's status
- **Delete** - Remove a flight from tracking
- **Auto-refresh** - All flights update every 30 seconds in the UI
- **Background Updates** - Server checks all flights every 5 minutes

## 🔌 API Endpoints

### Health Check
```http
GET /api/health
```

### Flights

```http
# Get all flights
GET /api/flights

# Get single flight
GET /api/flights/:id

# Add new flight
POST /api/flights
Content-Type: application/json
{
  "employeeName": "John Doe",
  "flightNumber": "AA1234",
  "departureTime": "2025-10-27T10:00:00Z",
  "origin": "JFK",
  "destination": "LAX"
}

# Update flight
PUT /api/flights/:id
Content-Type: application/json
{
  "employeeName": "John Doe"
}

# Delete flight
DELETE /api/flights/:id

# Refresh flight status
POST /api/flights/:id/refresh

# Upload Excel file
POST /api/flights/upload
Content-Type: multipart/form-data
file: [Excel file]

# Search flights
GET /api/search?flightNumber=AA1234&origin=JFK&destination=LAX
```

## 🐳 Docker Deployment

### Using Docker Compose (Recommended)

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Using Docker Directly

```bash
# Build image
docker build -t flight-tracker .

# Run container
docker run -d \
  --name flight-tracker \
  -p 3000:3000 \
  --env-file .env \
  flight-tracker
```

## 🔐 Security Features

- **Helmet.js** - Security headers
- **CORS** - Cross-origin resource sharing protection
- **Rate Limiting** - 100 requests per 15 minutes per IP
- **Input Validation** - Server-side validation and sanitization
- **File Upload Security** - Size limits, type checking, memory storage
- **XSS Protection** - HTML escaping on frontend

## 📊 Flight Status Logic

The system determines flight status based on:

1. **On-Time**: No delays, departed/arriving as scheduled
2. **Delayed**: Delay > 15 minutes from scheduled time
3. **Cancelled**: Flight explicitly cancelled
4. **Checking**: Status update in progress
5. **Error**: Unable to retrieve status
6. **Unknown**: Flight not found in database

## 🔄 Background Jobs

### Status Updates (Every 5 minutes)
- Checks all tracked flights
- Updates status from FlightAware API
- Respects rate limits (1 second between requests)

### Cleanup (Every hour)
- Removes flights older than 48 hours
- Keeps database lean

## 🛠️ Development

### Running in Development Mode

```bash
npm run dev
```

Uses `nodemon` for automatic server restart on file changes.

### Creating Sample Data

```bash
npm run create-sample
```

Generates `sample_flights.xlsx` for testing uploads.

## 📈 Monitoring

### Health Check Endpoint

```bash
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-10-26T...",
  "uptime": 12345,
  "flightsTracked": 10
}
```

### Logs

The server logs:
- HTTP requests (Morgan)
- Flight status updates
- Errors and warnings
- Scheduled job execution

## 🚧 Troubleshooting

### Port Already in Use

Change the PORT in your `.env` file:
```env
PORT=3001
```

### FlightAware API Issues

The app works without an API key using mock data. If you have an API key:

1. Verify it's correctly set in `.env`
2. Check API rate limits
3. Ensure firewall allows outbound HTTPS connections
4. Check FlightAware API status

### File Upload Errors

- Ensure file is .xlsx or .xls format
- Check file size (max 5MB)
- Verify column names match expected format

## 🔮 Future Enhancements

- [ ] PostgreSQL/MongoDB database integration
- [ ] Redis caching layer
- [ ] User authentication and accounts
- [ ] Email/SMS notifications for delays
- [ ] Flight history and analytics
- [ ] Multi-tenancy support
- [ ] Mobile app (React Native)
- [ ] WebSocket for real-time updates
- [ ] Advanced search and filtering
- [ ] Export reports (PDF, Excel)

## 📚 Documentation

- [Architecture](ARCHITECTURE.md) - System architecture details
- [Deployment](DEPLOYMENT.md) - Production deployment guide
- [Quick Start](QUICKSTART.md) - 5-minute setup guide

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- **FlightAware** - Flight data API
- **Express.js** - Web framework
- **Node.js** - Runtime environment

## 📞 Support

For issues or questions:
- Check the documentation
- Review server logs
- Test API endpoints with curl
- Ensure Node.js version is 18+

## ⚡ Performance Tips

1. **Use Docker** for consistent deployments
2. **Enable caching** with Redis (future enhancement)
3. **Use PM2** for process management in production
4. **Set up monitoring** with health check endpoint
5. **Regular cleanup** of old flights (automatic)

## 🎉 Getting Started Checklist

- [ ] Install Node.js 18+
- [ ] Clone/download the project
- [ ] Run `npm install`
- [ ] Copy `.env.example` to `.env`
- [ ] (Optional) Add FlightAware API key
- [ ] Run `npm start`
- [ ] Open http://localhost:3000
- [ ] Add a test flight or upload sample Excel
- [ ] View real-time status updates!

---

**Built with ❤️ for efficient employee travel management**
