// Employee Flight Tracker - Frontend Application

class FlightTrackerApp {
    constructor() {
        this.API_BASE = window.location.origin;
        this.flights = [];
        this.refreshInterval = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.checkServerHealth();
        await this.loadFlights();
        this.startAutoRefresh();
    }

    // ============================================
    // Server Communication
    // ============================================

    async checkServerHealth() {
        try {
            const response = await fetch(`${this.API_BASE}/api/health`);
            const data = await response.json();
            
            if (data.status === 'ok') {
                this.updateConnectionStatus(true);
            } else {
                this.updateConnectionStatus(false);
            }
        } catch (error) {
            console.error('Server health check failed:', error);
            this.updateConnectionStatus(false);
        }
    }

    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connection-status');
        const statusText = statusEl.querySelector('.status-text');
        
        if (connected) {
            statusEl.classList.add('connected');
            statusEl.classList.remove('disconnected');
            statusText.textContent = 'Connected';
        } else {
            statusEl.classList.add('disconnected');
            statusEl.classList.remove('connected');
            statusText.textContent = 'Disconnected';
        }
    }

    async loadFlights() {
        try {
            const response = await fetch(`${this.API_BASE}/api/flights`);
            const data = await response.json();
            
            if (data.success) {
                this.flights = data.flights;
                this.renderFlights();
                this.updateFlightCount();
            }
        } catch (error) {
            console.error('Failed to load flights:', error);
            this.showToast('Failed to load flights', 'error');
        }
    }

    async addFlight(flightData) {
        try {
            const response = await fetch(`${this.API_BASE}/api/flights`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(flightData)
            });

            const data = await response.json();
            
            if (data.success) {
                this.showToast('Flight added successfully!', 'success');
                await this.loadFlights();
                return true;
            } else {
                this.showToast(data.error || 'Failed to add flight', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error adding flight:', error);
            this.showToast('Failed to add flight', 'error');
            return false;
        }
    }

    async deleteFlight(flightId) {
        if (!confirm('Are you sure you want to delete this flight?')) {
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE}/api/flights/${flightId}`, {
                method: 'DELETE'
            });

            const data = await response.json();
            
            if (data.success) {
                this.showToast('Flight deleted', 'info');
                await this.loadFlights();
            } else {
                this.showToast(data.error || 'Failed to delete flight', 'error');
            }
        } catch (error) {
            console.error('Error deleting flight:', error);
            this.showToast('Failed to delete flight', 'error');
        }
    }

    async refreshFlight(flightId) {
        try {
            const response = await fetch(`${this.API_BASE}/api/flights/${flightId}/refresh`, {
                method: 'POST'
            });

            const data = await response.json();
            
            if (data.success) {
                this.showToast('Flight status updated', 'success');
                await this.loadFlights();
            } else {
                this.showToast(data.error || 'Failed to refresh flight', 'error');
            }
        } catch (error) {
            console.error('Error refreshing flight:', error);
            this.showToast('Failed to refresh flight', 'error');
        }
    }

    async uploadExcel(file) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${this.API_BASE}/api/flights/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (data.success) {
                this.showToast(`Uploaded ${data.added} flights successfully!`, 'success');
                
                if (data.errors && data.errors.length > 0) {
                    console.warn('Upload errors:', data.errors);
                    this.showToast(`${data.errors.length} rows had errors`, 'error');
                }
                
                await this.loadFlights();
                return true;
            } else {
                this.showToast(data.error || 'Failed to upload file', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            this.showToast('Failed to upload file', 'error');
            return false;
        }
    }

    // ============================================
    // Event Listeners
    // ============================================

    setupEventListeners() {
        // Upload form
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('excel-file');
        const uploadForm = document.getElementById('upload-form');
        const uploadBtn = document.getElementById('upload-btn');

        uploadArea.addEventListener('click', () => fileInput.click());
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                this.handleFileSelect(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileSelect(e.target.files[0]);
            }
        });

        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (fileInput.files.length === 0) {
                this.showToast('Please select a file', 'error');
                return;
            }

            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<div class="spinner"></div> Uploading...';

            await this.uploadExcel(fileInput.files[0]);

            uploadBtn.disabled = false;
            uploadBtn.textContent = 'Upload File';
            fileInput.value = '';
            uploadBtn.disabled = true;
        });

        // Manual form
        const manualForm = document.getElementById('manual-form');
        manualForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleManualSubmit(e);
        });

        // Refresh all button
        const refreshAllBtn = document.getElementById('refresh-all-btn');
        refreshAllBtn.addEventListener('click', async () => {
            refreshAllBtn.disabled = true;
            await this.loadFlights();
            refreshAllBtn.disabled = false;
        });

        // Download sample
        const downloadSampleLink = document.getElementById('download-sample');
        downloadSampleLink.addEventListener('click', (e) => {
            e.preventDefault();
            this.downloadSampleTemplate();
        });
    }

    handleFileSelect(file) {
        const uploadBtn = document.getElementById('upload-btn');
        const uploadArea = document.getElementById('upload-area');
        
        if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
            uploadBtn.disabled = false;
            uploadArea.querySelector('.upload-text').innerHTML = `
                <strong>Selected:</strong> ${file.name}<br>
                <small>${(file.size / 1024).toFixed(2)} KB</small>
            `;
        } else {
            uploadBtn.disabled = true;
            this.showToast('Please select a valid Excel file', 'error');
        }
    }

    async handleManualSubmit(e) {
        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        
        const flightData = {
            employeeName: document.getElementById('employee-name').value.trim(),
            flightNumber: document.getElementById('flight-number').value.trim().toUpperCase(),
            departureTime: document.getElementById('departure-time').value || null,
            origin: document.getElementById('origin').value.trim().toUpperCase() || null,
            destination: document.getElementById('destination').value.trim().toUpperCase() || null
        };

        if (!flightData.employeeName || !flightData.flightNumber) {
            this.showToast('Please fill in required fields', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner"></div> Adding...';

        const success = await this.addFlight(flightData);

        if (success) {
            form.reset();
        }

        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Flight';
    }

    // ============================================
    // Rendering
    // ============================================

    renderFlights() {
        const container = document.getElementById('flights-container');
        
        if (this.flights.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                    </svg>
                    <h3>No flights tracked yet</h3>
                    <p>Add a flight manually or upload an Excel file to get started.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.flights.map(flight => this.createFlightCard(flight)).join('');

        // Add event listeners to action buttons
        this.flights.forEach(flight => {
            const refreshBtn = document.getElementById(`refresh-${flight.id}`);
            const deleteBtn = document.getElementById(`delete-${flight.id}`);

            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.refreshFlight(flight.id));
            }

            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => this.deleteFlight(flight.id));
            }
        });
    }

    createFlightCard(flight) {
        const statusClass = flight.status.replace('-', '-');
        const statusText = this.getStatusText(flight.status);
        
        return `
            <div class="flight-card">
                <div class="flight-header">
                    <div class="flight-info">
                        <h3>${this.escapeHtml(flight.employeeName)}</h3>
                        <p class="flight-number-text">Flight: ${this.escapeHtml(flight.flightNumber)}</p>
                    </div>
                    <span class="flight-status-badge ${statusClass}">${statusText}</span>
                </div>

                <div class="flight-details">
                    ${flight.origin ? `
                        <div class="detail-item">
                            <span class="detail-label">Origin</span>
                            <span class="detail-value">${this.escapeHtml(flight.origin)}</span>
                        </div>
                    ` : ''}
                    
                    ${flight.destination ? `
                        <div class="detail-item">
                            <span class="detail-label">Destination</span>
                            <span class="detail-value">${this.escapeHtml(flight.destination)}</span>
                        </div>
                    ` : ''}
                    
                    ${flight.departureTime ? `
                        <div class="detail-item">
                            <span class="detail-label">Departure</span>
                            <span class="detail-value">${this.formatDateTime(flight.departureTime)}</span>
                        </div>
                    ` : ''}
                    
                    ${flight.statusDetails && flight.statusDetails.delayMinutes ? `
                        <div class="detail-item">
                            <span class="detail-label">Delay</span>
                            <span class="detail-value">${flight.statusDetails.delayMinutes} min</span>
                        </div>
                    ` : ''}

                    ${flight.statusDetails && flight.statusDetails.aircraftType ? `
                        <div class="detail-item">
                            <span class="detail-label">Aircraft</span>
                            <span class="detail-value">${this.escapeHtml(flight.statusDetails.aircraftType)}</span>
                        </div>
                    ` : ''}
                </div>

                ${flight.statusDetails && flight.statusDetails.message ? `
                    <p style="color: var(--gray-600); font-size: 0.875rem; margin-top: 1rem;">
                        ${this.escapeHtml(flight.statusDetails.message)}
                    </p>
                ` : ''}

                ${flight.statusDetails && flight.statusDetails.note ? `
                    <p style="color: var(--warning); font-size: 0.875rem; margin-top: 0.5rem;">
                        ${this.escapeHtml(flight.statusDetails.note)}
                    </p>
                ` : ''}

                <div class="flight-actions">
                    <button id="refresh-${flight.id}" class="btn btn-secondary btn-small">
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                        Refresh
                    </button>
                    <button id="delete-${flight.id}" class="btn btn-danger btn-small">
                        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        Delete
                    </button>
                </div>

                ${flight.lastChecked ? `
                    <p class="last-checked">
                        Last checked: ${this.formatTimeAgo(flight.lastChecked)}
                    </p>
                ` : ''}
            </div>
        `;
    }

    updateFlightCount() {
        const countEl = document.getElementById('flight-count');
        const count = this.flights.length;
        countEl.textContent = `${count} flight${count !== 1 ? 's' : ''} tracked`;
    }

    // ============================================
    // Utilities
    // ============================================

    getStatusText(status) {
        const statusMap = {
            'on-time': 'On Time',
            'delayed': 'Delayed',
            'cancelled': 'Cancelled',
            'checking': 'Checking...',
            'error': 'Error',
            'unknown': 'Unknown'
        };
        return statusMap[status] || status;
    }

    formatDateTime(dateString) {
        if (!dateString) return 'N/A';
        
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatTimeAgo(dateString) {
        if (!dateString) return 'Never';
        
        const now = new Date();
        const then = new Date(dateString);
        const seconds = Math.floor((now - then) / 1000);

        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return `${Math.floor(seconds / 86400)} days ago`;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
            error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
            info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
        };

        toast.innerHTML = `
            <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${icons[type] || icons.info}
            </svg>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    downloadSampleTemplate() {
        const csvContent = 'Employee Name,Flight Number,Departure Time,Origin,Destination\n' +
                          'John Doe,AA1234,2025-10-27 10:00,JFK,LAX\n' +
                          'Jane Smith,DL5678,2025-10-27 14:30,ATL,ORD\n' +
                          'Bob Johnson,UA9012,2025-10-28 08:15,SFO,SEA';

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'flight_tracker_template.csv';
        a.click();
        window.URL.revokeObjectURL(url);
    }

    startAutoRefresh() {
        // Refresh every 30 seconds
        this.refreshInterval = setInterval(() => {
            this.loadFlights();
        }, 30000);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new FlightTrackerApp();
});
