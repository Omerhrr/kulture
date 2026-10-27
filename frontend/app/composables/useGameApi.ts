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
    // our session token expired or was revoked: hand back to the login screen
    if (res.status === 401 && t && !path.startsWith('/auth/')) window.dispatchEvent(new Event('kk-auth-expired'))
    if (!res.ok) {
      const detail = (body as any)?.detail
      // 422 = form validation: say which field is wrong, in plain words
      const field = Array.isArray(detail) ? detail[0] : null
      const fieldMsg = field
        ? `${String(field.loc?.[field.loc.length - 1] ?? 'input').replace(/_/g, ' ')}: ${String(field.msg ?? 'invalid').replace(/^(String|Value error),?\s*/i, '')}`
        : ''
      const message =
        typeof detail === 'string'
          ? detail
          : fieldMsg || detail?.message || detail?.code || (res.status >= 500 ? 'The server is busy - please try again in a moment.' : `HTTP ${res.status}`)
      const code = typeof detail === 'object' ? detail?.code : message
      throw Object.assign(new Error(message), { code, status: res.status })
    }
    return body as T
  }

  const post = <T>(path: string, data?: unknown) =>
    req<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined })
  const get = <T>(path: string) => req<T>(path, { method: 'GET' })

  return {
    // generic access for the phone apps (life, social, games, races)
    apiGet: get,
    apiPost: post,
    register: (username: string, password: string, display_name: string) =>
      post<{ access_token: string; player_id: string }>('/auth/register', {
        username,
        password,
        display_name
      }),
    login: (username: string, password: string) =>
      post<{ access_token: string; player_id: string }>('/auth/login', { username, password }),

    me: () => get<Player>('/players/me'),

    // work shifts (server-authoritative pay)
    workState: () => get<{ careers: any[]; shift: any | null }>('/work/state'),
    clockIn: (career: string) => post<{ shift: any }>('/work/clock-in', { career }),
    workTask: () => post<{ shift: any }>('/work/task'),
    clockOut: () => post<{ shift: any }>('/work/clock-out'),

    // home furniture (k-sats)
    home: () => get<{ items: any[]; catalog: any[]; balance_ksats: number }>('/home'),
    homeInit: (items: Array<{ sku: string; x: number; z: number; rot: number }>) => post<{ items: any[]; catalog: any[]; balance_ksats: number }>('/home/init', { items }),
    homeMove: (uid: string, x: number, z: number, rot: number) => req<any>(`/home/items/${uid}`, { method: 'PUT', body: JSON.stringify({ x, z, rot }) }),
    homeBuy: (sku: string, x: number, z: number) => post<{ item: any; items: any[]; catalog: any[]; balance_ksats: number }>('/home/buy', { sku, x, z }),
    venueSpend: (service: string) => post<{ ok: boolean; price_ksats: number; balance_ksats: number }>('/venues/spend', { service }),
    homeSell: (uid: string) => post<{ refund_ksats: number; items: any[]; catalog: any[]; balance_ksats: number }>(`/home/items/${uid}/sell`),

    // billboard adverts (paid with Lightning)
    adBoards: () => get<{ boards: Record<string, any[]>; price_sats_per_day: number; max_days: number; auto_approve: boolean }>('/ads/boards'),
    myAds: () => get<any[]>('/ads/mine'),
    createAd: (ad: Record<string, unknown>) => post<{ ad: any; intent: PaymentIntent }>('/ads', ad),

    // in-game help assistant (real LLM, offline fallback when answer is null)
    ask: (question: string, history: Array<{ role: string; content: string }>, context: Record<string, unknown>) =>
      post<{ answer: string | null; source: string }>('/ask', { question, history, context }),
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
    deposit: (sats: number) =>
      post<{ intent: PaymentIntent; ksats_credits: number }>('/deposits', { sats }),
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
