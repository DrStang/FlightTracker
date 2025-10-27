const db = require('./database');

/**
 * Database Models
 * Provides clean interface for database operations
 */

class FlightModel {
  /**
   * Get all flights with optional filters
   */
  static async getAll(filters = {}) {
    let query = `
      SELECT 
        f.*,
        e.email as employee_email,
        e.department as employee_department
      FROM flights f
      LEFT JOIN employees e ON f.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    // Add filters
    if (filters.status) {
      query += ` AND f.status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }

    if (filters.flightNumber) {
      query += ` AND f.flight_number ILIKE $${paramCount}`;
      params.push(`%${filters.flightNumber}%`);
      paramCount++;
    }

    if (filters.origin) {
      query += ` AND f.origin = $${paramCount}`;
      params.push(filters.origin);
      paramCount++;
    }

    if (filters.destination) {
      query += ` AND f.destination = $${paramCount}`;
      params.push(filters.destination);
      paramCount++;
    }

    // Only show recent flights (last 48 hours)
    if (filters.recentOnly !== false) {
      query += ` AND (f.departure_time > NOW() - INTERVAL '48 hours' OR f.departure_time IS NULL)`;
    }

    query += ` ORDER BY f.created_at DESC`;

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      params.push(filters.limit);
    }

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get flight by ID
   */
  static async getById(id) {
    const query = `
      SELECT 
        f.*,
        e.email as employee_email,
        e.department as employee_department
      FROM flights f
      LEFT JOIN employees e ON f.employee_id = e.id
      WHERE f.id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Create new flight
   */
  static async create(flightData) {
    const {
      employeeName,
      flightNumber,
      departureTime,
      origin,
      destination,
      status = 'checking',
      statusDetails = {}
    } = flightData;

    // Check if employee exists, if not create one
    let employeeId = null;
    if (employeeName) {
      const employeeResult = await db.query(
        'INSERT INTO employees (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id',
        [employeeName]
      );
      
      if (employeeResult.rows.length > 0) {
        employeeId = employeeResult.rows[0].id;
      } else {
        // Employee already exists, get their ID
        const existingEmployee = await db.query(
          'SELECT id FROM employees WHERE name = $1 LIMIT 1',
          [employeeName]
        );
        if (existingEmployee.rows.length > 0) {
          employeeId = existingEmployee.rows[0].id;
        }
      }
    }

    const query = `
      INSERT INTO flights (
        employee_id,
        employee_name,
        flight_number,
        departure_time,
        origin,
        destination,
        status,
        status_details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      employeeId,
      employeeName,
      flightNumber,
      departureTime,
      origin,
      destination,
      status,
      JSON.stringify(statusDetails)
    ];

    const result = await db.query(query, values);
    
    // Log to audit
    await AuditModel.log('INSERT', 'flights', result.rows[0].id, null, flightData);
    
    return result.rows[0];
  }

  /**
   * Update flight
   */
  static async update(id, updateData) {
    const allowedFields = [
      'employee_name',
      'flight_number',
      'departure_time',
      'origin',
      'destination',
      'status',
      'status_details',
      'last_checked'
    ];

    const updates = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = $${paramCount}`);
        values.push(
          key === 'status_details' 
            ? JSON.stringify(updateData[key])
            : updateData[key]
        );
        paramCount++;
      }
    });

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);

    const query = `
      UPDATE flights
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await db.query(query, values);
    
    if (result.rows.length > 0) {
      // Log to audit
      await AuditModel.log('UPDATE', 'flights', id, null, updateData);
      
      // Save to history if status changed
      if (updateData.status) {
        await FlightStatusHistoryModel.create({
          flightId: id,
          status: updateData.status,
          statusDetails: updateData.status_details || {}
        });
      }
    }
    
    return result.rows[0];
  }

  /**
   * Delete flight
   */
  static async delete(id) {
    const query = 'DELETE FROM flights WHERE id = $1 RETURNING *';
    const result = await db.query(query, [id]);
    
    if (result.rows.length > 0) {
      await AuditModel.log('DELETE', 'flights', id, null, result.rows[0]);
    }
    
    return result.rows[0];
  }

  /**
   * Get flight statistics
   */
  static async getStatistics() {
    const query = `
      SELECT 
        status,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM flights
      WHERE departure_time > NOW() - INTERVAL '30 days'
      GROUP BY status
      ORDER BY count DESC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Clean up old flights
   */
  static async cleanupOld(hoursOld = 48) {
    const query = `
      DELETE FROM flights
      WHERE departure_time < NOW() - INTERVAL '1 hour' * $1
      RETURNING id
    `;
    const result = await db.query(query, [hoursOld]);
    return result.rows.length;
  }
}

class EmployeeModel {
  /**
   * Get all employees
   */
  static async getAll() {
    const query = 'SELECT * FROM employees ORDER BY name';
    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Get employee by ID
   */
  static async getById(id) {
    const query = 'SELECT * FROM employees WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Create employee
   */
  static async create(employeeData) {
    const { name, email, department, employee_id } = employeeData;
    
    const query = `
      INSERT INTO employees (name, email, department, employee_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const result = await db.query(query, [name, email, department, employee_id]);
    await AuditModel.log('INSERT', 'employees', result.rows[0].id, null, employeeData);
    
    return result.rows[0];
  }

  /**
   * Update employee
   */
  static async update(id, updateData) {
    const allowedFields = ['name', 'email', 'department', 'employee_id'];
    
    const updates = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = $${paramCount}`);
        values.push(updateData[key]);
        paramCount++;
      }
    });

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);

    const query = `
      UPDATE employees
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await db.query(query, values);
    
    if (result.rows.length > 0) {
      await AuditModel.log('UPDATE', 'employees', id, null, updateData);
    }
    
    return result.rows[0];
  }

  /**
   * Delete employee
   */
  static async delete(id) {
    const query = 'DELETE FROM employees WHERE id = $1 RETURNING *';
    const result = await db.query(query, [id]);
    
    if (result.rows.length > 0) {
      await AuditModel.log('DELETE', 'employees', id, null, result.rows[0]);
    }
    
    return result.rows[0];
  }

  /**
   * Get employee with their flights
   */
  static async getWithFlights(id) {
    const employeeQuery = 'SELECT * FROM employees WHERE id = $1';
    const flightsQuery = 'SELECT * FROM flights WHERE employee_id = $1 ORDER BY departure_time DESC';
    
    const employeeResult = await db.query(employeeQuery, [id]);
    const flightsResult = await db.query(flightsQuery, [id]);
    
    if (employeeResult.rows.length === 0) {
      return null;
    }
    
    return {
      ...employeeResult.rows[0],
      flights: flightsResult.rows
    };
  }
}

class FlightStatusHistoryModel {
  /**
   * Create history entry
   */
  static async create(historyData) {
    const { flightId, status, statusDetails = {} } = historyData;
    
    const query = `
      INSERT INTO flight_status_history (flight_id, status, status_details)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    
    const result = await db.query(query, [
      flightId,
      status,
      JSON.stringify(statusDetails)
    ]);
    
    return result.rows[0];
  }

  /**
   * Get history for a flight
   */
  static async getByFlightId(flightId, limit = 50) {
    const query = `
      SELECT * FROM flight_status_history
      WHERE flight_id = $1
      ORDER BY checked_at DESC
      LIMIT $2
    `;
    
    const result = await db.query(query, [flightId, limit]);
    return result.rows;
  }
}

class AuditModel {
  /**
   * Create audit log entry
   */
  static async log(action, tableName, recordId, userId, changes, ipAddress = null) {
    const query = `
      INSERT INTO audit_logs (action, table_name, record_id, user_id, changes, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    try {
      const result = await db.query(query, [
        action,
        tableName,
        recordId,
        userId,
        JSON.stringify(changes),
        ipAddress
      ]);
      return result.rows[0];
    } catch (error) {
      // Don't throw errors for audit logs to avoid breaking main operations
      console.error('Audit log error:', error);
      return null;
    }
  }

  /**
   * Get audit logs with filters
   */
  static async getAll(filters = {}) {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (filters.action) {
      query += ` AND action = $${paramCount}`;
      params.push(filters.action);
      paramCount++;
    }

    if (filters.tableName) {
      query += ` AND table_name = $${paramCount}`;
      params.push(filters.tableName);
      paramCount++;
    }

    if (filters.recordId) {
      query += ` AND record_id = $${paramCount}`;
      params.push(filters.recordId);
      paramCount++;
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      params.push(filters.limit);
    }

    const result = await db.query(query, params);
    return result.rows;
  }
}

module.exports = {
  FlightModel,
  EmployeeModel,
  FlightStatusHistoryModel,
  AuditModel
};
