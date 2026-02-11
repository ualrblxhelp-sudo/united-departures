// config/aircraft.js
// Aircraft fleet definitions - only flight attendant count varies per aircraft
// All other crew positions are fixed across all aircraft types

const AIRCRAFT = {
    '737-800 NEXT': {
        name: 'Boeing 737-800 NEXT',
        shortName: '737-800 NEXT',
        flightAttendants: 4,
    },
    // Add future aircraft here:
    // '777-300ER': { name: 'Boeing 777-300ER', shortName: '777-300ER', flightAttendants: 10 },
    // '787-9': { name: 'Boeing 787-9 Dreamliner', shortName: '787-9', flightAttendants: 8 },
};

// Fixed crew positions (same for every aircraft)
const FIXED_POSITIONS = {
    // Customer Service
    'Customer Service Supervisor': { department: 'Customer Service', max: 1 },
    'Gate Agent': { department: 'Customer Service', max: 2 },
    'Lounge Attendant': { department: 'Customer Service', max: 2 },
    'Customer Service Representative': { department: 'Customer Service', max: 4 },
    'Purser': { department: 'Customer Service', max: 1 },
    'Flight Attendant': { department: 'Customer Service', max: null }, // set per aircraft

    // Ramp Service Agents
    'Ramp Service Supervisor': { department: 'Ramp Service Agents', max: 1 },
    'Ramp Service Agent': { department: 'Ramp Service Agents', max: 4 },

    // Flight Operations
    'Captain': { department: 'Flight Operations', max: 1 },
    'First Officer': { department: 'Flight Operations', max: 1 },
};

// Department display order
const DEPARTMENTS = ['Customer Service', 'Ramp Service Agents', 'Flight Operations'];

// Get all positions for a given aircraft with correct max counts
function getPositionsForAircraft(aircraftKey) {
    const aircraft = AIRCRAFT[aircraftKey];
    if (!aircraft) return null;

    const positions = {};
    for (const [role, config] of Object.entries(FIXED_POSITIONS)) {
        positions[role] = {
            department: config.department,
            max: role === 'Flight Attendant' ? aircraft.flightAttendants : config.max,
        };
    }
    return positions;
}

// Get all aircraft names for dropdown
function getAircraftChoices() {
    return Object.entries(AIRCRAFT).map(([key, val]) => ({
        name: val.name,
        value: key,
    }));
}

module.exports = { AIRCRAFT, FIXED_POSITIONS, DEPARTMENTS, getPositionsForAircraft, getAircraftChoices };
