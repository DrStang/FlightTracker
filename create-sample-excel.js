const XLSX = require('xlsx');

// Create sample data
const sampleData = [
  {
    'Employee Name': 'John Doe',
    'Flight Number': 'AA1234',
    'Departure Time': '2025-10-27 10:00',
    'Origin': 'JFK',
    'Destination': 'LAX'
  },
  {
    'Employee Name': 'Jane Smith',
    'Flight Number': 'DL5678',
    'Departure Time': '2025-10-27 14:30',
    'Origin': 'ATL',
    'Destination': 'ORD'
  },
  {
    'Employee Name': 'Bob Johnson',
    'Flight Number': 'UA9012',
    'Departure Time': '2025-10-28 08:15',
    'Origin': 'SFO',
    'Destination': 'SEA'
  },
  {
    'Employee Name': 'Alice Williams',
    'Flight Number': 'SW3456',
    'Departure Time': '2025-10-28 16:45',
    'Origin': 'DEN',
    'Destination': 'PHX'
  },
  {
    'Employee Name': 'Charlie Brown',
    'Flight Number': 'B62890',
    'Departure Time': '2025-10-29 11:20',
    'Origin': 'BOS',
    'Destination': 'MCO'
  }
];

// Create workbook and worksheet
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

// Write to file
XLSX.writeFile(wb, 'sample_flights.xlsx');

console.log('✅ Sample Excel file created: sample_flights.xlsx');
