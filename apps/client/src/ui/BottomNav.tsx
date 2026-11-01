import { t, type MessageKey } from '../i18n';
import { useGame, type Panel } from '../store';
import { ChatIcon, MarchIcon, MenuIcon, ScrollIcon, StarIcon, TrophyIcon } from './icons';

const ITEMS: { panel: Panel; label: MessageKey; Icon: typeof MenuIcon }[] = [
  { panel: 'marches', label: 'navMarches', Icon: MarchIcon },
  { panel: 'reports', label: 'navReports', Icon: ScrollIcon },
  { panel: 'ranking', label: 'navRanking', Icon: TrophyIcon },
  { panel: 'edicts', label: 'navEdicts', Icon: StarIcon },
  { panel: 'social', label: 'navSocial', Icon: ChatIcon },
  { panel: 'menu', label: 'navMenu', Icon: MenuIcon },
];

export function BottomNav() {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  const current = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const incoming = view?.marches.filter((m) => m.incoming).length ?? 0;
  const mine = view?.marches.filter((m) => m.mine).length ?? 0;
  const draft = view?.me.draft ? 1 : 0;
  const online = useGame((s) => s.mode === 'online');
  const unread = useGame((s) => s.unread);
  const items = ITEMS.filter((item) => online || item.panel !== 'social');

  const badge = (panel: Panel) => {
    if (panel === 'marches' && incoming > 0) return <span className="badge bad">{incoming}</span>;
    if (panel === 'marches' && mine > 0) return <span className="badge">{mine}</span>;
    if (panel === 'edicts' && draft > 0) return <span className="badge good">!</span>;
    if (panel === 'social' && unread > 0)
      return <span className="badge">{unread > 99 ? '99+' : unread}</span>;
    return null;
  };

  return (
    <nav className="nav" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map(({ panel, label, Icon }) => (
        <button
          key={panel}
          type="button"
          className={`nav-button${current === panel ? ' active' : ''}`}
          data-testid={`nav-${panel}`}
          aria-pressed={current === panel}
          onClick={() => setPanel(current === panel ? null : panel)}
        >
          <Icon size={22} />
          <span className="nav-label">{t(lang, label)}</span>
          {badge(panel)}
        </button>
      ))}
    </nav>
  );
}
