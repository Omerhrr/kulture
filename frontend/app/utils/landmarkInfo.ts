// What you learn when you walk up to a Kaduna landmark (keyed by the bake
// landmark key, plus the two built by Landmarks.vue).
export const LANDMARK_INFO: Record<string, { name: string; text: string }> = {
  murtala_square: { name: 'Murtala Square', text: 'The city’s parade ground, named after General Murtala Mohammed. Rallies, Independence Day parades and Sallah durbars gather here.' },
  central_market: { name: 'Kaduna Central Market', text: 'Kasuwan Barchi’s big sister: grains, pepper, fabric, phones. Market days (Monday & Thursday) are packed from dawn.' },
  abs_stadium: { name: 'Ahmadu Bello Stadium', text: 'Home of Kaduna United. Built in 1965, it has hosted national team matches and big concerts.' },
  gamji_gate: { name: 'Gamji Gate Park', text: 'Named after the gamji tree, this park by the gate is where families picnic on weekend evenings.' },
  kasu: { name: 'Kaduna State University', text: 'KASU - enrol in the School app for Medicine, Computer Science, Banking or Business Admin.' },
  kadpoly: { name: 'Kaduna Polytechnic', text: 'One of Nigeria’s oldest polytechnics (1956). Cheaper fees, shorter courses - the School app has the details.' },
  bello_mosque: { name: 'Sultan Bello Mosque', text: 'One of the city’s great mosques. On Fridays the Jumu’ah crowd fills the courtyard and the street outside.' },
  national_museum: { name: 'National Museum Kaduna', text: 'Nok terracottas, crafts and a living crafts village. Our history is deep.' },
  arewa_house: { name: 'Arewa House', text: 'The former residence of the Sardauna, Sir Ahmadu Bello - now a centre for historical research.' },
  st_joseph: { name: 'St Joseph’s Catholic Cathedral', text: 'Sunday mornings the choir can be heard from the road.' },
  gov_house: { name: 'Sir Kashim Ibrahim House', text: 'Kaduna State Government House.' },
  kaduna_junction: { name: 'Kaduna Junction Station', text: 'The old railway junction - trains to Lagos, Kano and Abuja still rumble through.' },
  lugard_hall: { name: 'Lugard Hall', text: 'Built in the 1950s as the Northern House of Assembly, Lugard Hall is now home to the Kaduna State House of Assembly. Its dome is a city icon.' },
  kajuru_castle: { name: 'Kajuru Castle', text: 'A European-style castle built in the 1980s on the rocks of Kajuru. A favourite weekend trip - book it from the info card when you’re in town.' },
  // Zaria
  emir_palace: { name: 'Emir of Zazzau’s Palace', text: 'Seat of the Emir of Zazzau, one of the oldest emirates in Hausaland. Its decorated mud-brick façade is a masterpiece of Hausa architecture.' },
  zaria_mosque: { name: 'Zaria Central Mosque', text: 'The Friday mosque beside the palace, rebuilt over centuries - the heart of the old walled city.' },
  zaria_city_market: { name: 'Zaria City Market', text: 'The old market inside the Birni walls: grains, leather, kola and spices.' },
  abu_samaru: { name: 'Ahmadu Bello University', text: 'ABU Zaria (1962) - one of Africa’s largest universities, with its main campus here at Samaru.' },
  abu_kongo: { name: 'ABU Kongo Campus', text: 'Home of ABU’s law and administration faculties.' },
  zaria_station: { name: 'Zaria Railway Station', text: 'On the Lagos-Kano line; Sabon Gari grew up around the railway.' },
  ncat: { name: 'Nigerian College of Aviation Technology', text: 'Where Nigeria trains its pilots and air traffic controllers - with its own airfield.' },
  kofar_doka: { name: 'Kofar Doka', text: 'One of the gates in the ancient city wall of Zaria (Birnin Zazzau).' },
  wusasa_church: { name: 'St Bartholomew’s Church, Wusasa', text: 'One of the oldest churches in northern Nigeria (1929), in the Wusasa quarter.' },
  zaria_polo: { name: 'Zaria Polo Ground', text: 'Polo has been played in Zaria since colonial days; tournaments draw crowds and horses from across the north.' },
  central_market_zaria: { name: 'Sabon Gari Market', text: 'Zaria’s biggest market, in Sabon Gari by the railway.' },
  // southern Kaduna + others
  kafanchan_junction: { name: 'Kafanchan Junction', text: 'The railway junction that made Kafanchan: lines to Port Harcourt, Kaduna and Jos meet here.' },
  kagoro_hills: { name: 'Kagoro Hills', text: 'Granite hills over Kagoro, with waterfalls in the rainy season.' },
  kasu_kafanchan: { name: 'KASU Kafanchan Campus', text: 'Kaduna State University’s southern campus.' },
  bg_palace: { name: 'Emir of Birnin Gwari’s Palace', text: 'The old seat of the Birnin Gwari emirate.' },
  bridge: { name: 'River Kaduna Bridge', text: 'Kaduna takes its name from the crocodiles (kada) that once filled this river.' }
}

/** keys that are unique to a town (safe to show outside Kaduna city) */
export const TOWN_INFO_KEYS = new Set(['emir_palace', 'zaria_mosque', 'zaria_city_market', 'abu_samaru', 'abu_kongo', 'zaria_station', 'ncat', 'kofar_doka', 'wusasa_church', 'zaria_polo', 'kafanchan_junction', 'kagoro_hills', 'kasu_kafanchan', 'bg_palace'])
