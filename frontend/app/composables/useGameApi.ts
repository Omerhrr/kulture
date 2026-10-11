// Typed API client - the frontend has NO authority over game state.
// All gameplay mutations go through the authoritative backend.

import type {
  Business,
  InteractionResult,
  InventoryItem,
  Job,
  LedgerEntry,
  PaymentIntent,
  Player,
  Region
} from '~/types'

export function useGameApi() {
  const config = useRuntimeConfig()
  const base = config.public.apiBase as string

  const token = () => localStorage.getItem('kk_token') || ''

  async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> | undefined)
    }
    const t = token()
    if (t) headers.Authorization = `Bearer ${t}`
    const res = await fetch(`${base}${path}`, { ...opts, headers })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = (body as any)?.detail
      const message =
        typeof detail === 'string' ? detail : detail?.message || detail?.code || `HTTP ${res.status}`
      const code = typeof detail === 'object' ? detail?.code : message
      throw Object.assign(new Error(message), { code, status: res.status })
    }
    return body as T
  }

  const post = <T>(path: string, data?: unknown) =>
    req<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined })
  const get = <T>(path: string) => req<T>(path, { method: 'GET' })

  return {
    register: (username: string, password: string, display_name: string) =>
      post<{ access_token: string; player_id: string }>('/auth/register', {
        username,
        password,
        display_name
      }),
    login: (username: string, password: string) =>
      post<{ access_token: string; player_id: string }>('/auth/login', { username, password }),

    me: () => get<Player>('/players/me'),
    inventory: () => get<{ items: InventoryItem[] }>('/players/me/inventory'),
    transactions: () => get<LedgerEntry[]>('/players/me/transactions'),

    region: (idOrSlug: string) => get<Region>(`/world/regions/${idOrSlug}`),
    interact: (entity_id: string, position: [number, number, number]) =>
      post<InteractionResult>('/interactions', { entity_id, position }),

    business: (id: string) => get<Business>(`/businesses/${id}`),

    availableJobs: (businessId?: string) =>
      get<Job[]>(`/jobs/available${businessId ? `?business_id=${businessId}` : ''}`),
    myJobs: () => get<Job[]>('/jobs/mine'),
    acceptJob: (id: string) => post<Job>(`/jobs/${id}/accept`),
    pickupJob: (id: string, position: [number, number, number]) =>
      post<Job>(`/jobs/${id}/pickup`, { position }),
    completeJob: (id: string, position: [number, number, number]) =>
      post<Player>(`/jobs/${id}/complete`, { position }),

    purchase: (listing_id: string, quantity: number, idempotency_key: string) =>
      post<PaymentIntent>('/purchases', { listing_id, quantity, idempotency_key }),
    createInvoice: (intentId: string) =>
      post<PaymentIntent>(`/payment-intents/${intentId}/invoice`),
    intent: (intentId: string) => get<PaymentIntent>(`/payment-intents/${intentId}`),
    cancelIntent: (intentId: string) => post<PaymentIntent>(`/payment-intents/${intentId}/cancel`),
    simulateWalletPayment: (invoice_bolt11: string) =>
      post<{ outcome: string; provider_event_id: string }>(
        '/dev/lightning/simulate-wallet-payment',
        { invoice_bolt11 }
      ),
    lightningHealth: () => get<Record<string, any>>('/lightning/health')
  }
}
