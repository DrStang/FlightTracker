// Flight Tracker Application
const API_BASE = window.location.origin;

const API_ENDPOINTS = {
    health: `${API_BASE}/api/health`,
    flights: `${API_BASE}/api/flights`,
    upload: `${API_BASE}/api/flights/upload`
};

// Application state
let flights = [];
let autoRefreshInterval = null;
let showPastFlights = false;

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    startAutoRefresh();
});

// Initialize the application
async function initializeApp() {
    await checkServerHealth();
    await loadFlights();
}

// Check server health
async function checkServerHealth() {
    try {
        const response = await fetch(API_ENDPOINTS.health);
        const data = await response.json();
        
        if (data.status === 'ok') {
            updateConnectionStatus(true);
        } else {
            updateConnectionStatus(false);
        }
    } catch (error) {
        console.error('Health check failed:', error);
        updateConnectionStatus(false);
    }
}

// Update connection status indicator
function updateConnectionStatus(isConnected) {
    const statusElement = document.getElementById('connectionStatus');
    
    if (isConnected) {
        statusElement.textContent = '✓ Connected to server';
        statusElement.className = 'connection-status connected';
    } else {
        statusElement.textContent = '✗ Server disconnected';
        statusElement.className = 'connection-status disconnected';
    }
}

// Load all flights from API
async function loadFlights() {
    try {
        const response = await fetch(API_ENDPOINTS.flights);
        const data = await response.json();
        
        if (data.success) {
            flights = data.flights;
            renderFlights();
        } else {
            showToast('Failed to load flights', 'error');
        }
    } catch (error) {
        console.error('Error loading flights:', error);
        showToast('Error loading flights', 'error');
        renderEmptyState();
    }
}

/**
 * Check if a flight is in the past (should match server-side logic)
 */
function isFlightInPast(flight) {
    const now = new Date();
    const statusDetails = flight.status_details || flight.statusDetails || {};
    
    // If we have actual arrival time and it's more than 2 hours ago
    if (statusDetails.actualArrival) {
        const actualArrival = new Date(statusDetails.actualArrival);
        if (!isNaN(actualArrival.getTime())) {
            const hoursSinceLanding = (now - actualArrival) / (1000 * 60 * 60);
            if (hoursSinceLanding > 2) {
                return true;
            }
        }
    }
    
    // If we have estimated arrival and it's more than 2 hours ago
    if (statusDetails.estimatedArrival) {
        const estimatedArrival = new Date(statusDetails.estimatedArrival);
        if (!isNaN(estimatedArrival.getTime())) {
            const hoursSinceEstimated = (now - estimatedArrival) / (1000 * 60 * 60);
            if (hoursSinceEstimated > 2) {
                return true;
            }
        }
    }
    
    // If scheduled arrival is more than 4 hours ago
    if (statusDetails.scheduledArrival) {
        const scheduledArrival = new Date(statusDetails.scheduledArrival);
        if (!isNaN(scheduledArrival.getTime())) {
            const hoursSinceScheduled = (now - scheduledArrival) / (1000 * 60 * 60);
            if (hoursSinceScheduled > 4) {
                return true;
            }
        }
    }
    
    // MAIN FILTER: If departure time is more than 8 hours ago
    // This catches all old flights regardless of status details
    const departureTime = new Date(flight.departure_time || flight.departureTime);
    if (!isNaN(departureTime.getTime())) {
        const hoursSinceDeparture = (now - departureTime) / (1000 * 60 * 60);
        if (hoursSinceDeparture > 8) {
            return true;
        }
    }
    
    return false;
}

// Render flights in card layout
function renderFlights() {
    const container = document.getElementById('flightsContainer');
    
    // DEBUG: Log all flights to see their details
    console.log('All flights:', flights.length);
    flights.forEach(f => {
        const dept = new Date(f.departure_time || f.departureTime);
        const hoursSince = (new Date() - dept) / (1000 * 60 * 60);
        const isPast = isFlightInPast(f);
        console.log(`Flight ${f.flight_number || f.flightNumber}:`, {
            departureTime: f.departure_time || f.departureTime,
            hoursSinceDeparture: hoursSince.toFixed(2),
            isPast: isPast,
            statusDetails: f.status_details || f.statusDetails
        });
    });
    
    // Filter based on showPastFlights toggle
    const displayFlights = showPastFlights 
        ? flights 
        : flights.filter(f => !isFlightInPast(f));
    
    console.log('Display flights:', displayFlights.length, 'Show past:', showPastFlights);
    
    if (displayFlights.length === 0) {
        if (showPastFlights && flights.length > 0) {
            // Show message if no past flights exist
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h3>No past flights</h3>
                    <p>Past flights will appear here after they've completed</p>
                </div>
            `;
        } else {
            renderEmptyState();
        }
        return;
    }
    
    // Update flight count in UI
    updateFlightCount(displayFlights.length, flights.length);
    
    const flightCards = displayFlights.map(flight => renderFlightCard(flight)).join('');
    container.innerHTML = flightCards;
}

// Update flight count display
function updateFlightCount(displayCount, totalCount) {
    const countElement = document.getElementById('flightCount');
    if (countElement) {
        const pastCount = totalCount - displayCount;
        if (showPastFlights) {
            countElement.textContent = `Showing all ${totalCount} flights`;
        } else {
            countElement.textContent = `${displayCount} active flight${displayCount !== 1 ? 's' : ''}${pastCount > 0 ? ` (${pastCount} past)` : ''}`;
        }
    }
}

// Render a single flight card
function renderFlightCard(flight) {
    // Handle both database format (snake_case) and in-memory format (camelCase)
    const employeeName = flight.employee_name || flight.employeeName || 'Unknown Employee';
    const flightNumber = flight.flight_number || flight.flightNumber || 'N/A';
    const origin = flight.origin || 'N/A';
    const destination = flight.destination || 'N/A';
    const departureTime = flight.departure_time || flight.departureTime;
    const status = flight.status || 'checking';
    const statusDetails = flight.status_details || flight.statusDetails || {};
    const lastChecked = flight.last_checked || flight.lastChecked;
    
    const statusBadge = getStatusBadge(status);
    const departureFormatted = departureTime ? formatDateTime(departureTime) : 'Not specified';
    const lastCheckedFormatted = lastChecked ? formatTimeAgo(lastChecked) : 'Never';
    
    // Format status details
    let detailsHtml = '';
    if (statusDetails) {
        if (statusDetails.delayMinutes && statusDetails.delayMinutes > 0) {
            detailsHtml = `<div class="card-details">Delayed ${statusDetails.delayMinutes} minutes</div>`;
        } else if (statusDetails.message) {
            detailsHtml = `<div class="card-details">${escapeHtml(statusDetails.message)}</div>`;
        } else if (status === 'on-time') {
            detailsHtml = '<div class="card-details">On schedule</div>';
        }
        
        // Add aircraft type if available
        if (statusDetails.aircraftType) {
            detailsHtml += `<div class="card-details">Aircraft: ${escapeHtml(statusDetails.aircraftType)}</div>`;
        }
        
        // Add operator if available
        if (statusDetails.operator) {
            detailsHtml += `<div class="card-details">Operator: ${escapeHtml(statusDetails.operator)}</div>`;
        }
        
        // Add note if available (e.g., mock data warning)
        if (statusDetails.note) {
            detailsHtml += `<div class="card-details small">${escapeHtml(statusDetails.note)}</div>`;
        }
    }
    
    return `
        <div class="flight-card" data-flight-id="${flight.id}">
            <div class="flight-card-header">
                <div class="flight-card-title">
                    <div class="employee-name">${escapeHtml(employeeName)}</div>
                    <div class="flight-number">Flight: ${escapeHtml(flightNumber)}</div>
                </div>
                <div class="flight-card-status">
                    ${statusBadge}
                </div>
            </div>
            
            <div class="flight-card-body">
                <div class="route-info">
                    <div class="route-section">
                        <div class="route-label">ORIGIN</div>
                        <div class="route-code">${escapeHtml(origin)}</div>
                    </div>
                    <div class="route-arrow">→</div>
                    <div class="route-section">
                        <div class="route-label">DESTINATION</div>
                        <div class="route-code">${escapeHtml(destination)}</div>
                    </div>
                </div>
                
                ${departureTime ? `<div class="card-info">Departure: ${departureFormatted}</div>` : ''}
                ${detailsHtml}
                ${lastChecked ? `<div class="card-info small">Last checked: ${lastCheckedFormatted}</div>` : ''}
            </div>
            
            <div class="flight-card-actions">
                <button class="card-btn card-btn-refresh" onclick="refreshFlight(${flight.id})">
                    <span>🔄</span> Refresh
                </button>
                <button class="card-btn card-btn-delete" onclick="deleteFlight(${flight.id})">
                    <span>🗑️</span> Delete
                </button>
            </div>
        </div>
    `;
}

// Render a single flight row (kept for compatibility)
function renderFlightRow(flight) {
    // Handle both database format (snake_case) and in-memory format (camelCase)
    const employeeName = flight.employee_name || flight.employeeName || 'Unknown';
    const flightNumber = flight.flight_number || flight.flightNumber || 'N/A';
    const origin = flight.origin || 'N/A';
    const destination = flight.destination || 'N/A';
    const departureTime = flight.departure_time || flight.departureTime;
    const status = flight.status || 'checking';
    const statusDetails = flight.status_details || flight.statusDetails || {};
    const lastChecked = flight.last_checked || flight.lastChecked;
    
    const statusBadge = getStatusBadge(status);
    const departureFormatted = departureTime ? formatDateTime(departureTime) : 'Not specified';
    const lastCheckedFormatted = lastChecked ? formatTimeAgo(lastChecked) : 'Never';
    
    // Format status details
    let detailsHtml = '';
    if (statusDetails) {
        if (statusDetails.delayMinutes && statusDetails.delayMinutes > 0) {
            detailsHtml = `<span style="color: #ed8936;">Delayed ${statusDetails.delayMinutes} min</span>`;
        } else if (statusDetails.message) {
            detailsHtml = escapeHtml(statusDetails.message);
        } else if (status === 'on-time') {
            detailsHtml = '<span style="color: #48bb78;">On schedule</span>';
        }
        
        // Add aircraft type if available
        if (statusDetails.aircraftType) {
            detailsHtml += `<div class="flight-details">Aircraft: ${escapeHtml(statusDetails.aircraftType)}</div>`;
        }
        
        // Add operator if available
        if (statusDetails.operator) {
            detailsHtml += `<div class="flight-details">Operator: ${escapeHtml(statusDetails.operator)}</div>`;
        }
        
        // Add note if available (e.g., mock data warning)
        if (statusDetails.note) {
            detailsHtml += `<div class="flight-details">${escapeHtml(statusDetails.note)}</div>`;
        }
    }
    
    return `
        <tr data-flight-id="${flight.id}">
            <td><strong>${escapeHtml(employeeName)}</strong></td>
            <td><strong>${escapeHtml(flightNumber)}</strong></td>
            <td>${escapeHtml(origin)} → ${escapeHtml(destination)}</td>
            <td>${departureFormatted}</td>
            <td>${statusBadge}</td>
            <td>${detailsHtml || '-'}</td>
            <td>${lastCheckedFormatted}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-refresh" onclick="refreshFlight(${flight.id})">
                        🔄
                    </button>
                    <button class="btn-small btn-delete" onclick="deleteFlight(${flight.id})">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// Get status badge HTML
function getStatusBadge(status) {
    const badges = {
        'on-time': '<span class="status-badge badge-on-time">On Time</span>',
        'delayed': '<span class="status-badge badge-delayed">Delayed</span>',
        'cancelled': '<span class="status-badge badge-cancelled">Cancelled</span>',
        'checking': '<span class="status-badge badge-checking">Checking...</span>',
        'error': '<span class="status-badge badge-error">Error</span>',
        'unknown': '<span class="status-badge badge-checking">Unknown</span>'
    };
    
    return badges[status] || badges['unknown'];
}

// Render empty state
function renderEmptyState() {
    const container = document.getElementById('flightsContainer');
    container.innerHTML = `
        <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <h3>No flights tracked yet</h3>
            <p>Add flights manually or upload an Excel file to get started</p>
        </div>
    `;
}

// Setup event listeners
function setupEventListeners() {
    // Manual form submission
    document.getElementById('manualForm').addEventListener('submit', handleManualFormSubmit);
    
    // File upload
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    
    // Download sample template
    document.getElementById('downloadSample').addEventListener('click', (e) => {
        e.preventDefault();
        downloadSampleTemplate();
    });
    
    // Toggle past flights button
    const toggleBtn = document.getElementById('togglePastFlights');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', togglePastFlightsView);
    }
}

// Toggle past flights view
function togglePastFlightsView() {
    showPastFlights = !showPastFlights;
    const btn = document.getElementById('togglePastFlights');
    
    if (btn) {
        btn.textContent = showPastFlights ? '👁️ Hide Past Flights' : '📜 Show Past Flights';
        btn.style.background = showPastFlights ? '#718096' : '#4299e1';
    }
    
    renderFlights();
    showToast(showPastFlights ? 'Showing all flights' : 'Showing active flights only', 'info');
}

// Handle manual form submission
async function handleManualFormSubmit(event) {
    event.preventDefault();
    
    const employeeName = document.getElementById('employeeName').value.trim();
    const flightNumber = document.getElementById('flightNumber').value.trim();
    const departureTime = document.getElementById('departureTime').value;
    const origin = document.getElementById('origin').value.trim().toUpperCase();
    const destination = document.getElementById('destination').value.trim().toUpperCase();
    
    if (!employeeName || !flightNumber) {
        showToast('Please fill in required fields', 'error');
        return;
    }
    
    const flightData = {
        employeeName,
        flightNumber,
        departureTime: departureTime || new Date().toISOString(),
        origin: origin || null,
        destination: destination || null
    };
    
    try {
        const response = await fetch(API_ENDPOINTS.flights, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(flightData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Flight added successfully!', 'success');
            document.getElementById('manualForm').reset();
            await loadFlights();
        } else {
            showToast(data.error || 'Failed to add flight', 'error');
        }
    } catch (error) {
        console.error('Error adding flight:', error);
        showToast('Error adding flight', 'error');
    }
}

// Download sample Excel template
function downloadSampleTemplate() {
    // Create sample data
    const sampleData = [
        {
            'Employee Name': 'John Doe',
            'Flight Number': 'AA1234',
            'Departure Time': '2025-11-05 10:00',
            'Origin': 'JFK',
            'Destination': 'LAX'
        },
        {
            'Employee Name': 'Jane Smith',
            'Flight Number': 'DL5678',
            'Departure Time': '2025-11-05 14:30',
            'Origin': 'ATL',
            'Destination': 'ORD'
        },
        {
            'Employee Name': 'Bob Johnson',
            'Flight Number': 'UA9012',
            'Departure Time': '2025-11-06 08:15',
            'Origin': 'SFO',
            'Destination': 'SEA'
        },
        {
            'Employee Name': 'Alice Williams',
            'Flight Number': 'SW3456',
            'Departure Time': '2025-11-06 16:45',
            'Origin': 'DEN',
            'Destination': 'PHX'
        },
        {
            'Employee Name': 'Charlie Brown',
            'Flight Number': 'B62890',
            'Departure Time': '2025-11-07 11:20',
            'Origin': 'BOS',
            'Destination': 'MCO'
        }
    ];
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleData);
    
    // Set column widths
    ws['!cols'] = [
        { wch: 20 }, // Employee Name
        { wch: 15 }, // Flight Number
        { wch: 20 }, // Departure Time
        { wch: 10 }, // Origin
        { wch: 12 }  // Destination
    ];
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Flight Data');
    
    // Generate file and trigger download
    XLSX.writeFile(wb, 'flight_tracker_template.xlsx');
    
    showToast('Sample template downloaded!', 'success');
}

// Handle file selection
async function handleFileSelect(event) {
    const file = event.target.files[0];
    
    if (!file) {
        return;
    }
    
    // Validate file type
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        showToast('Please select an Excel file (.xlsx or .xls)', 'error');
        return;
    }
    
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
        showToast('File size must be less than 5MB', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        showToast('Uploading file...', 'success');
        
        const response = await fetch(API_ENDPOINTS.upload, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`Successfully added ${data.added} flights!`, 'success');
            
            if (data.errors && data.errors.length > 0) {
                console.warn('Upload errors:', data.errors);
                showToast(`Warning: ${data.errors.length} rows had errors`, 'error');
            }
            
            await loadFlights();
            event.target.value = ''; // Reset file input
        } else {
            showToast(data.error || 'Failed to upload file', 'error');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        showToast('Error uploading file', 'error');
    }
}

// Refresh a single flight
async function refreshFlight(flightId) {
    try {
        const response = await fetch(`${API_ENDPOINTS.flights}/${flightId}/refresh`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Flight status refreshed', 'success');
            await loadFlights();
        } else {
            showToast(data.error || 'Failed to refresh flight', 'error');
        }
    } catch (error) {
        console.error('Error refreshing flight:', error);
        showToast('Error refreshing flight', 'error');
    }
}

// Delete a flight
async function deleteFlight(flightId) {
    if (!confirm('Are you sure you want to delete this flight?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_ENDPOINTS.flights}/${flightId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Flight deleted successfully', 'success');
            await loadFlights();
        } else {
            showToast(data.error || 'Failed to delete flight', 'error');
        }
    } catch (error) {
        console.error('Error deleting flight:', error);
        showToast('Error deleting flight', 'error');
    }
}

// Start auto-refresh
function startAutoRefresh() {
    // Refresh flights every 30 seconds
    autoRefreshInterval = setInterval(async () => {
        await loadFlights();
    }, 30000);
}

// Format date/time
function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) return 'Invalid date';
    
    const options = {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    
    return date.toLocaleString('en-US', options);
}

// Format time ago
function formatTimeAgo(dateString) {
    if (!dateString) return 'Never';
    
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show toast notification
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
});

// Make functions globally accessible for onclick handlers
window.deleteFlight = deleteFlight;
window.refreshFlight = refreshFlight;
