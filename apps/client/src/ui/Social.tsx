import type { ChatChannel, ClanDetail, ClanRole, ClanSummary } from '@si/protocol';
import { useEffect, useRef, useState } from 'react';
import {
  createClan,
  decideRequest,
  kickMember,
  leaveClan,
  loadClan,
  requestJoin,
  searchClans,
  sendChat,
  setMemberRole,
} from '../game/session';
import { t, type Lang, type MessageKey } from '../i18n';
import { useGame } from '../store';

const CHAT_MAX = 200;
const CLAN_MAX = 20;
const ROLE_TEXT: Record<ClanRole, MessageKey> = {
  leader: 'roleLeader',
  officer: 'roleOfficer',
  member: 'roleMember',
};

function Chat({ lang }: { lang: Lang }) {
  const [channel, setChannel] = useState<ChatChannel>('global');
  const [text, setText] = useState('');
  const messages = useGame((s) => s.chat[channel]);
  const inClan = useGame((s) => s.clan !== null);
  const me = useGame((s) => s.profile?.id);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, channel]);

  const disabled = channel === 'clan' && !inClan;
  return (
    <div className="chat" data-testid="chat">
      <div className="segmented" role="group" aria-label={t(lang, 'tabChat')}>
        {(['global', 'clan'] as const).map((c) => (
          <button
            key={c}
            type="button"
            className="small"
            data-testid={`chat-${c}`}
            aria-pressed={channel === c}
            onClick={() => setChannel(c)}
          >
            {t(lang, c === 'global' ? 'chatGlobal' : 'chatClan')}
          </button>
        ))}
      </div>
      <ol className="chat-list" ref={listRef} aria-live="polite">
        {disabled ? (
          <li className="muted">{t(lang, 'chatNoClan')}</li>
        ) : messages.length === 0 ? (
          <li className="muted">{t(lang, 'chatEmpty')}</li>
        ) : (
          messages.map((m) => (
            <li key={m.id} className={m.accountId === me ? 'mine' : undefined} data-testid="chat-line">
              <strong>{m.name}</strong> <span>{m.text}</span>
            </li>
          ))
        )}
      </ol>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          sendChat(channel, text);
          setText('');
        }}
      >
        <input
          className="text-input"
          data-testid="chat-input"
          aria-label={t(lang, 'chatPlaceholder')}
          placeholder={t(lang, 'chatPlaceholder')}
          value={text}
          maxLength={CHAT_MAX}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="primary" data-testid="chat-send" disabled={disabled || !text.trim()}>
          {t(lang, 'chatSend')}
        </button>
      </form>
    </div>
  );
}

function NoClan({ lang }: { lang: Lang }) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ClanSummary[]>([]);
  const [asked, setAsked] = useState<string[]>([]);

  useEffect(() => {
    const id = setTimeout(() => void searchClans(query).then(setFound), 200);
    return () => clearTimeout(id);
  }, [query]);

  return (
    <div className="stack">
      <p className="muted">{t(lang, 'noClan')}</p>
      <h3>{t(lang, 'createClanTitle')}</h3>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void createClan(name, tag);
        }}
      >
        <input
          className="text-input"
          data-testid="clan-name"
          placeholder={t(lang, 'clanName')}
          aria-label={t(lang, 'clanName')}
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="text-input"
          data-testid="clan-tag"
          placeholder={t(lang, 'clanTag')}
          aria-label={t(lang, 'clanTag')}
          value={tag}
          maxLength={4}
          onChange={(e) => setTag(e.target.value.toUpperCase())}
        />
        <button type="submit" className="primary" data-testid="clan-create">
          {t(lang, 'createClan')}
        </button>
      </form>
      <h3>{t(lang, 'searchClans')}</h3>
      <input
        className="text-input"
        aria-label={t(lang, 'searchClans')}
        placeholder={t(lang, 'searchClans')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="list">
        {found.map((clan) => (
          <li key={clan.id} className="report clan-row" data-testid="clan-result">
            <span>
              <strong>[{clan.tag}]</strong> {clan.name} ·{' '}
              {t(lang, 'clanMembers', { n: clan.members, max: CLAN_MAX })}
            </span>
            <button
              type="button"
              className="small"
              disabled={asked.includes(clan.id) || clan.members >= CLAN_MAX}
              onClick={() => void requestJoin(clan.id).then((ok) => ok && setAsked([...asked, clan.id]))}
            >
              {asked.includes(clan.id) ? t(lang, 'requested') : t(lang, 'requestJoin')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MyClanView({ lang }: { lang: Lang }) {
  const clan = useGame((s) => s.clan);
  const me = useGame((s) => s.profile?.id);
  const [detail, setDetail] = useState<ClanDetail | null>(null);

  useEffect(() => {
    if (clan) void loadClan(clan.id).then(setDetail);
  }, [clan]);

  if (!clan) return null;
  const refresh = (): void => void loadClan(clan.id).then(setDetail);
  const manages = clan.role !== 'member';
  return (
    <div className="stack" data-testid="my-clan">
      <p className="clan-title">
        [{clan.tag}] {clan.name}
      </p>
      {detail && (
        <p className="muted">
          {t(lang, 'clanMembers', { n: detail.members, max: CLAN_MAX })} ·{' '}
          {t(lang, 'clanMedals', { n: detail.medals.length })}
        </p>
      )}
      {manages && detail && detail.requests.length > 0 && (
        <>
          <h3>{t(lang, 'clanRequests')}</h3>
          <ul className="list">
            {detail.requests.map((r) => (
              <li key={r.accountId} className="report clan-row" data-testid="clan-request">
                <span>{r.name}</span>
                <span className="row-actions">
                  <button
                    type="button"
                    className="small primary"
                    onClick={() => void decideRequest(clan.id, r.accountId, true).then(refresh)}
                  >
                    {t(lang, 'accept')}
                  </button>
                  <button
                    type="button"
                    className="small"
                    onClick={() => void decideRequest(clan.id, r.accountId, false).then(refresh)}
                  >
                    {t(lang, 'reject')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ul className="list">
        {detail?.memberList.map((m) => {
          const canKick =
            m.accountId !== me &&
            (clan.role === 'leader' || (clan.role === 'officer' && m.role === 'member'));
          return (
            <li key={m.accountId} className="report clan-row" data-testid="clan-member">
              <span>
                <strong>{m.name}</strong> <span className="muted">· {t(lang, ROLE_TEXT[m.role])}</span>
              </span>
              <span className="row-actions">
                {clan.role === 'leader' && m.role !== 'leader' && (
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      void setMemberRole(m.accountId, m.role === 'officer' ? 'member' : 'officer').then(
                        refresh,
                      )
                    }
                  >
                    {t(lang, m.role === 'officer' ? 'demote' : 'promote')}
                  </button>
                )}
                {canKick && (
                  <button
                    type="button"
                    className="small"
                    onClick={() => void kickMember(m.accountId).then(refresh)}
                  >
                    {t(lang, 'kick')}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" className="small" onClick={() => void leaveClan()}>
        {t(lang, 'leaveClan')}
      </button>
    </div>
  );
}

export function SocialPanel({ lang }: { lang: Lang }) {
  const [tab, setTab] = useState<'chat' | 'clan'>('chat');
  const inClan = useGame((s) => s.clan !== null);
  return (
    <div className="social">
      <div className="segmented" role="tablist">
        {(['chat', 'clan'] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            aria-pressed={tab === x}
            data-testid={`social-${x}`}
            onClick={() => setTab(x)}
          >
            {t(lang, x === 'chat' ? 'tabChat' : 'tabClan')}
          </button>
        ))}
      </div>
      {tab === 'chat' ? <Chat lang={lang} /> : inClan ? <MyClanView lang={lang} /> : <NoClan lang={lang} />}
    </div>
  );
}
