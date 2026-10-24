// Shared frontend types mirroring the backend API contract.

export interface Entity {
  id: string
  code: string
  name: string
  entity_type: string
  position: [number, number, number]
  rotation: number
  interaction_radius: number
  is_active: boolean
  business_id: string | null
  npc_agent_code: string | null
  metadata: Record<string, unknown>
}

export interface Region {
  id: string
  name: string
  slug: string
  description: string
  entities: Entity[]
}

export interface Player {
  id: string
  user_id: string
  username: string
  display_name: string
  avatar_id: string
  reputation: number
  ksats_balance: number
  position: [number, number, number] | null
  region_id: string | null
  region_slug?: string | null
  state_version: number
  created_at?: string
}

export interface InventoryItem {
  item_id: string
  code: string
  name: string
  emoji: string
  quantity: number
}

export interface Listing {
  id: string
  item_id: string
  item_code: string
  item_name: string
  emoji: string
  description: string
  price_ksats: number
  price_sats: number
  quantity_available: number
}

export interface Business {
  id: string
  code: string
  name: string
  business_type: string
  status: string
  listings: Listing[]
}

export interface Job {
  id: string
  code: string
  job_type: string
  title: string
  description: string
  status: string
  pickup_state: string
  reward_ksats: number
  reward_reputation: number
  pickup_entity: { id: string; code: string; name: string; position: number[] } | null
  dropoff_entity: { id: string; code: string; name: string; position: number[] } | null
}

export interface PaymentIntent {
  id: string
  status: string
  amount_sats: number
  amount_ksats: number
  item_code: string
  item_name: string
  quantity: number
  purchase_reference: string
  expires_at: string | null
  invoice_bolt11: string | null
  invoice_expires_at: string | null
  provider: string | null
}

export interface InteractionOption {
  kind: 'shop' | 'job_board' | 'pos_kiosk' | 'landmark' | 'transport' | 'dialogue'
  label: string
  business_id: string | null
  npc_agent_code: string | null
}

export interface InteractionResult {
  entity_id: string
  entity_name: string
  options: InteractionOption[]
}

export interface LedgerEntry {
  id: string
  entry_type: string
  asset_type: string
  amount_minor_units: number
  description: string
  transaction_reference: string
  created_at: string
}

export interface ServerEvent {
  type: string
  payload: Record<string, any>
}
