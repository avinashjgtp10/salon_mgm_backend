import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import {
  loadSalonSubscriptions, pickCurrentSubscription, subscriptionEnd,
} from '../subscription-billing/subscription-billing.service';
import { deriveSubscriptionState, isLiveState, type SubscriptionState } from '../subscription-billing/subscription-status';
import { issueSessionTokens } from '../auth/session.util';
import { salonBranchesRepository as repo, type BranchLogin } from './salon-branches.repository';
import { assertVerifyNotBlocked, recordVerifyFail, resetVerifyFails } from './salon-branches.rate-limit';

export interface BranchCtx {
  userId: string;
  salonId: string;
  /**
   * "owner" = a salon owner connecting accounts to their salon. "branchOwner" = an existing Branch Owner (role
   * branch_owner, no salon of their own) connecting salons to their own portal; salonId is then empty.
   */
  kind?: "owner" | "branchOwner";
  /** Set on impersonation sessions (super-admin / branch-owner "enter salon"). */
  impersonatedBy?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const MIN_PASSWORD = 8;
const VERIFY_TTL = '5m';

// One message for every way a connect can fail, so the form can't be used to learn which emails are SalonOX
// customers, which are staff, or which have a paying subscription.
const NOT_CONNECTABLE = () =>
  new AppError(400, "These details can't be connected. Check the email and password, and that the account has an active subscription.", 'BRANCH_NOT_ELIGIBLE');

// bcrypt-compared when the email / username is unknown, so a miss takes as long as a hit.
const DUMMY_HASH = bcrypt.hashSync('salonox-branch-dummy', 10);

const verifySecret = () => {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new AppError(500, 'JWT config missing', 'SERVER_ERROR');
  // Derived, so a verify token can never be replayed as an access token.
  return `${s}:branch-verify`;
};

async function subscriptionInfo(salonId: string): Promise<{ state: SubscriptionState | null; expiresAt: Date | null; live: boolean }> {
  const rows = await loadSalonSubscriptions(pool, salonId);
  const current = pickCurrentSubscription(rows);
  if (!current) return { state: null, expiresAt: null, live: false };
  const { rows: s } = await pool.query(`SELECT is_active FROM salons WHERE id = $1`, [salonId]);
  const end = subscriptionEnd(current);
  const state = deriveSubscriptionState({ status: current.status, periodEnd: end, salonActive: s[0]?.is_active !== false });
  return { state, expiresAt: end, live: isLiveState(state) };
}

const audit = (ctx: Pick<BranchCtx, 'userId' | 'ip' | 'userAgent'>, action: string, parentSalonId: string | null, branchSalonId: string | null) =>
  repo.audit({ parentSalonId, branchSalonId, actorUserId: ctx.userId, action, ip: ctx.ip, userAgent: ctx.userAgent })
    .catch(() => { /* audit is best-effort; never fail the action over it */ });

/** Connected salons (and impersonated sessions) can't connect or manage branches themselves: no nesting. */
const isBranchOwner = (ctx: BranchCtx) => ctx.kind === "branchOwner";

/** Branch login / portal actions only make sense for a salon owner. */
function assertSalonOwner(ctx: BranchCtx) {
  if (isBranchOwner(ctx)) throw new AppError(403, "This is only available to salon owner accounts.", "FORBIDDEN");
}

async function isBranchSession(ctx: BranchCtx): Promise<boolean> {
  if (isBranchOwner(ctx)) return false;
  if (ctx.impersonatedBy) return true;
  return !!(await repo.findByBranchSalon(ctx.salonId));
}

async function assertCanManage(ctx: BranchCtx) {
  if (await isBranchSession(ctx)) {
    throw new AppError(403, "A branch account can't manage branches.", 'FORBIDDEN');
  }
}

function validateUsername(raw: unknown): string {
  const username = String(raw ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new AppError(400, 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore.', 'VALIDATION_ERROR');
  }
  return username;
}

function validatePassword(raw: unknown): string {
  const password = String(raw ?? '');
  if (password.length < MIN_PASSWORD) {
    throw new AppError(400, `Password must be at least ${MIN_PASSWORD} characters.`, 'VALIDATION_ERROR');
  }
  return password;
}

/** Shared by verify (first look) and connect (re-check before writing): can this owner's salon become a branch of ctx's salon? */
async function assertTargetEligible(ctx: BranchCtx, targetUserId: string, targetSalonId: string) {
  if (targetUserId === ctx.userId || (!isBranchOwner(ctx) && targetSalonId === ctx.salonId)) throw NOT_CONNECTABLE();
  const salon = await repo.findOwnedSalon(targetUserId);
  if (!salon || salon.id !== targetSalonId || salon.is_active === false) throw NOT_CONNECTABLE();
  if (isBranchOwner(ctx)) {
    // A branch owner can take any live salon they do not already have (a salon may sit under several branch owners).
    if (await repo.isAssignedToBranchOwner(ctx.userId, salon.id)) throw NOT_CONNECTABLE();
    if (!(await subscriptionInfo(salon.id)).live) throw NOT_CONNECTABLE();
    return salon;
  }
  if (await repo.findByBranchSalon(salon.id)) throw NOT_CONNECTABLE();
  // A salon that already has branches (or its own branch login) is a parent, not a branch.
  if ((await repo.countAsParent(salon.id)) > 0 || (await repo.findLoginByParent(salon.id))) throw NOT_CONNECTABLE();
  if (!(await subscriptionInfo(salon.id)).live) throw NOT_CONNECTABLE();
  return salon;
}

/** Creates the owner's shared branch login (a `branch_owner` user) — used by connect and by "Create branch login". */
async function createLogin(ctx: BranchCtx, usernameRaw: unknown, passwordRaw: unknown): Promise<BranchLogin> {
  const username = validateUsername(usernameRaw);
  const password = validatePassword(passwordRaw);
  if (await repo.findLoginByUsername(username)) throw new AppError(409, 'That username is already taken.', 'USERNAME_TAKEN');
  try {
    const login = await repo.createLogin({
      parentSalonId: ctx.salonId,
      parentName: await repo.findSalonName(ctx.salonId),
      username,
      passwordHash: await bcrypt.hash(password, 10),
      createdBy: ctx.userId,
    });
    void audit(ctx, 'create_login', ctx.salonId, null);
    return login;
  } catch (err: any) {
    if (err?.code === '23505') throw new AppError(409, 'That username is already taken.', 'USERNAME_TAKEN');
    throw err;
  }
}

export const salonBranchesService = {
  /** Step 1: check the other account's email + password. Returns a short-lived token so step 2 never re-sends that password. */
  async verify(ctx: BranchCtx, emailRaw: unknown, passwordRaw: unknown) {
    await assertCanManage(ctx);
    const email = String(emailRaw ?? '').trim().toLowerCase();
    const password = String(passwordRaw ?? '');
    if (!email || !password) throw new AppError(400, 'Email and password are required.', 'VALIDATION_ERROR');
    await assertVerifyNotBlocked(ctx.userId, ctx.ip ?? '');

    const user = await repo.findUserByEmail(email);
    const passwordOk = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    try {
      if (!user || !passwordOk || user.is_active === false || user.role !== 'salon_owner') throw NOT_CONNECTABLE();
      const owned = await repo.findOwnedSalon(user.id);
      if (!owned) throw NOT_CONNECTABLE();
      const salon = await assertTargetEligible(ctx, user.id, owned.id);

      await resetVerifyFails(ctx.userId, ctx.ip ?? '');
      const verifyToken = jwt.sign(
        { purpose: 'branch-verify', parentUserId: ctx.userId, parentSalonId: ctx.salonId, targetUserId: user.id, targetSalonId: salon.id },
        verifySecret(),
        { expiresIn: VERIFY_TTL } as any,
      );
      // Tells the form whether it still has to ask for the branch username + password (only the first connection does).
      return { verifyToken, salonName: salon.name };
    } catch (err) {
      if (err instanceof AppError && err.code === 'BRANCH_NOT_ELIGIBLE') await recordVerifyFail(ctx.userId, ctx.ip ?? '');
      throw err;
    }
  },

  /** Step 2: link the verified account. */
  async connect(ctx: BranchCtx, verifyToken: unknown) {
    await assertCanManage(ctx);
    let claims: any;
    try {
      claims = jwt.verify(String(verifyToken ?? ''), verifySecret());
    } catch {
      throw new AppError(400, 'Your verification expired. Verify the account again.', 'VERIFY_EXPIRED');
    }
    if (claims?.purpose !== 'branch-verify' || claims.parentUserId !== ctx.userId || claims.parentSalonId !== ctx.salonId) {
      throw new AppError(400, 'Your verification expired. Verify the account again.', 'VERIFY_EXPIRED');
    }

    const salon = await assertTargetEligible(ctx, claims.targetUserId, claims.targetSalonId);
    if (isBranchOwner(ctx)) {
      const row = await repo.assignToBranchOwner(ctx.userId, salon.id);
      void audit(ctx, "connect", null, salon.id);
      return { id: row.id, name: salon.name, username: "" };
    }
    // Connecting never asks for credentials. With no branch login yet the salon is only linked; "Create branch login"
    // later gives the login access to the owner's own salon and every linked one.
    const login = await repo.findLoginByParent(ctx.salonId);
    const link = await repo.insertLink({
      parentSalonId: ctx.salonId, branchSalonId: salon.id, createdBy: ctx.userId, branchOwnerUserId: login?.branch_owner_user_id ?? null,
    });
    void audit(ctx, 'connect', ctx.salonId, salon.id);
    return { id: link.id, name: salon.name, username: login?.username ?? "" };
  },

  /** The owner's shared branch login (a `branch_owner` user) — created separately from connecting accounts. */
  async createBranchLogin(ctx: BranchCtx, usernameRaw: unknown, passwordRaw: unknown) {
    assertSalonOwner(ctx);
    await assertCanManage(ctx);
    if (await repo.findLoginByParent(ctx.salonId)) throw new AppError(409, 'This account already has a branch login.', 'LOGIN_EXISTS');
    const login = await createLogin(ctx, usernameRaw, passwordRaw);
    return { username: login.username };
  },

  async list(ctx: BranchCtx) {
    if (isBranchOwner(ctx)) {
      const rows = await repo.listAssignedToBranchOwner(ctx.userId);
      const branches = await Promise.all(rows.map(async (r) => {
        const sub = await subscriptionInfo(r.salon_id);
        return {
          id: r.id,
          branchSalonId: r.salon_id,
          name: r.business_name,
          createdAt: r.created_at,
          // Only salons this branch owner connected themselves can be disconnected here; a super admin's assignments stay.
          removable: r.assigned_by === ctx.userId,
          subscription: { state: sub.state, expiresAt: sub.expiresAt, live: sub.live },
        };
      }));
      return { login: null, branches };
    }
    await assertCanManage(ctx);
    const login = await repo.findLoginByParent(ctx.salonId);
    const rows = await repo.listByParent(ctx.salonId);
    const branches = await Promise.all(rows.map(async (r) => {
      const sub = await subscriptionInfo(r.branch_salon_id);
      return {
        id: r.id,
        branchSalonId: r.branch_salon_id,
        name: r.branch_salon_name,
        createdAt: r.created_at,
        removable: true,
        subscription: { state: sub.state, expiresAt: sub.expiresAt, live: sub.live },
      };
    }));
    return { login: login ? { username: login.username, createdAt: login.created_at } : null, branches };
  },

  /** Topbar menu: can this session open the Branch Owner portal? False (never an error) for connected / impersonated sessions. */
  async portalStatus(ctx: BranchCtx) {
    if (isBranchOwner(ctx) || (await isBranchSession(ctx))) return { hasPortal: false };
    return { hasPortal: !!(await repo.findLoginByParent(ctx.salonId)) };
  },

  /** Change the shared login's username and/or password. A new password signs the login out everywhere. */
  async updateLogin(ctx: BranchCtx, body: { username?: unknown; password?: unknown }) {
    assertSalonOwner(ctx);
    await assertCanManage(ctx);
    const login = await repo.findLoginByParent(ctx.salonId);
    if (!login) throw new AppError(404, 'No branch login yet.', 'NOT_FOUND');
    const hasUsername = body.username !== undefined && body.username !== null && String(body.username).trim() !== '';
    const hasPassword = body.password !== undefined && body.password !== null && String(body.password) !== '';
    if (!hasUsername && !hasPassword) throw new AppError(400, 'Enter a new username or password.', 'VALIDATION_ERROR');

    const fields: { username?: string; passwordHash?: string } = {};
    if (hasUsername) {
      const username = validateUsername(body.username);
      const taken = await repo.findLoginByUsername(username);
      if (taken && taken.id !== login.id) throw new AppError(409, 'That username is already taken.', 'USERNAME_TAKEN');
      fields.username = username;
    }
    if (hasPassword) fields.passwordHash = await bcrypt.hash(validatePassword(body.password), 10);
    try {
      await repo.updateLogin(login, fields);
    } catch (err: any) {
      if (err?.code === '23505') throw new AppError(409, 'That username is already taken.', 'USERNAME_TAKEN');
      throw err;
    }
    void audit(ctx, 'reset_login', ctx.salonId, null);
    return { username: fields.username ?? login.username };
  },

  /** Disconnect. The connected account itself (and its own email login) is untouched. */
  async disconnect(ctx: BranchCtx, id: string) {
    if (isBranchOwner(ctx)) {
      const removed = await repo.removeSelfAssignment(id, ctx.userId);
      if (!removed) throw new AppError(404, "Branch not found", "NOT_FOUND");
      void audit(ctx, "disconnect", null, removed.salon_id);
      return { id };
    }
    await assertCanManage(ctx);
    const link = await repo.findByIdForParent(id, ctx.salonId);
    if (!link) throw new AppError(404, 'Branch not found', 'NOT_FOUND');
    const login = await repo.findLoginByParent(ctx.salonId);
    await repo.removeLink(link.id, link.branch_salon_id, login?.branch_owner_user_id ?? null);
    void audit(ctx, 'disconnect', ctx.salonId, link.branch_salon_id);
    return { id: link.id };
  },

  /**
   * Settings / profile menu "Open Branch Portal": a real session for the shared branch_owner login, without ending its
   * other sessions. The frontend keeps the owner's own session to come back to.
   */
  async openPortal(ctx: BranchCtx) {
    assertSalonOwner(ctx);
    await assertCanManage(ctx);
    const login = await repo.findLoginByParent(ctx.salonId);
    if (!login) throw new AppError(404, 'Create the branch login first.', 'NOT_FOUND');
    const { accessToken, refreshToken } = await issueSessionTokens({
      userId: login.branch_owner_user_id, role: 'branch_owner', salonId: null, kickOthers: false, clientType: 'web',
    });
    void audit(ctx, 'open_portal', ctx.salonId, null);
    return { accessToken, refreshToken, isOnboardingComplete: true };
  },

  /**
   * Username sign-in: maps a branch username to its branch_owner user's sign-in email, so the normal login path does
   * the password check, session and response. Unknown username and wrong password look identical (null, after a dummy
   * bcrypt so the timing matches).
   */
  async resolveLoginEmail(usernameRaw: string, passwordRaw: string): Promise<string | null> {
    const email = await repo.findLoginEmailByUsername(String(usernameRaw ?? '').trim().toLowerCase());
    if (!email) await bcrypt.compare(String(passwordRaw ?? ''), DUMMY_HASH);
    return email;
  },
};
