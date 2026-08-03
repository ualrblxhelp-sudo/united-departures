'use strict';

/**
 * rank77Watchdog
 *
 * Guards a single high-risk role. Roblox has no per-role permission gate, so
 * this is detect-and-revert rather than prevention: an unauthorized promotion
 * happens, and is undone within one polling cycle.
 *
 * WHY AUTHORIZATION, NOT ACTOR CHECKING
 * -------------------------------------
 * Open Cloud does not reliably expose WHO made a rank change, so "only 105+ may
 * grant it" cannot be enforced by inspecting the actor. It is inverted instead:
 * rank 77 requires a prior authorization recorded by a 105+ staffer. Any holder
 * without one is reverted to their last known rank. That closes the hole even
 * if the change was made on the Roblox website by a compromised account.
 *
 * Requires: ROBLOX_OPENCLOUD_KEY with group:read and group:write scopes.
 */

const GROUP_ID = process.env.ROBLOX_GROUP_ID || '15667508';
const GUARDED_ROLE_RANK = 77;
const MIN_GRANTER_RANK = 105;

// Fallback if a holder has no recorded previous rank (e.g. joined straight into
// 77 before this service ever saw them). Set to your lowest member rank.
const FALLBACK_RANK = 1;

const POLL_INTERVAL_MS = 60 * 1000;
const OPEN_CLOUD_BASE = 'https://apis.roblox.com/cloud/v2';

class Rank77Watchdog {
  /**
   * @param {object} deps
   * @param {object} deps.store        Mongoose model or any {get,set,delete,all} store
   * @param {function} deps.onEvent    Called with ({type, ...}) for logging/alerting
   * @param {string}  [deps.apiKey]
   */
  constructor({ store, onEvent, apiKey } = {}) {
    this.store = store;
    this.onEvent = onEvent || (() => {});
    this.apiKey = apiKey || process.env.ROBLOX_OPENCLOUD_KEY;
    this.timer = null;
    this.running = false;

    // roleId <-> rank mapping, resolved once from the group.
    this.roleCache = null;
  }

  // ---------------------------------------------------------------
  // Open Cloud plumbing
  // ---------------------------------------------------------------

  async request(path, options = {}) {
    if (!this.apiKey) {
      throw new Error('ROBLOX_OPENCLOUD_KEY is not set');
    }

    const res = await fetch(`${OPEN_CLOUD_BASE}${path}`, {
      ...options,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }

    if (!res.ok) {
      const err = new Error(
        `Open Cloud ${res.status} on ${path}: ${body ? JSON.stringify(body) : '(no body)'}`
      );
      err.status = res.status;
      err.body = body;
      throw err;
    }

    return body;
  }

  /** Resolves every role in the group, keyed both ways. */
  async loadRoles(force = false) {
    if (this.roleCache && !force) {
      return this.roleCache;
    }

    const roles = [];
    let pageToken = null;

    do {
      const query = new URLSearchParams({ maxPageSize: '100' });
      if (pageToken) {
        query.set('pageToken', pageToken);
      }

      const page = await this.request(
        `/groups/${GROUP_ID}/roles?${query.toString()}`
      );

      for (const role of page.groupRoles || []) {
        // path looks like groups/123/roles/456
        const id = String(role.id || (role.path || '').split('/').pop());
        roles.push({ id, rank: Number(role.rank), name: role.displayName || role.name });
      }

      pageToken = page.nextPageToken || null;
    } while (pageToken);

    const byRank = new Map();
    const byId = new Map();
    for (const role of roles) {
      byRank.set(role.rank, role);
      byId.set(role.id, role);
    }

    this.roleCache = { roles, byRank, byId };
    return this.roleCache;
  }

  /** Every membership currently sitting at the guarded rank. */
  async listGuardedMembers() {
    const { byRank } = await this.loadRoles();
    const guarded = byRank.get(GUARDED_ROLE_RANK);

    if (!guarded) {
      throw new Error(
        `No role with rank ${GUARDED_ROLE_RANK} exists in group ${GROUP_ID}`
      );
    }

    const members = [];
    let pageToken = null;

    do {
      const query = new URLSearchParams({
        maxPageSize: '100',
        filter: `role == 'groups/${GROUP_ID}/roles/${guarded.id}'`,
      });
      if (pageToken) {
        query.set('pageToken', pageToken);
      }

      const page = await this.request(
        `/groups/${GROUP_ID}/memberships?${query.toString()}`
      );

      for (const m of page.groupMemberships || []) {
        // user looks like users/12345
        const userId = String((m.user || '').split('/').pop());
        const membershipId = String((m.path || '').split('/').pop());
        if (userId) {
          members.push({ userId, membershipId });
        }
      }

      pageToken = page.nextPageToken || null;
    } while (pageToken);

    return members;
  }

  async getRank(userId) {
    const query = new URLSearchParams({
      maxPageSize: '1',
      filter: `user == 'users/${userId}'`,
    });

    const page = await this.request(
      `/groups/${GROUP_ID}/memberships?${query.toString()}`
    );

    const membership = (page.groupMemberships || [])[0];
    if (!membership) {
      return null;
    }

    const { byId } = await this.loadRoles();
    const roleId = String((membership.role || '').split('/').pop());
    const role = byId.get(roleId);

    return role
      ? { rank: role.rank, roleId, roleName: role.name, membershipId: String((membership.path || '').split('/').pop()) }
      : null;
  }

  async setRank(userId, rank) {
    const { byRank } = await this.loadRoles();
    const role = byRank.get(Number(rank));

    if (!role) {
      throw new Error(`No role with rank ${rank} in group ${GROUP_ID}`);
    }

    const current = await this.getRank(userId);
    if (!current) {
      throw new Error(`User ${userId} is not a member of group ${GROUP_ID}`);
    }

    await this.request(
      `/groups/${GROUP_ID}/memberships/${current.membershipId}?updateMask=role`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role: `groups/${GROUP_ID}/roles/${role.id}` }),
      }
    );

    return role;
  }

  // ---------------------------------------------------------------
  // Authorization
  // ---------------------------------------------------------------

  /**
   * Records permission for one user to hold the guarded rank.
   * Verifies the granter is MIN_GRANTER_RANK or above at call time.
   */
  async authorize({ targetUserId, granterUserId, reason }) {
    const granter = await this.getRank(granterUserId);

    if (!granter || granter.rank < MIN_GRANTER_RANK) {
      return {
        ok: false,
        error: `Granting rank ${GUARDED_ROLE_RANK} requires group rank ${MIN_GRANTER_RANK}+. ` +
          `You are rank ${granter ? granter.rank : 'not in the group'}.`,
      };
    }

    await this.store.set(String(targetUserId), {
      userId: String(targetUserId),
      grantedBy: String(granterUserId),
      grantedByRank: granter.rank,
      reason: reason || null,
      grantedAt: new Date().toISOString(),
    });

    this.onEvent({
      type: 'authorized',
      targetUserId: String(targetUserId),
      granterUserId: String(granterUserId),
      reason: reason || null,
    });

    return { ok: true };
  }

  async revoke({ targetUserId, actorUserId }) {
    const actor = await this.getRank(actorUserId);

    if (!actor || actor.rank < MIN_GRANTER_RANK) {
      return {
        ok: false,
        error: `Revoking requires group rank ${MIN_GRANTER_RANK}+.`,
      };
    }

    await this.store.delete(String(targetUserId));

    this.onEvent({
      type: 'revoked',
      targetUserId: String(targetUserId),
      actorUserId: String(actorUserId),
    });

    return { ok: true };
  }

  async isAuthorized(userId) {
    const record = await this.store.get(String(userId));
    return Boolean(record);
  }

  // ---------------------------------------------------------------
  // Rank history
  // ---------------------------------------------------------------

  /**
   * Remembers each member's rank so an unauthorized holder can be put back
   * where they were rather than dumped at a fixed rank.
   */
  async rememberRank(userId, rank) {
    if (Number(rank) === GUARDED_ROLE_RANK) {
      return; // never record the guarded rank as a restore target
    }
    await this.store.setHistory(String(userId), Number(rank));
  }

  async previousRank(userId) {
    const remembered = await this.store.getHistory(String(userId));
    if (typeof remembered === 'number' && remembered !== GUARDED_ROLE_RANK) {
      return remembered;
    }
    return FALLBACK_RANK;
  }

  // ---------------------------------------------------------------
  // Sweep
  // ---------------------------------------------------------------

  async sweep() {
    let members;

    try {
      members = await this.listGuardedMembers();
    } catch (err) {
      this.onEvent({ type: 'error', stage: 'list', message: err.message });
      return { checked: 0, reverted: 0, errors: 1 };
    }

    let reverted = 0;
    let errors = 0;

    for (const member of members) {
      try {
        if (await this.isAuthorized(member.userId)) {
          continue;
        }

        const restoreTo = await this.previousRank(member.userId);
        const role = await this.setRank(member.userId, restoreTo);
        reverted += 1;

        this.onEvent({
          type: 'reverted',
          userId: member.userId,
          fromRank: GUARDED_ROLE_RANK,
          toRank: restoreTo,
          toRoleName: role.name,
        });
      } catch (err) {
        errors += 1;
        this.onEvent({
          type: 'error',
          stage: 'revert',
          userId: member.userId,
          message: err.message,
        });
      }
    }

    return { checked: members.length, reverted, errors };
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  start() {
    if (this.running) {
      return;
    }
    this.running = true;

    const tick = async () => {
      if (!this.running) {
        return;
      }
      try {
        await this.sweep();
      } catch (err) {
        this.onEvent({ type: 'error', stage: 'sweep', message: err.message });
      }
      if (this.running) {
        this.timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    // Refresh roles periodically in case one is renamed or re-ranked.
    setInterval(() => {
      this.loadRoles(true).catch((err) =>
        this.onEvent({ type: 'error', stage: 'roles', message: err.message })
      );
    }, 30 * 60 * 1000).unref?.();

    tick();

    this.onEvent({
      type: 'started',
      groupId: GROUP_ID,
      guardedRank: GUARDED_ROLE_RANK,
      minGranterRank: MIN_GRANTER_RANK,
      intervalMs: POLL_INTERVAL_MS,
    });
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

module.exports = {
  Rank77Watchdog,
  GROUP_ID,
  GUARDED_ROLE_RANK,
  MIN_GRANTER_RANK,
  FALLBACK_RANK,
};
