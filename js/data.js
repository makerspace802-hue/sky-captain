/* ============================================================
   SC.Data — ScriptableObject-style game database.
   Aircraft / airports / licenses / upgrades / missions / lessons.
   Original designs. 777-class & A380-class aircraft are original
   creations "inspired by" those categories (see README licensing note).
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var D = SC.Data = {};

  D.AVATARS = ["🧑‍✈️", "👨‍✈️", "👩‍✈️", "🧔‍♂️", "👱‍♀️", "🧓"];

  /* ---------------- AIRCRAFT ----------------
     flowCruise: fuel units/sec at cruise (design rule baseline 0.1).
     fullRefillCost: $ for 0 -> full tank. pricePerUnit derived. */
  D.AIRCRAFT = [
    { id: "sparrow", name: "SK-1 Sparrow", maker: "SkyWorks", category: "Trainer Prop",
      icon: "🛩️", price: 0, license: "student", fuelCap: 140, fullRefillCost: 1200, flowCruise: 0.10,
      cruiseKmh: 200, maxKmh: 265, stallKmh: 95, vrKmh: 105, vappKmh: 115, rangeKm: 900, pax: 2,
      earnFactor: 1.0, handling: 1.0, desc: "Forgiving 2-seat trainer. Perfect for learning taxi, takeoff and landing." },
    { id: "meridian", name: "RT-42 Meridian", maker: "RegionAir", category: "Turboprop Regional",
      icon: "🛫", price: 85000, license: "ppl", fuelCap: 300, fullRefillCost: 3800, flowCruise: 0.15,
      cruiseKmh: 480, maxKmh: 560, stallKmh: 150, vrKmh: 175, vappKmh: 190, rangeKm: 2200, pax: 48,
      earnFactor: 1.4, handling: 0.9, desc: "48-seat regional workhorse for short hops between cities." },
    { id: "metro", name: "CJ-220 Metro", maker: "CityJet", category: "Small Commercial Jet",
      icon: "✈️", price: 420000, license: "cpl", fuelCap: 640, fullRefillCost: 10500, flowCruise: 0.27,
      cruiseKmh: 780, maxKmh: 870, stallKmh: 200, vrKmh: 235, vappKmh: 245, rangeKm: 4200, pax: 110,
      earnFactor: 1.8, handling: 0.8, desc: "110-seat short/medium-haul jet. The first real airliner." },
    { id: "aurora", name: "SL-320 Aurora", maker: "SkyLiner", category: "Medium Narrow-body",
      icon: "🛬", price: 1900000, license: "atpl", fuelCap: 1320, fullRefillCost: 26000, flowCruise: 0.50,
      cruiseKmh: 840, maxKmh: 910, stallKmh: 210, vrKmh: 255, vappKmh: 260, rangeKm: 6500, pax: 180,
      earnFactor: 2.3, handling: 0.7, desc: "180-seat medium-haul airliner for international routes." },
    { id: "titan", name: "WT-777 Titan", maker: "WideBody Co.", category: "Wide-body Long-haul (777 class)",
      icon: "🛩️", price: 8800000, license: "heavy", fuelCap: 2700, fullRefillCost: 58000, flowCruise: 0.85,
      cruiseKmh: 905, maxKmh: 950, stallKmh: 220, vrKmh: 285, vappKmh: 275, rangeKm: 12000, pax: 350,
      earnFactor: 3.0, handling: 0.55, desc: "350-seat twin-aisle giant. Built for oceans and continents." },
    { id: "colossus", name: "VC-380 Colossus", maker: "VeryLarge Aero", category: "Super Jumbo (A380 class)",
      icon: "🛫", price: 17500000, license: "super", fuelCap: 4100, fullRefillCost: 95000, flowCruise: 1.20,
      cruiseKmh: 900, maxKmh: 945, stallKmh: 225, vrKmh: 295, vappKmh: 280, rangeKm: 14500, pax: 555,
      earnFactor: 3.8, handling: 0.45, desc: "555-seat double-deck flagship. The crown of your career." }
  ];
  D.aircraftById = function (id) {
    for (var i = 0; i < D.AIRCRAFT.length; i++) if (D.AIRCRAFT[i].id === id) return D.AIRCRAFT[i];
    return D.AIRCRAFT[0];
  };

  /* ---------------- UPGRADES (5 levels each) ---------------- */
  D.UPGRADES = [
    { id: "engine", name: "Engine", icon: "🔧", desc: "+4% speed & climb per level", base: 2000, effect: "speed" },
    { id: "fuel", name: "Fuel Efficiency", icon: "🌿", desc: "−5% fuel burn per level", base: 2200, effect: "burn" },
    { id: "avionics", name: "Avionics", icon: "📡", desc: "Better autopilot + ILS guidance", base: 2600, effect: "avionics" },
    { id: "brakes", name: "Brakes", icon: "🛑", desc: "Shorter landing rollout", base: 1500, effect: "brakes" },
    { id: "cabin", name: "Cabin", icon: "💺", desc: "+6% earnings per level", base: 3000, effect: "earn" },
    { id: "airframe", name: "Airframe / Tanks", icon: "⛽", desc: "+6% fuel capacity per level", base: 2800, effect: "tank" }
  ];
  // tier multiplier keeps big-aircraft upgrades proportional
  D.upgradeTier = function (ac) {
    if (ac.price >= 8000000) return 12; if (ac.price >= 1500000) return 6;
    if (ac.price >= 300000) return 3; if (ac.price >= 50000) return 1.6; return 1;
  };
  D.upgradeCost = function (ac, upg, level) { // level 0..4 -> cost of NEXT level
    return Math.round(upg.base * D.upgradeTier(ac) * Math.pow(level + 1, 1.6));
  };

  /* ---------------- LICENSES ---------------- */
  D.LICENSES = [
    { id: "student", name: "Student Pilot", short: "STU", cost: 0, hours: 0, flights: 0, rating: 0, desc: "Trainer aircraft (SK-1 Sparrow)." },
    { id: "ppl", name: "Private Pilot (PPL)", short: "PPL", cost: 5000, hours: 3, flights: 3, rating: 3.0, desc: "Unlocks turboprop regionals." },
    { id: "cpl", name: "Commercial Pilot (CPL)", short: "CPL", cost: 25000, hours: 12, flights: 12, rating: 3.5, desc: "Unlocks small commercial jets." },
    { id: "atpl", name: "Airline Transport (ATPL)", short: "ATPL", cost: 90000, hours: 35, flights: 25, rating: 4.0, desc: "Unlocks medium airliners." },
    { id: "heavy", name: "Heavy / Wide-body", short: "HVY", cost: 250000, hours: 70, flights: 45, rating: 4.2, desc: "Unlocks 777-class wide-bodies." },
    { id: "super", name: "Super Jumbo", short: "SUP", cost: 600000, hours: 130, flights: 70, rating: 4.4, desc: "Unlocks A380-class super jumbos." }
  ];
  D.licenseById = function (id) {
    for (var i = 0; i < D.LICENSES.length; i++) if (D.LICENSES[i].id === id) return D.LICENSES[i];
    return D.LICENSES[0];
  };
  D.licenseRank = function (id) {
    for (var i = 0; i < D.LICENSES.length; i++) if (D.LICENSES[i].id === id) return i;
    return 0;
  };

  /* ---------------- AIRPORTS (real-world data) ---------------- */
  // rwy: { name:"09/27", hdg:90, len:3445 } hdg = primary runway heading
  D.AIRPORTS = [
    { code: "BOM", name: "Chhatrapati Shivaji Intl", city: "Mumbai", country: "India", lat: 19.090, lon: 72.865, elevM: 11, gates: 12, fuelMult: 1.00, rwy: { name: "09/27", hdg: 90, len: 3445 } },
    { code: "GOI", name: "Goa Intl (Dabolim)", city: "Goa", country: "India", lat: 15.380, lon: 73.831, elevM: 56, gates: 6, fuelMult: 1.00, rwy: { name: "08/26", hdg: 80, len: 3410 } },
    { code: "DEL", name: "Indira Gandhi Intl", city: "New Delhi", country: "India", lat: 28.566, lon: 77.103, elevM: 237, gates: 16, fuelMult: 1.00, rwy: { name: "10/28", hdg: 100, len: 4430 } },
    { code: "HYD", name: "Rajiv Gandhi Intl", city: "Hyderabad", country: "India", lat: 17.231, lon: 78.429, elevM: 617, gates: 10, fuelMult: 1.00, rwy: { name: "09/27", hdg: 90, len: 4260 } },
    { code: "DXB", name: "Dubai Intl", city: "Dubai", country: "UAE", lat: 25.253, lon: 55.365, elevM: 19, gates: 20, fuelMult: 0.90, rwy: { name: "12/30", hdg: 120, len: 4000 } },
    { code: "LHR", name: "London Heathrow", city: "London", country: "United Kingdom", lat: 51.470, lon: -0.454, elevM: 25, gates: 24, fuelMult: 1.20, rwy: { name: "09/27", hdg: 90, len: 3902 } },
    { code: "CDG", name: "Paris Charles de Gaulle", city: "Paris", country: "France", lat: 49.009, lon: 2.548, elevM: 119, gates: 22, fuelMult: 1.15, rwy: { name: "08/26", hdg: 80, len: 4215 } },
    { code: "FRA", name: "Frankfurt Airport", city: "Frankfurt", country: "Germany", lat: 50.033, lon: 8.561, elevM: 111, gates: 20, fuelMult: 1.15, rwy: { name: "07/25", hdg: 70, len: 4000 } },
    { code: "JFK", name: "New York JFK", city: "New York", country: "USA", lat: 40.641, lon: -73.778, elevM: 4, gates: 24, fuelMult: 1.10, rwy: { name: "04/22", hdg: 40, len: 3682 } },
    { code: "BOS", name: "Boston Logan Intl", city: "Boston", country: "USA", lat: 42.365, lon: -71.009, elevM: 6, gates: 14, fuelMult: 1.10, rwy: { name: "04/22", hdg: 40, len: 3005 } },
    { code: "LAX", name: "Los Angeles Intl", city: "Los Angeles", country: "USA", lat: 33.942, lon: -118.408, elevM: 38, gates: 22, fuelMult: 1.05, rwy: { name: "06/24", hdg: 60, len: 3682 } },
    { code: "SFO", name: "San Francisco Intl", city: "San Francisco", country: "USA", lat: 37.622, lon: -122.379, elevM: 4, gates: 18, fuelMult: 1.05, rwy: { name: "10/28", hdg: 100, len: 3618 } },
    { code: "SIN", name: "Singapore Changi", city: "Singapore", country: "Singapore", lat: 1.364, lon: 103.991, elevM: 7, gates: 20, fuelMult: 1.00, rwy: { name: "02/20", hdg: 20, len: 4000 } },
    { code: "HND", name: "Tokyo Haneda", city: "Tokyo", country: "Japan", lat: 35.549, lon: 139.780, elevM: 6, gates: 20, fuelMult: 1.10, rwy: { name: "05/23", hdg: 50, len: 3360 } },
    { code: "SYD", name: "Sydney Kingsford Smith", city: "Sydney", country: "Australia", lat: -33.950, lon: 151.181, elevM: 6, gates: 16, fuelMult: 1.05, rwy: { name: "07/25", hdg: 70, len: 3962 } }
  ];
  D.airportByCode = function (code) {
    for (var i = 0; i < D.AIRPORTS.length; i++) if (D.AIRPORTS[i].code === code) return D.AIRPORTS[i];
    return D.AIRPORTS[0];
  };

  /* ---------------- CAREER MISSIONS ---------------- */
  D.MISSIONS = [
    { id: "M1", name: "First Wings", from: "BOM", to: "BOM", acMin: "sparrow", mult: 1.2, prev: null, desc: "Pattern flight at Mumbai: taxi, take off, fly one circuit and land. Your instructor believes in you." },
    { id: "M2", name: "Coastal Hop", from: "BOM", to: "GOI", acMin: "sparrow", mult: 1.2, prev: "M1", desc: "Short coastal hop Mumbai → Goa. Manage fuel and talk to ATC." },
    { id: "M3", name: "Capital Run", from: "BOM", to: "DEL", acMin: "meridian", mult: 1.3, prev: "M2", desc: "Mumbai → New Delhi. Step up to a regional turboprop." },
    { id: "M4", name: "Gulf Crossing", from: "DEL", to: "DXB", acMin: "metro", mult: 1.4, prev: "M3", desc: "Delhi → Dubai over water. Your first international jet sector." },
    { id: "M5", name: "Euro Shuttle", from: "LHR", to: "CDG", acMin: "metro", mult: 1.4, prev: "M4", desc: "London → Paris. Busy European airspace, sharp ATC." },
    { id: "M6", name: "Atlantic Leap", from: "LHR", to: "JFK", acMin: "aurora", mult: 1.6, prev: "M5", desc: "London → New York across the Atlantic. A true airline captain's route." },
    { id: "M7", name: "Coast to Coast", from: "JFK", to: "LAX", acMin: "titan", mult: 1.7, prev: "M6", desc: "New York → Los Angeles in a wide-body. Long, demanding, lucrative." },
    { id: "M8", name: "Pacific Giant", from: "LAX", to: "HND", acMin: "titan", mult: 1.8, prev: "M7", desc: "Los Angeles → Tokyo over the Pacific. Heavy fuel, heavy responsibility." },
    { id: "M9", name: "Kangaroo Route", from: "SIN", to: "SYD", acMin: "titan", mult: 1.8, prev: "M8", desc: "Singapore → Sydney. Night ops and tricky winds." },
    { id: "M10", name: "Super Jumbo World Tour", from: "DXB", to: "SYD", acMin: "colossus", mult: 2.0, prev: "M9", desc: "Dubai → Sydney in the Colossus super jumbo. The crown of your career." }
  ];

  /* ---------------- TRAINING LESSONS ---------------- */
  D.LESSONS = [
    { id: "T1", name: "Ground School: Taxi & Controls", airport: "BOM", desc: "Throttle, brakes, steering. Taxi from gate to runway hold-short.",
      steps: [
        { id: "thr", text: "Advance throttle above 20% to start rolling", hint: "Drag the THROTTLE slider (or W key). Feel the aircraft roll." },
        { id: "steer", text: "Steer with the stick / ← → keys (±10m lateral)", hint: "The stick steers the nose wheel on the ground." },
        { id: "brake", text: "Stop: throttle to 0 and hold BRAKE until speed < 3 kt", hint: "Brakes are on the HUD (or B key). Smooth stops earn ratings." },
        { id: "hold", text: "Taxi to the runway hold-short line and stop", hint: "Follow the yellow taxi line. ATC: request taxi first!" }
      ] },
    { id: "T2", name: "Takeoff & Climb", airport: "BOM", desc: "Line up, full power, rotate and climb to 3,000 ft.",
      steps: [
        { id: "lineup", text: "Line up on the runway centerline", hint: "Request takeoff from ATC, then taxi onto the runway." },
        { id: "power", text: "Full throttle (100%) for takeoff roll", hint: "Keep straight with small stick corrections." },
        { id: "rotate", text: "Rotate at Vr (pull back gently)", hint: "Pitch to ~12°. Don't yank — smooth rotation." },
        { id: "climb", text: "Climb through 3,000 ft", hint: "Hold 12–15° pitch. Gear up after positive climb." }
      ] },
    { id: "T3", name: "Cruise & Navigation", airport: "BOM", desc: "Hold heading and altitude, manage fuel, follow the magenta line.",
      steps: [
        { id: "hdg", text: "Turn to assigned heading 090° (±10°)", hint: "Bank gently; the compass strip shows heading." },
        { id: "alt", text: "Level at 8,000 ft (±300 ft for 10 s)", hint: "Ease the pitch to capture altitude. Try AP for help." },
        { id: "fuel", text: "Check fuel state and note burn rate", hint: "Open the fuel readout. 1 s ≈ 0.1 fuel at cruise (baseline)." },
        { id: "nav", text: "Track the course for 60 s without >20° deviation", hint: "Small corrections. Trim your bank early." }
      ] },
    { id: "T4", name: "Descent, Approach & Landing", airport: "GOI", desc: "Descend, configure flaps + gear, land smoothly on centerline.",
      steps: [
        { id: "desc", text: "Descend below 2,500 ft on final approach", hint: "Reduce throttle, pitch slightly down. V/S ≈ −700 fpm." },
        { id: "cfg", text: "Configure: gear DOWN + full flaps", hint: "Gear (G) and flaps (F) slow you for a stable approach." },
        { id: "align", text: "Align with runway centerline", hint: "The guidance diamond shows lateral error. Crab into wind." },
        { id: "land", text: "Touch down smoothly (< −400 fpm) and stop on runway", hint: "Flare at ~30 ft: gentle back pressure. Then brakes." }
      ] },
    { id: "T5", name: "Full Flight: ATC, Fuel & Earnings", airport: "BOM", dest: "GOI", desc: "Complete Mumbai → Goa flight: clearance to shutdown, ratings and pay.",
      steps: [
        { id: "atctx", text: "Complete 3 correct ATC calls (taxi, takeoff, landing)", hint: "Use 📻 ATC phrases at the right phase. Watch compliance." },
        { id: "takeoff", text: "Take off and climb through 5,000 ft", hint: "Clean up: gear up, flaps up on schedule." },
        { id: "cruise", text: "Reach cruise and hold 60 s", hint: "Time acceleration ⏩ is allowed. Watch fuel." },
        { id: "land", text: "Land at destination and taxi to gate", hint: "Request landing early. After rollout, taxi to parking." }
      ] }
  ];

  /* ---------------- ATC PHRASES ---------------- */
  D.PHRASES = [
    { id: "taxi", label: "Request taxi", tx: "request taxi to runway" },
    { id: "departure", label: "Ready for departure", tx: "ready for departure" },
    { id: "takeoff", label: "Request takeoff", tx: "request takeoff clearance" },
    { id: "approach", label: "Request approach", tx: "request approach" },
    { id: "landing", label: "Request landing", tx: "request landing clearance" },
    { id: "goaround", label: "Going around", tx: "going around" },
    { id: "mayday", label: "Mayday", tx: "mayday mayday mayday" },
    { id: "unable", label: "Unable", tx: "unable" },
    { id: "roger", label: "Roger", tx: "roger" },
    { id: "standby", label: "Stand by", tx: "stand by" }
  ];

  /* ---------------- ACHIEVEMENTS ---------------- */
  D.ACHIEVEMENTS = [
    { id: "first-flight", name: "First Wings", desc: "Complete your first flight" },
    { id: "smooth", name: "Butter Landing", desc: "Land softer than −150 fpm" },
    { id: "long-haul", name: "Long Haul", desc: "Fly a route over 5,000 km" },
    { id: "five-star", name: "Five Star Captain", desc: "Earn a 5.0 flight rating" },
    { id: "titan-pilot", name: "Heavy Driver", desc: "Own a wide-body aircraft" },
    { id: "colossus-pilot", name: "Super Jumbo Captain", desc: "Own the Colossus" },
    { id: "atc-pro", name: "Frequency Pro", desc: "100% ATC compliance in a flight" },
    { id: "world-tour", name: "World Tour", desc: "Visit 10 different airports" },
    { id: "millionaire", name: "Millionaire", desc: "Hold $1,000,000" },
    { id: "controller", name: "Controller", desc: "Complete an ATC shift" }
  ];

  /* ---------------- WORLD LANDMASS (stylized, ~5° cells) ----------------
     72 cols (lon -180..180) × 36 rows (lat 90..-90). '#' = land. */
  D.WORLD_BITMAP = [
    "                                                                        ",
    "        ####   #########            ##################################  ",
    "     ####################        ######################################",
    "   ########################     ######### #############################",
    "  ##########################    #########  ############################",
    "   #########################      #######  ############################",
    "    ########################       ######  ################  ##########",
    "     #######################        #####  ##############     #########",
    "      ######################         ###    ############       ####### ",
    "       ####################           ##     ##########         ###### ",
    "        ####  #############            #      #########          ##### ",
    "         ###   ###########             #       ########          ####  ",
    "          ##    #########              ##       #######           ###   ",
    "           #     ########              ###       ######           ##    ",
    "                  ######               ###        #####           #     ",
    "                   #####               ####       #####                   ",
    "                   #####               #####       ####                   ",
    "                    ####               #####       ###                    ",
    "                    ####               ######      ###               ##  ",
    "                    ####               ######      ##             #######",
    "                     ###               ######      ##            ########",
    "                     ###               #######     #             ########",
    "                     ###               ########             ##  ########",
    "                     ###               ########             ###########",
    "                      ##               #########             ########## ",
    "                      ##                #########             ########  ",
    "                      ##                ##########             ######   ",
    "                       #                 #########               ###    ",
    "                       #                  ########                #     ",
    "                                          ######                           ",
    "                                           ####                            ",
    "                                           ###                             ",
    "                                           ##                              ",
    "                                           #                               ",
    "                                                                        ",
    "                                                                        "
  ];
})();
