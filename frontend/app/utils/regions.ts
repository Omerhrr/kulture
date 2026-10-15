// Kaduna State: the towns you can live in. Kaduna city is the original
// OpenStreetMap bake; the other towns are authored from public geography
// (see scripts/kaduna-osm/towns.py). You travel between them by road
// (Phone → Travel): a bus/taxi ride along the real highway.
export interface Region {
  id: string
  /** server world_regions.slug */
  slug: string
  name: string
  lga: string
  /** road distance from Kaduna city (km) */
  km: number
  /** shared-taxi fare from Kaduna (kobo) */
  fare: number
  blurb: string
  highway: string
}

export const REGIONS: Region[] = [
  { id: 'kaduna', slug: 'kaduna-city', name: 'Kaduna', lga: 'Kaduna North / South', km: 0, fare: 0, highway: '', blurb: 'The state capital: River Kaduna, Ahmadu Bello Way, Murtala Square, Central Market.' },
  { id: 'zaria', slug: 'zaria', name: 'Zaria', lga: 'Zaria / Sabon Gari', km: 80, fare: 250_000, highway: 'Kaduna-Zaria Expressway', blurb: 'Ancient Zazzau: the walled Birni, the Emir’s palace, Sabon Gari market and ABU Samaru.' },
  { id: 'kachia', slug: 'kachia', name: 'Kachia', lga: 'Kachia', km: 90, fare: 220_000, highway: 'Kaduna-Kachia Road', blurb: 'Farming town on the road south, famous for its market days.' },
  { id: 'saminaka', slug: 'saminaka', name: 'Saminaka', lga: 'Lere', km: 140, fare: 300_000, highway: 'Kaduna-Jos Road', blurb: 'Busy junction town of Lere LGA on the Jos road.' },
  { id: 'birnin_gwari', slug: 'birnin-gwari', name: 'Birnin Gwari', lga: 'Birnin Gwari', km: 130, fare: 300_000, highway: 'Kaduna-Birnin Gwari Road', blurb: 'Gateway to the western forests, with its old emirate.' },
  { id: 'zonkwa', slug: 'zonkwa', name: 'Zonkwa', lga: 'Zangon Kataf', km: 170, fare: 380_000, highway: 'Kachia-Kafanchan Road', blurb: 'Hilly southern town between Kachia and Kafanchan.' },
  { id: 'kafanchan', slug: 'kafanchan', name: 'Kafanchan', lga: "Jema'a", km: 200, fare: 420_000, highway: 'Kaduna-Kafanchan Road', blurb: 'The railway junction town of southern Kaduna, under the Kagoro hills.' }
]

export function regionById(id: string): Region {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0]!
}

/** The town this browser is in (set by travel; read once at load). */
export function currentRegionId(): string {
  if (typeof window === 'undefined') return 'kaduna'
  try {
    const q = new URLSearchParams(window.location.search).get('region')
    if (q && REGIONS.some((r) => r.id === q)) return q
    const v = localStorage.getItem('kk_region')
    if (v && REGIONS.some((r) => r.id === v)) return v
  } catch {}
  return 'kaduna'
}
export const REGION_ID = currentRegionId()
export const IN_KADUNA = REGION_ID === 'kaduna'

export const TOWN = regionById(REGION_ID)
/** "Kaduna Business Centre" -> "Zaria Business Centre" outside the city. */
export function localName(s: string): string {
  return IN_KADUNA ? s : s.replace(/Kaduna/g, TOWN.name)
}
