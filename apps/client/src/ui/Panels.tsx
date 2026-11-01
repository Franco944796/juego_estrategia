import { EDICT_IDS } from '@si/config/constants';
import { totalTroops, type BattleReport, type LordView } from '@si/engine';
import { useState, type ReactNode } from 'react';
import { formatDuration, formatNumber } from '../format';
import { abandonGame, command, rememberLang, setSpeed, SPEEDS } from '../game/session';
import { EDICT_TEXT, LANGS, t, type Lang, type MessageKey } from '../i18n';
import { toRealMs, useGame, type Panel } from '../store';
import { useGameNow } from './hooks';
import { CloseIcon } from './icons';
import { Profile } from './Profile';
import { ownerName, townLabel } from './labels';

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
  const marches = [...view.marches]
    .filter((m) => m.mine || m.incoming)
    .sort((a, b) => a.arriveAt - b.arriveAt);
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
                    from: townLabel(lang, view, m.from),
                    to: townLabel(lang, view, m.to),
                  })}
            </span>
            <span className="muted">
              {m.troops ? `${formatNumber(totalTroops(m.troops), lang)} · ` : ''}
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
  return r.captured ? { key: 'lostTown', tone: 'bad' } : { key: 'defended', tone: 'good' };
}

function ReportsPanel({ view, lang }: { view: LordView; lang: Lang }) {
  if (view.reports.length === 0) return <p className="muted">{t(lang, 'noReports')}</p>;
  return (
    <ul className="list">
      {view.reports.map((r) => {
        const attacking = r.attacker === view.me.id;
        const lost = totalTroops(attacking ? r.attackerLost : r.defenderLost);
        const killed = totalTroops(attacking ? r.defenderLost : r.attackerLost);
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
          </li>
        );
      })}
    </ul>
  );
}

function RankingPanel({ view, lang }: { view: LordView; lang: Lang }) {
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

function EdictsPanel({ view, lang }: { view: LordView; lang: Lang }) {
  const { me } = view;
  return (
    <div className="edicts">
      {me.draft && (
        <>
          <p>
            <strong>{t(lang, 'chooseEdict')}</strong>
          </p>
          <div className="cards">
            {me.draft.map((id) => (
              <button
                key={id}
                type="button"
                className="card"
                data-testid="edict-option"
                onClick={() => void command({ type: 'CHOOSE_EDICT', edict: id })}
              >
                <strong>{EDICT_TEXT[lang][id].name}</strong>
                <span className="muted">{EDICT_TEXT[lang][id].effect}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="muted">
        {me.nextGlory !== null && me.edicts.length < EDICT_IDS.length
          ? t(lang, 'nextEdict', { n: me.nextGlory })
          : t(lang, 'allEdicts')}{' '}
        · {t(lang, 'gloryHelp')}
      </p>
      <h3>{t(lang, 'yourEdicts')}</h3>
      {me.edicts.length === 0 ? (
        <p className="muted">{t(lang, 'noEdicts')}</p>
      ) : (
        <ul className="list">
          {me.edicts.map((id) => (
            <li key={id} className="report">
              <strong>{EDICT_TEXT[lang][id].name}</strong>{' '}
              <span className="muted">· {EDICT_TEXT[lang][id].effect}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MenuPanel({ lang }: { lang: Lang }) {
  const clock = useGame((s) => s.clock);
  const setLang = useGame((s) => s.setLang);
  const online = useGame((s) => s.mode === 'online');
  const [confirming, setConfirming] = useState(false);
  const help: MessageKey[] = ['help1', 'help2', 'help3', 'help4', 'help5', 'help6'];
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
  edicts: 'edictsTitle',
  menu: 'menuTitle',
};

export function PanelView({ panel }: { panel: Panel }) {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  if (!view) return null;
  return (
    <PanelFrame title={t(lang, TITLES[panel])} testid={`panel-${panel}`}>
      {panel === 'marches' && <MarchesPanel view={view} lang={lang} />}
      {panel === 'reports' && <ReportsPanel view={view} lang={lang} />}
      {panel === 'ranking' && <RankingPanel view={view} lang={lang} />}
      {panel === 'edicts' && <EdictsPanel view={view} lang={lang} />}
      {panel === 'menu' && <MenuPanel lang={lang} />}
    </PanelFrame>
  );
}
