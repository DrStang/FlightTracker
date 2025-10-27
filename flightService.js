const axios = require('axios');

/**
 * FlightAware API Service
 * Handles all communication with FlightAware AeroAPI v4
 * Documentation: https://flightaware.com/aeroapi/portal/documentation
 */

class FlightService {
  constructor() {
    this.apiKey = process.env.FLIGHTAWARE_API_KEY;
    this.username = process.env.FLIGHTAWARE_USERNAME;
    this.baseURL = 'https://aeroapi.flightaware.com/aeroapi';
    
    if (!this.apiKey) {
      console.warn('âš ï¸  FLIGHTAWARE_API_KEY not set. Using mock data for demonstration.');
    }
  }

  /**
   * Get flight status from FlightAware API
   * @param {string} flightNumber - Flight number (e.g., "AA1234")
   * @param {string} departureTime - ISO datetime string (optional)
   * @returns {Promise<Object>} Flight status data
   */
  async getFlightStatus(flightNumber, departureTime = null) {
    // If no API key, return mock data
    if (!this.apiKey) {
      return this.getMockFlightStatus(flightNumber);
    }

    try {
      // Parse flight number to extract airline and number
      const parsedFlight = this.parseFlightNumber(flightNumber);
      
      // Format the ident for FlightAware (e.g., "AA1234")
      const ident = `${parsedFlight.airline}${parsedFlight.number}`;

      // Build query parameters - FlightAware API v4 format
      // Note: The /flights/{ident} endpoint returns recent flights automatically
      // and doesn't require start/end parameters
      const params = {};

      // Make API request to FlightAware - correct endpoint format
      const response = await axios.get(`${this.baseURL}/flights/${ident}`, {
        params: params,
        headers: {
          'x-apikey': this.apiKey
        },
        timeout: 10000
      });

      // Process the response
      if (response.data && response.data.flights && response.data.flights.length > 0) {
        const flight = response.data.flights[0];
        return this.formatFlightData(flight);
      } else {
        // No flight found
        return {
          status: 'unknown',
          details: {
            message: 'Flight not found in FlightAware database',
            flightNumber: flightNumber
          }
        };
      }

    } catch (error) {
      console.error('FlightAware API Error:', error.message);
      
      if (error.response) {
        // API returned an error response
        if (error.response.status === 401) {
          throw new Error('Invalid FlightAware API credentials');
        } else if (error.response.status === 404) {
          return {
            status: 'unknown',
            details: {
              message: 'Flight not found',
              flightNumber: flightNumber
            }
          };
        } else if (error.response.status === 429) {
          throw new Error('FlightAware API rate limit exceeded');
        }
      }
      
      throw new Error(`Failed to fetch flight status: ${error.message}`);
    }
  }

  /**
   * Format FlightAware API response into our standard format
   * @param {Object} flightData - Raw flight data from FlightAware
   * @returns {Object} Formatted flight status
   */
  formatFlightData(flightData) {
    let status = 'on-time';
    const details = {
      flightNumber: flightData.ident,
      origin: flightData.origin?.code || 'Unknown',
      destination: flightData.destination?.code || 'Unknown',
      scheduledDeparture: flightData.scheduled_out,
      actualDeparture: flightData.actual_out,
      scheduledArrival: flightData.scheduled_in,
      estimatedArrival: flightData.estimated_in,
      actualArrival: flightData.actual_in,
      aircraftType: flightData.aircraft_type,
      operator: flightData.operator,
      status: flightData.status
    };

    // Determine status based on FlightAware data
    if (flightData.cancelled) {
      status = 'cancelled';
      details.cancellationReason = 'Flight cancelled';
    } else if (flightData.status === 'Cancelled') {
      status = 'cancelled';
    } else if (flightData.status === 'Diverted') {
      status = 'delayed';
      details.divertedTo = flightData.diverted?.code;
    } else if (flightData.delay_minutes && flightData.delay_minutes > 15) {
      status = 'delayed';
      details.delayMinutes = flightData.delay_minutes;
      details.delayReason = 'Flight delayed';
    } else if (flightData.actual_out && flightData.scheduled_out) {
      // Check if departed late
      const scheduledOut = new Date(flightData.scheduled_out);
      const actualOut = new Date(flightData.actual_out);
      const delayMinutes = (actualOut - scheduledOut) / (1000 * 60);
      
      if (delayMinutes > 15) {
        status = 'delayed';
        details.delayMinutes = Math.round(delayMinutes);
      }
    }

    return { status, details };
  }

  /**
   * Parse flight number to extract airline code and number
   * @param {string} flightNumber - Flight number (e.g., "AA1234" or "AA 1234")
   * @returns {Object} Parsed flight info
   */
  parseFlightNumber(flightNumber) {
    const cleaned = flightNumber.replace(/\s/g, '').toUpperCase();
    const match = cleaned.match(/^([A-Z]{2,3})(\d+)$/);
    
    if (match) {
      return {
        airline: match[1],
        number: match[2],
        full: cleaned
      };
    }
    
    // If parsing fails, return as-is
    return {
      airline: cleaned.substring(0, 2),
      number: cleaned.substring(2),
      full: cleaned
    };
  }

  /**
   * Generate mock flight status for testing
   * @param {string} flightNumber - Flight number
   * @returns {Object} Mock flight status
   */
  getMockFlightStatus(flightNumber) {
    // Simulate different statuses based on flight number hash
    const hash = flightNumber.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const statusIndex = hash % 10;

    const statuses = [
      { status: 'on-time', details: { message: 'Flight is on schedule', delayMinutes: 0 } },
      { status: 'on-time', details: { message: 'Flight departed on time', delayMinutes: 0 } },
      { status: 'on-time', details: { message: 'Flight is on schedule', delayMinutes: 0 } },
      { status: 'on-time', details: { message: 'Flight operating normally', delayMinutes: 0 } },
      { status: 'delayed', details: { message: 'Flight delayed due to weather', delayMinutes: 45 } },
      { status: 'delayed', details: { message: 'Flight delayed - mechanical issue', delayMinutes: 120 } },
      { status: 'delayed', details: { message: 'Flight delayed - crew scheduling', delayMinutes: 30 } },
      { status: 'on-time', details: { message: 'Flight is on time', delayMinutes: 0 } },
      { status: 'cancelled', details: { message: 'Flight cancelled due to weather', cancellationReason: 'Weather' } },
      { status: 'on-time', details: { message: 'Flight on schedule', delayMinutes: 0 } }
    ];

    const mockData = statuses[statusIndex];
    
    return {
      ...mockData,
      details: {
        ...mockData.details,
        flightNumber: flightNumber,
        origin: 'JFK',
        destination: 'LAX',
        scheduledDeparture: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        estimatedArrival: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        note: 'âš ï¸ Using mock data - Set FLIGHTAWARE_API_KEY for real data'
      }
    };
  }

  /**
   * Get multiple flights by airline (useful for batch operations)
   * @param {string} airline - Airline code (e.g., "AA")
   * @returns {Promise<Array>} Array of flights
   */
  async getAirlineFlights(airline) {
    if (!this.apiKey) {
      return [];
    }

    try {
      const response = await axios.get(`${this.baseURL}/operators/${airline}/flights`, {
        headers: {
          'x-apikey': this.apiKey
        },
        timeout: 10000
      });

      return response.data.flights || [];
    } catch (error) {
      console.error('Error fetching airline flights:', error.message);
      return [];
    }
  }

  /**
   * Get airport information
   * @param {string} airportCode - ICAO or IATA code
   * @returns {Promise<Object>} Airport details
   */
  async getAirportInfo(airportCode) {
    if (!this.apiKey) {
      return null;
    }

    try {
      const response = await axios.get(`${this.baseURL}/airports/${airportCode}`, {
        headers: {
          'x-apikey': this.apiKey
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching airport info:', error.message);
      return null;
    }
  }
}

module.exports = new FlightService();
