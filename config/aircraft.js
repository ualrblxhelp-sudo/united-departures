const AIRCRAFT = {
    'CRJ-200': { name: 'Bombardier CRJ-200', shortName: 'CRJ-200', flightAttendants: 1 },
    'CRJ-550': { name: 'Bombardier CRJ-550', shortName: 'CRJ-550', flightAttendants: 2 },
    'CRJ-700': { name: 'Bombardier CRJ-700', shortName: 'CRJ-700', flightAttendants: 2 },
    'ERJ-145': { name: 'Embraer ERJ-145', shortName: 'ERJ-145', flightAttendants: 1 },
    'ERJ-170': { name: 'Embraer ERJ-170', shortName: 'ERJ-170', flightAttendants: 2 },
    'ERJ-175': { name: 'Embraer ERJ-175', shortName: 'ERJ-175', flightAttendants: 2 },
    'A319-100': { name: 'Airbus A319-100', shortName: 'A319-100', flightAttendants: 3 },
    'A320-200': { name: 'Airbus A320-200', shortName: 'A320-200', flightAttendants: 3 },
    'A321neo': { name: 'Airbus A321neo', shortName: 'A321neo', flightAttendants: 5 },
    '737-700': { name: 'Boeing 737-700', shortName: '737-700', flightAttendants: 3 },
    '737-800 NEXT': { name: 'Boeing 737-800 NEXT', shortName: '737-800 NEXT', flightAttendants: 3 },
    '737-900': { name: 'Boeing 737-900', shortName: '737-900', flightAttendants: 3 },
    '737-900ER': { name: 'Boeing 737-900ER', shortName: '737-900ER', flightAttendants: 3 },
    '737 MAX 8': { name: 'Boeing 737 MAX 8', shortName: '737 MAX 8', flightAttendants: 3 },
    '737 MAX 9': { name: 'Boeing 737 MAX 9', shortName: '737 MAX 9', flightAttendants: 3 },
    '757-200': { name: 'Boeing 757-200', shortName: '757-200', flightAttendants: 5 },
    '757-300': { name: 'Boeing 757-300', shortName: '757-300', flightAttendants: 5 },
    '767-300': { name: 'Boeing 767-300', shortName: '767-300', flightAttendants: 6 },
    '767-400': { name: 'Boeing 767-400', shortName: '767-400', flightAttendants: 7 },
    '777-200': { name: 'Boeing 777-200', shortName: '777-200', flightAttendants: 10 },
    '777-300ER': { name: 'Boeing 777-300ER', shortName: '777-300ER', flightAttendants: 10 },
    '787-8 Dreamliner': { name: 'Boeing 787-8 Dreamliner', shortName: '787-8', flightAttendants: 7 },
    '787-9 Dreamliner': { name: 'Boeing 787-9 Dreamliner', shortName: '787-9', flightAttendants: 10 },
    '787-10 Dreamliner': { name: 'Boeing 787-10 Dreamliner', shortName: '787-10', flightAttendants: 10 },
};

const FIXED_POSITIONS = {
    'Customer Service Supervisor': { department: 'Customer Service', max: 1 },
    'Gate Agent': { department: 'Customer Service', max: 2 },
    'Lounge Attendant': { department: 'Customer Service', max: 2 },
    'Customer Service Representative': { department: 'Customer Service', max: 4 },
    'Purser': { department: 'Customer Service', max: 1 },
    'Flight Attendant': { department: 'Customer Service', max: null },
    'Ramp Service Supervisor': { department: 'Ramp Service Agents', max: 1 },
    'Ramp Service Agent': { department: 'Ramp Service Agents', max: 4 },
    'Captain': { department: 'Flight Operations', max: 1 },
    'First Officer': { department: 'Flight Operations', max: 1 },
};

const DEPARTMENTS = ['Customer Service', 'Ramp Service Agents', 'Flight Operations'];

function getPositionsForAircraft(aircraftKey) {
    var aircraft = AIRCRAFT[aircraftKey];
    if (!aircraft) return null;
    var positions = {};
    for (var role in FIXED_POSITIONS) {
        var config = FIXED_POSITIONS[role];
        positions[role] = {
            department: config.department,
            max: role === 'Flight Attendant' ? aircraft.flightAttendants : config.max,
        };
    }
    return positions;
}

function getAircraftChoices() {
    return Object.entries(AIRCRAFT).map(function(entry) {
        return { name: entry[1].name, value: entry[0] };
    });
}

module.exports = { AIRCRAFT, FIXED_POSITIONS, DEPARTMENTS, getPositionsForAircraft, getAircraftChoices };
