export interface LicenseVerdict {
  ok: boolean
  reason: string
}

function flagged(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

export function interpretLicense(data: unknown, productId: string): LicenseVerdict {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'License could not be verified.' }
  }
  const body = data as Record<string, unknown>
  if (body.success !== true) return { ok: false, reason: 'That license key is not valid.' }
  const uses = typeof body.uses === 'number' ? body.uses : Number(body.uses)
  if (uses !== 1) return { ok: false, reason: 'That license key was already used.' }
  if (!body.purchase || typeof body.purchase !== 'object') {
    return { ok: false, reason: 'License could not be verified.' }
  }
  const purchase = body.purchase as Record<string, unknown>
  if (flagged(purchase.refunded)) return { ok: false, reason: 'That purchase was refunded.' }
  if (flagged(purchase.chargebacked)) return { ok: false, reason: 'That purchase was charged back.' }
  if (flagged(purchase.disputed)) return { ok: false, reason: 'That purchase is disputed.' }
  if (typeof purchase.product_id === 'string' && purchase.product_id && purchase.product_id !== productId) {
    return { ok: false, reason: 'That license key is for a different product.' }
  }
  return { ok: true, reason: '' }
}

export async function verifyLicense(options: {
  productId: string
  licenseKey: string
  fetchImpl: typeof fetch
}): Promise<LicenseVerdict> {
  let response: Response
  try {
    response = await options.fetchImpl('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        product_id: options.productId,
        license_key: options.licenseKey,
        increment_uses_count: 'true',
      }),
    })
  } catch {
    return { ok: false, reason: 'License service unavailable.' }
  }
  if (!response.ok) return { ok: false, reason: 'License could not be verified.' }
  try {
    const data: unknown = await response.json()
    return interpretLicense(data, options.productId)
  } catch {
    return { ok: false, reason: 'License could not be verified.' }
  }
}
