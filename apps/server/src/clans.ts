import { randomUUID } from 'node:crypto';
import type { ClanDetail, ClanRole, MyClan } from '@si/protocol';
import type { Account, Store } from './store';
import type { WorldService } from './world';

export const CLAN_MAX_MEMBERS = 20;
const CLAN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ]{1,22}[\p{L}\p{N}]$/u;
const CLAN_TAG = /^[A-Z0-9]{2,4}$/;

export type ClanResult<T = null> = { ok: true; value: T } | { ok: false; status: number; error: string };

const ok = <T>(value: T): ClanResult<T> => ({ ok: true, value });
const fail = <T>(status: number, error: string): ClanResult<T> => ({ ok: false, status, error });

/** Clan rules: requests approved by the leader or an officer, at most 20 members, kept across seasons. */
export class ClanService {
  constructor(
    private readonly store: Store,
    private readonly world: WorldService,
    private readonly now: () => number,
    /** Tells the given accounts that their clan view changed. */
    private readonly notify: (accountIds: string[]) => void,
  ) {}

  private memberIds(clanId: string): string[] {
    return this.store.members(clanId).map((m) => m.accountId);
  }

  myClan(accountId: string): MyClan | null {
    const membership = this.store.membership(accountId);
    const clan = membership ? this.store.clan(membership.clanId) : null;
    return membership && clan ? { id: clan.id, name: clan.name, tag: clan.tag, role: membership.role } : null;
  }

  create(account: Account, rawName: string, rawTag: string): ClanResult<MyClan> {
    if (this.store.membership(account.id)) return fail(409, 'ALREADY_IN_CLAN');
    const name = rawName.trim();
    const tag = rawTag.trim().toUpperCase();
    if (!CLAN_NAME.test(name) || !CLAN_TAG.test(tag)) return fail(400, 'BAD_CLAN_NAME');
    if (this.store.clanNameTaken(name, tag)) return fail(409, 'CLAN_TAKEN');
    const id = randomUUID();
    this.store.transaction(() => {
      this.store.createClan(id, name, tag, this.now());
      this.store.addMember(id, account.id, 'leader', this.now());
    });
    this.world.setClan(account.id, id);
    return ok({ id, name, tag, role: 'leader' });
  }

  detail(clanId: string, viewerId: string): ClanResult<ClanDetail> {
    const clan = this.store.clan(clanId);
    if (!clan) return fail(404, 'NO_CLAN');
    const viewer = this.store.membership(viewerId);
    const manages = viewer?.clanId === clanId && viewer.role !== 'member';
    return ok({
      ...clan,
      memberList: this.store.members(clanId),
      requests: manages ? this.store.requests(clanId) : [],
    });
  }

  request(account: Account, clanId: string): ClanResult {
    const clan = this.store.clan(clanId);
    if (!clan) return fail(404, 'NO_CLAN');
    if (this.store.membership(account.id)) return fail(409, 'ALREADY_IN_CLAN');
    if (clan.members >= CLAN_MAX_MEMBERS) return fail(409, 'CLAN_FULL');
    if (this.store.hasRequest(clanId, account.id)) return fail(409, 'ALREADY_REQUESTED');
    this.store.addRequest(clanId, account.id, this.now());
    this.notify(this.memberIds(clanId));
    return ok(null);
  }

  decide(actor: Account, clanId: string, targetId: string, accept: boolean): ClanResult {
    const role = this.store.membership(actor.id);
    if (role?.clanId !== clanId || role.role === 'member') return fail(403, 'NOT_ALLOWED');
    if (!this.store.hasRequest(clanId, targetId)) return fail(404, 'NO_REQUEST');
    if (!accept) {
      this.store.removeRequest(clanId, targetId);
      this.notify([...this.memberIds(clanId), targetId]);
      return ok(null);
    }
    if (this.store.membership(targetId)) {
      this.store.removeRequest(clanId, targetId);
      return fail(409, 'ALREADY_IN_CLAN');
    }
    if ((this.store.clan(clanId)?.members ?? 0) >= CLAN_MAX_MEMBERS) return fail(409, 'CLAN_FULL');
    this.store.addMember(clanId, targetId, 'member', this.now());
    this.world.setClan(targetId, clanId);
    this.notify(this.memberIds(clanId));
    return ok(null);
  }

  /** A leaving leader hands over to the oldest officer, else the oldest member; the last one out closes the clan. */
  leave(account: Account): ClanResult {
    const membership = this.store.membership(account.id);
    if (!membership) return fail(409, 'NOT_MEMBER');
    const { clanId } = membership;
    const others = this.store.members(clanId).filter((m) => m.accountId !== account.id);
    this.store.transaction(() => {
      this.store.removeMember(account.id);
      if (others.length === 0) {
        this.store.deleteClan(clanId);
      } else if (membership.role === 'leader') {
        const heir = others.find((m) => m.role === 'officer') ?? others[0];
        if (heir) this.store.setRole(heir.accountId, 'leader');
      }
    });
    this.world.setClan(account.id, null);
    this.notify([account.id, ...others.map((m) => m.accountId)]);
    return ok(null);
  }

  kick(actor: Account, targetId: string): ClanResult {
    const mine = this.store.membership(actor.id);
    const theirs = this.store.membership(targetId);
    if (!mine || !theirs || mine.clanId !== theirs.clanId || actor.id === targetId)
      return fail(403, 'NOT_ALLOWED');
    const outranks = mine.role === 'leader' || (mine.role === 'officer' && theirs.role === 'member');
    if (!outranks) return fail(403, 'NOT_ALLOWED');
    const members = this.memberIds(mine.clanId);
    this.store.removeMember(targetId);
    this.world.setClan(targetId, null);
    this.notify(members);
    return ok(null);
  }

  setRole(actor: Account, targetId: string, role: ClanRole): ClanResult {
    const mine = this.store.membership(actor.id);
    const theirs = this.store.membership(targetId);
    if (
      mine?.role !== 'leader' ||
      theirs?.clanId !== mine.clanId ||
      targetId === actor.id ||
      role === 'leader'
    ) {
      return fail(403, 'NOT_ALLOWED');
    }
    this.store.setRole(targetId, role);
    this.notify(this.memberIds(mine.clanId));
    return ok(null);
  }
}
