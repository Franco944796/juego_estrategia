import type { BattleReport, LordView } from '@si/engine';
import type { ClanRankingRow } from '@si/protocol';
import { useEffect, useState, type ReactNode } from 'react';
import { formatDuration, formatNumber, formatRange } from '../format';
import { abandonGame, chooseMapMode, loadClanRanking, rememberLang, setSpeed, SPEEDS } from '../game/session';
import { LANGS, t, type Lang, type MessageKey } from '../i18n';
import { toRealMs, useGame, type Panel } from '../store';
import { useGameNow } from './hooks';
import { CloseIcon } from './icons';
import { LordProfile } from './LordProfile';
import { Profile } from './Profile';
import { SocialPanel } from './Social';
import { leagueName, mergeGroups, ownerName, townLabel } from './labels';

function PanelFrame({ title, children, testid }: { title: string; children: ReactNode; testid: string }) {
  const lang = useGame((s) => s.lang);
  const setPanel = useGame((s) => s.setPanel);
  return (
    <section className="drawer" data-testid={testid} aria-label={title}>
      <header className="drawer-head">
        <div className="drawer-title">
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t(lang, 'close')}
          onClick={() => setPanel(null)}
        >
          <CloseIcon />
        </button>
      </header>
      {children}
    </section>
  );
}

function MarchesPanel({ view, lang }: { view: LordView; lang: Lang }) {
  const clock = useGame((s) => s.clock);
  const select = useGame((s) => s.select);
  const now = useGameNow();
  const marches = mergeGroups(view.marches.filter((m) => m.mine || m.incoming)).sort(
    (a, b) => a.arriveAt - b.arriveAt,
  );
  if (marches.length === 0) return <p className="muted">{t(lang, 'noMarches')}</p>;
  return (
    <ul className="list">
      {marches.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            className={`row${m.incoming ? ' tone-bad' : ''}`}
            onClick={() => select(m.to)}
          >
            <span>
              {m.incoming
                ? t(lang, 'incoming', {
                    name: ownerName(lang, view, m.owner),
                    town: townLabel(lang, view, m.to),
                  })
                : t(lang, 'outgoing', {
                    from: m.legs > 1 ? t(lang, 'groupFrom', { n: m.legs }) : townLabel(lang, view, m.from),
                    to: townLabel(lang, view, m.to),
                  })}
            </span>
            <span className="muted">
              {m.troops !== null && `${formatNumber(m.troops, lang)} · `}
              {m.troops === null && m.troopRange && `${formatRange(m.troopRange)} · `}
              {t(lang, 'arrivesIn', { t: formatDuration(toRealMs(clock, m.arriveAt - now)) })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function reportTitle(me: string, r: BattleReport): { key: MessageKey; tone: string } {
  if (r.attacker === me) {
    if (r.captured) return { key: 'took', tone: 'good' };
    return r.winner === 'ATTACKER' ? { key: 'wonAt', tone: 'muted' } : { key: 'failedAt', tone: 'bad' };
  }
  if (r.defender === me)
    return r.captured ? { key: 'lostTown', tone: 'bad' } : { key: 'defended', tone: 'good' };
  return r.captured ? { key: 'allyLost', tone: 'bad' } : { key: 'allyDefended', tone: 'good' };
}

function ReportsPanel({ view, lang }: { view: LordView; lang: Lang }) {
  if (view.reports.length === 0) return <p className="muted">{t(lang, 'noReports')}</p>;
  return (
    <ul className="list">
      {view.reports.map((r) => {
        const attacking = r.attacker === view.me.id;
        const asAlly = r.allies.find((a) => a.lordId === view.me.id);
        const lost = attacking ? r.attackerLost : (asAlly?.lost ?? r.defenderLost);
        const killed = attacking ? r.defenderLost : r.attackerLost;
        const recovered = attacking ? r.attackerRecovered : (asAlly?.recovered ?? r.defenderRecovered);
        // The defenders' rewards are split by power, so they are exact only for a lone defender.
        const rewards = attacking
          ? { xp: r.rewards.attackerXp, gold: r.rewards.attackerGold }
          : r.allies.length === 0
            ? { xp: r.rewards.defenderXp, gold: r.rewards.defenderGold }
            : null;
        const head = reportTitle(view.me.id, r);
        const enemy = attacking ? r.defender : r.attacker;
        return (
          <li key={r.id} className="report" data-testid="report-item">
            <p className={`tone-${head.tone}`}>
              <strong>{t(lang, head.key, { town: townLabel(lang, view, r.townId) })}</strong>{' '}
              <span className="muted">{t(lang, 'against', { name: ownerName(lang, view, enemy) })}</span>
            </p>
            <p className="muted">
              {t(lang, 'casualties', { lost: formatNumber(lost, lang), killed: formatNumber(killed, lang) })}
              {attacking && r.plunder > 0 && (
                <> · {t(lang, 'plunder', { n: formatNumber(r.plunder, lang) })}</>
              )}
            </p>
            {(recovered > 0 || (rewards && rewards.xp > 0)) && (
              <p className="muted">
                {recovered > 0 && t(lang, 'recovered', { n: formatNumber(recovered, lang) })}
                {recovered > 0 && rewards && rewards.xp > 0 && ' · '}
                {rewards &&
                  rewards.xp > 0 &&
                  t(lang, 'rewards', {
                    xp: formatNumber(rewards.xp, lang),
                    gold: formatNumber(rewards.gold, lang),
                  })}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LordRanking({ view, lang }: { view: LordView; lang: Lang }) {
  return (
    <table className="ranking">
      <thead>
        <tr>
          <th>#</th>
          <th>{t(lang, 'colLord')}</th>
          <th>{t(lang, 'dominion')}</th>
          <th>{t(lang, 'colTowns')}</th>
        </tr>
      </thead>
      <tbody>
        {view.standings.map((s) => (
          <tr key={s.lordId} data-testid="ranking-row" className={s.lordId === view.me.id ? 'me' : undefined}>
            <td>{s.rank}</td>
            <td>
              <span className="owner-dot small" style={{ background: s.color }} /> {s.name}
            </td>
            <td>{formatNumber(s.dominion, lang)}</td>
            <td>{s.towns}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClanRanking({ lang }: { lang: Lang }) {
  const myClan = useGame((s) => s.clan?.id);
  const [rows, setRows] = useState<ClanRankingRow[] | null>(null);
  useEffect(() => {
    void loadClanRanking().then(setRows);
  }, []);
  if (rows === null) return null;
  if (rows.length === 0) return <p className="muted">{t(lang, 'noClans')}</p>;
  return (
    <table className="ranking">
      <thead>
        <tr>
          <th>#</th>
          <th>{t(lang, 'tabClan')}</th>
          <th>{t(lang, 'dominion')}</th>
          <th>{t(lang, 'colMembers')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.clanId}
            data-testid="clan-ranking-row"
            className={r.clanId === myClan ? 'me' : undefined}
          >
            <td>{r.rank}</td>
            <td>
              [{r.tag}] {r.name}
            </td>
            <td>{formatNumber(r.dominion, lang)}</td>
            <td>{r.members}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RankingPanel({ view, lang }: { view: LordView; lang: Lang }) {
  const online = useGame((s) => s.mode === 'online');
  const [tab, setTab] = useState<'lords' | 'clans'>('lords');
  if (!online) return <LordRanking view={view} lang={lang} />;
  return (
    <div className="stack">
      <div className="segmented" role="tablist">
        {(['lords', 'clans'] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            aria-pressed={tab === x}
            data-testid={`ranking-${x}`}
            onClick={() => setTab(x)}
          >
            {t(lang, x === 'lords' ? 'rankingLords' : 'rankingClans')}
          </button>
        ))}
      </div>
      {tab === 'lords' ? <LordRanking view={view} lang={lang} /> : <ClanRanking lang={lang} />}
    </div>
  );
}

function MenuPanel({ lang }: { lang: Lang }) {
  const clock = useGame((s) => s.clock);
  const setLang = useGame((s) => s.setLang);
  const online = useGame((s) => s.mode === 'online');
  const mapMode = useGame((s) => s.mapMode);
  const [confirming, setConfirming] = useState(false);
  const help: MessageKey[] = ['help1', 'help2', 'help3', 'help4', 'help7', 'help8', 'help5', 'help6'];
  return (
    <div className="menu">
      {online && <Profile />}
      {!online && <h3>{t(lang, 'speed')}</h3>}
      {!online && (
        <div className="segmented" role="group" aria-label={t(lang, 'speed')}>
          <button
            type="button"
            aria-pressed={clock.speed === 0}
            data-testid="speed-0"
            onClick={() => setSpeed(0)}
          >
            {t(lang, 'pause')}
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={clock.speed === s}
              data-testid={`speed-${s}`}
              onClick={() => setSpeed(s)}
            >
              ×{s}
            </button>
          ))}
        </div>
      )}
      <h3>{t(lang, 'language')}</h3>
      <div className="segmented" role="group" aria-label={t(lang, 'language')}>
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => {
              setLang(l);
              rememberLang(l);
            }}
          >
            {t(l, 'langName')}
          </button>
        ))}
      </div>
      <h3>{t(lang, 'mapView')}</h3>
      <div className="segmented" role="group" aria-label={t(lang, 'mapView')}>
        {(['3d', '2d'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mapMode === m}
            data-testid={`map-${m}`}
            onClick={() => chooseMapMode(m)}
          >
            {t(lang, m === '3d' ? 'map3d' : 'map2d')}
          </button>
        ))}
      </div>
      <h3>{t(lang, 'howToPlay')}</h3>
      <ul className="help">
        {help.map((key) => (
          <li key={key}>{t(lang, key)}</li>
        ))}
      </ul>
      {online ? null : confirming ? (
        <div className="actions">
          <p className="tone-bad">{t(lang, 'confirmAbandon')}</p>
          <button type="button" className="danger" onClick={abandonGame}>
            {t(lang, 'abandon')}
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            {t(lang, 'cancel')}
          </button>
        </div>
      ) : (
        <button type="button" className="small" onClick={() => setConfirming(true)}>
          {t(lang, 'abandon')}
        </button>
      )}
    </div>
  );
}

const TITLES: Record<Panel, MessageKey> = {
  marches: 'marchesTitle',
  reports: 'reportsTitle',
  ranking: 'rankingTitle',
  profile: 'skillsTitle',
  social: 'socialTitle',
  menu: 'menuTitle',
};

export function PanelView({ panel }: { panel: Panel }) {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  const league = useGame((s) => (s.mode === 'online' ? (s.profile?.league ?? null) : null));
  if (!view) return null;
  let title = panel === 'profile' ? view.me.name : t(lang, TITLES[panel]);
  if (panel === 'ranking' && league !== null) title += ` · ${leagueName(lang, league)}`;
  return (
    <PanelFrame title={title} testid={`panel-${panel}`}>
      {panel === 'marches' && <MarchesPanel view={view} lang={lang} />}
      {panel === 'reports' && <ReportsPanel view={view} lang={lang} />}
      {panel === 'ranking' && <RankingPanel view={view} lang={lang} />}
      {panel === 'profile' && <LordProfile view={view} lang={lang} />}
      {panel === 'social' && <SocialPanel lang={lang} />}
      {panel === 'menu' && <MenuPanel lang={lang} />}
    </PanelFrame>
  );
}
