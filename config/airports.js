// config/airports.js
// IATA -> city lookup used for flight-card display (e.g. "DEN Denver").
// The Flight model only stores 3-letter IATA codes, so this map turns them into
// human-friendly city names on the card. Unknown codes gracefully render as just
// the bold IATA code with no city, so nothing breaks if a code isn't listed —
// add entries here as your route network grows.

var AIRPORT_CITIES = {
    // United hubs
    EWR: 'Newark',
    ORD: 'Chicago',
    DEN: 'Denver',
    IAH: 'Houston',
    IAD: 'Washington, D.C.',
    SFO: 'San Francisco',
    LAX: 'Los Angeles',
    GUM: 'Guam',

    // Other major U.S. airports
    ATL: 'Atlanta',
    AUS: 'Austin',
    BOS: 'Boston',
    BNA: 'Nashville',
    BWI: 'Baltimore',
    CLE: 'Cleveland',
    CLT: 'Charlotte',
    CMH: 'Columbus',
    DAL: 'Dallas',
    DCA: 'Washington, D.C.',
    DFW: 'Dallas–Fort Worth',
    DTW: 'Detroit',
    FLL: 'Fort Lauderdale',
    HNL: 'Honolulu',
    IND: 'Indianapolis',
    JAX: 'Jacksonville',
    JFK: 'New York',
    LAS: 'Las Vegas',
    LGA: 'New York',
    MCI: 'Kansas City',
    MCO: 'Orlando',
    MDW: 'Chicago',
    MEM: 'Memphis',
    MIA: 'Miami',
    MKE: 'Milwaukee',
    MSP: 'Minneapolis',
    MSY: 'New Orleans',
    OAK: 'Oakland',
    OGG: 'Kahului',
    OMA: 'Omaha',
    ONT: 'Ontario',
    ORF: 'Norfolk',
    PBI: 'West Palm Beach',
    PDX: 'Portland',
    PHL: 'Philadelphia',
    PHX: 'Phoenix',
    PIT: 'Pittsburgh',
    RDU: 'Raleigh–Durham',
    RSW: 'Fort Myers',
    SAN: 'San Diego',
    SAT: 'San Antonio',
    SEA: 'Seattle',
    SJC: 'San Jose',
    SLC: 'Salt Lake City',
    SMF: 'Sacramento',
    SNA: 'Santa Ana',
    STL: 'St. Louis',
    TPA: 'Tampa',

    // Canada / Mexico
    YYZ: 'Toronto',
    YVR: 'Vancouver',
    YUL: 'Montreal',
    YYC: 'Calgary',
    MEX: 'Mexico City',
    CUN: 'Cancún',
    GDL: 'Guadalajara',
    SJD: 'San José del Cabo',
    PVR: 'Puerto Vallarta',

    // Europe
    LHR: 'London',
    LGW: 'London',
    CDG: 'Paris',
    FRA: 'Frankfurt',
    MUC: 'Munich',
    AMS: 'Amsterdam',
    MAD: 'Madrid',
    BCN: 'Barcelona',
    FCO: 'Rome',
    MXP: 'Milan',
    ZRH: 'Zurich',
    BRU: 'Brussels',
    DUB: 'Dublin',
    LIS: 'Lisbon',
    CPH: 'Copenhagen',
    ARN: 'Stockholm',
    VIE: 'Vienna',
    ATH: 'Athens',
    IST: 'Istanbul',

    // Middle East / Africa
    DXB: 'Dubai',
    DOH: 'Doha',
    TLV: 'Tel Aviv',
    JNB: 'Johannesburg',
    CPT: 'Cape Town',
    ACC: 'Accra',
    LOS: 'Lagos',

    // Asia-Pacific
    NRT: 'Tokyo',
    HND: 'Tokyo',
    ICN: 'Seoul',
    PEK: 'Beijing',
    PVG: 'Shanghai',
    HKG: 'Hong Kong',
    SIN: 'Singapore',
    BKK: 'Bangkok',
    MNL: 'Manila',
    DEL: 'Delhi',
    BOM: 'Mumbai',
    SYD: 'Sydney',
    MEL: 'Melbourne',
    AKL: 'Auckland',

    // Central / South America / Caribbean
    GRU: 'São Paulo',
    GIG: 'Rio de Janeiro',
    EZE: 'Buenos Aires',
    SCL: 'Santiago',
    LIM: 'Lima',
    BOG: 'Bogotá',
    PTY: 'Panama City',
    SJU: 'San Juan',
    SDQ: 'Santo Domingo',
    NAS: 'Nassau',
    MBJ: 'Montego Bay',
};

// Return the display label for an IATA code: "**DEN** Denver", or just "**XXX**"
// when the city isn't known.
function airportLabel(iata) {
    var code = String(iata || '').toUpperCase();
    var city = AIRPORT_CITIES[code];
    return city ? ('**' + code + '** ' + city) : ('**' + code + '**');
}

module.exports = { AIRPORT_CITIES: AIRPORT_CITIES, airportLabel: airportLabel };
