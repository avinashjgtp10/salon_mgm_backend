import { AppError } from '../../middleware/error.middleware';
import { paymentMethodsRepository, SalonPaymentMethod } from './payment-methods.repository';

/** Names the app already uses for its own methods/legs — a custom method can't take one. */
const RESERVED_NAMES = new Set([
  'cash', 'card', 'upi', 'ewallet', 'e-wallet', 'e wallet', 'wallet', 'payment machine', 'pos machine',
  'pos_machine', 'package', 'membership', 'gift card', 'gift_card', 'giftcard', 'split', 'bank', 'other',
]);

const MAX_NAME = 40;

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new AppError(400, 'Payment method name is required', 'VALIDATION_ERROR');
  if (name.length > MAX_NAME) throw new AppError(400, `Name must be ${MAX_NAME} characters or fewer`, 'VALIDATION_ERROR');
  // "+" joins split legs into one label, quotes/control chars would corrupt the
  // JSON breakdown stored on split bills.
  if (/[+"\\\u0000-\u001f]/.test(name)) {
    throw new AppError(400, 'Name can’t contain +, quotes or backslashes', 'VALIDATION_ERROR');
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new AppError(400, `"${name}" is already a built-in payment method`, 'VALIDATION_ERROR');
  }
  return name;
}

// The checkout path reads this on every payment, so a database that hasn't had
// Migration/create_salon_payment_methods.sql applied yet must not break
// Cash/Card/UPI — it just means "no custom methods".
async function safeList(salonId: string): Promise<SalonPaymentMethod[]> {
  try {
    return await paymentMethodsRepository.list(salonId);
  } catch (err: any) {
    if (err?.code === '42P01') return [];
    throw err;
  }
}

const duplicate = () => new AppError(409, 'A payment method with this name already exists', 'DUPLICATE');

/** The three methods every salon starts with. Their names are fixed — only on/off is the salon's to change. */
const BUILT_INS = [
  { key: 'cash', name: 'Cash' },
  { key: 'card', name: 'Card' },
  { key: 'upi', name: 'UPI' },
] as const;

// Same tolerance as safeList: before Migration/create_salon_disabled_payment_methods.sql
// is applied nothing can be switched off, so every built-in simply stays on.
async function safeDisabledBuiltIns(salonId: string): Promise<Set<string>> {
  try {
    return new Set(await paymentMethodsRepository.listDisabledBuiltIns(salonId));
  } catch (err: any) {
    if (err?.code === '42P01') return new Set();
    throw err;
  }
}

/**
 * A salon with every method off could not take a single payment, so the last
 * active one (built-in or its own) can't be switched off or deleted.
 * `except` is the method about to go away.
 */
async function assertAnotherActive(salonId: string, except: { builtInKey?: string; customId?: string }): Promise<void> {
  const [disabled, custom] = await Promise.all([safeDisabledBuiltIns(salonId), safeList(salonId)]);
  const builtInLeft = BUILT_INS.some((b) => b.key !== except.builtInKey && !disabled.has(b.key));
  const customLeft = custom.some((m) => m.id !== except.customId && m.is_active);
  if (!builtInLeft && !customLeft) {
    throw new AppError(400, 'At least one payment method must stay active', 'LAST_ACTIVE_METHOD');
  }
}

export const paymentMethodsService = {
  list: (salonId: string) => paymentMethodsRepository.list(salonId),
  listActive: (salonId: string) => paymentMethodsRepository.list(salonId, true),

  /** Cash / Card / UPI with whether the salon currently offers each. */
  async listBuiltIns(salonId: string) {
    const disabled = await safeDisabledBuiltIns(salonId);
    return BUILT_INS.map((b) => ({ key: b.key, name: b.name, is_active: !disabled.has(b.key) }));
  },

  async setBuiltInActive(salonId: string, key: string, isActive: unknown, userId: string | null) {
    const builtIn = BUILT_INS.find((b) => b.key === key.toLowerCase());
    if (!builtIn) throw new AppError(404, 'Payment method not found', 'NOT_FOUND');
    if (typeof isActive !== 'boolean') throw new AppError(400, 'is_active must be true or false', 'VALIDATION_ERROR');

    const currentlyActive = !(await safeDisabledBuiltIns(salonId)).has(builtIn.key);
    if (currentlyActive && !isActive) await assertAnotherActive(salonId, { builtInKey: builtIn.key });
    try {
      await paymentMethodsRepository.setBuiltInDisabled(salonId, builtIn.key, !isActive, userId);
    } catch (err: any) {
      if (err?.code === '42P01') {
        throw new AppError(503, 'Switching built-in methods off isn’t available yet — the database update is pending', 'MIGRATION_PENDING');
      }
      throw err;
    }
    return { key: builtIn.key, name: builtIn.name, is_active: isActive };
  },

  async create(salonId: string, body: { name?: unknown }, userId: string | null): Promise<SalonPaymentMethod> {
    const name = cleanName(body.name);
    if (await paymentMethodsRepository.findByName(salonId, name)) throw duplicate();
    try {
      return await paymentMethodsRepository.create(salonId, name, userId);
    } catch (err: any) {
      if (err?.code === '23505') throw duplicate();
      throw err;
    }
  },

  async update(id: string, salonId: string, body: { name?: unknown; is_active?: unknown }): Promise<SalonPaymentMethod> {
    const existing = await paymentMethodsRepository.findById(id, salonId);
    if (!existing) throw new AppError(404, 'Payment method not found', 'NOT_FOUND');

    const patch: { name?: string; is_active?: boolean } = {};
    if (body.name !== undefined) {
      patch.name = cleanName(body.name);
      const clash = await paymentMethodsRepository.findByName(salonId, patch.name);
      if (clash && clash.id !== id) throw duplicate();
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') throw new AppError(400, 'is_active must be true or false', 'VALIDATION_ERROR');
      patch.is_active = body.is_active;
      if (existing.is_active && !body.is_active) await assertAnotherActive(salonId, { customId: id });
    }
    try {
      const updated = await paymentMethodsRepository.update(id, salonId, patch);
      return updated as SalonPaymentMethod;
    } catch (err: any) {
      if (err?.code === '23505') throw duplicate();
      throw err;
    }
  },

  /**
   * Removes the salon's own method from Settings. Bills store the method by
   * name, so history is untouched; the name is simply free to use again.
   */
  async remove(id: string, salonId: string): Promise<{ id: string }> {
    const existing = await paymentMethodsRepository.findById(id, salonId);
    if (!existing) throw new AppError(404, 'Payment method not found', 'NOT_FOUND');
    if (existing.is_active) await assertAnotherActive(salonId, { customId: id });
    await paymentMethodsRepository.delete(id, salonId);
    return { id };
  },

  /**
   * Gate for NEW payments: a leg that names a custom method this salon has
   * switched off is refused. Unknown labels pass through unchanged — existing
   * flows keep their old behaviour, and history is never re-validated.
   *
   * Switched-off built-ins (Cash/Card/UPI) are refused only when the caller says
   * `includeBuiltIns`. Callers leave it off where the label isn't a real choice:
   * a ₹0 bill is still labelled "Cash" by default, and a machine payment is
   * recorded after the client has already paid on the terminal.
   */
  async assertNotInactive(
    salonId: string | null | undefined,
    label: string | undefined,
    splitDetails?: Record<string, number> | null,
    opts: { includeBuiltIns?: boolean } = {},
  ): Promise<void> {
    if (!salonId) return;
    const legs = new Set<string>();
    for (const part of String(label ?? '').split('+')) if (part.trim()) legs.add(part.trim().toLowerCase());
    for (const [key, amount] of Object.entries(splitDetails ?? {})) if (Number(amount) > 0) legs.add(key.trim().toLowerCase());
    if (legs.size === 0) return;

    const all = await safeList(salonId);
    const blocked = all.find((m) => !m.is_active && legs.has(m.name.trim().toLowerCase()));
    if (blocked) {
      throw new AppError(400, `"${blocked.name}" is inactive and can't be used for new payments`, 'PAYMENT_METHOD_INACTIVE');
    }

    if (opts.includeBuiltIns) {
      const disabled = await safeDisabledBuiltIns(salonId);
      const off = BUILT_INS.find((b) => disabled.has(b.key) && legs.has(b.key));
      if (off) {
        throw new AppError(400, `"${off.name}" is switched off and can't be used for new payments`, 'PAYMENT_METHOD_INACTIVE');
      }
    }
  },

  /** lower-cased name → canonical stored name, for every method the salon ever defined (active or not). */
  async nameMap(salonId: string): Promise<Map<string, string>> {
    const all = await safeList(salonId);
    return new Map(all.map((m) => [m.name.trim().toLowerCase(), m.name.trim()]));
  },
};
