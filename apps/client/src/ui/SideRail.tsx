import { t, type MessageKey } from '../i18n';
import { useGame, type Panel } from '../store';
import { ChatIcon, MarchIcon, MenuIcon, ScrollIcon, TrophyIcon } from './icons';
import { mergeGroups } from './labels';

const ITEMS: { panel: Panel; label: MessageKey; Icon: typeof MenuIcon }[] = [
  { panel: 'marches', label: 'navMarches', Icon: MarchIcon },
  { panel: 'reports', label: 'navReports', Icon: ScrollIcon },
  { panel: 'ranking', label: 'navRanking', Icon: TrophyIcon },
  { panel: 'social', label: 'navSocial', Icon: ChatIcon },
  { panel: 'menu', label: 'navMenu', Icon: MenuIcon },
];

/** Picture buttons down the right edge of the map; the profile opens from the portrait in the HUD. */
export function SideRail() {
  const view = useGame((s) => s.view);
  const lang = useGame((s) => s.lang);
  const current = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const incoming = mergeGroups(view?.marches.filter((m) => m.incoming) ?? []).length;
  const mine = mergeGroups(view?.marches.filter((m) => m.mine) ?? []).length;
  const online = useGame((s) => s.mode === 'online');
  const unread = useGame((s) => s.unread);
  const items = ITEMS.filter((item) => online || item.panel !== 'social');

  const badge = (panel: Panel) => {
    if (panel === 'marches' && incoming > 0) return <span className="badge bad">{incoming}</span>;
    if (panel === 'marches' && mine > 0) return <span className="badge">{mine}</span>;
    if (panel === 'social' && unread > 0)
      return <span className="badge">{unread > 99 ? '99+' : unread}</span>;
    return null;
  };

  return (
    <nav className="rail">
      {items.map(({ panel, label, Icon }) => (
        <button
          key={panel}
          type="button"
          className={`rail-button${current === panel ? ' active' : ''}`}
          data-testid={`nav-${panel}`}
          aria-label={t(lang, label)}
          title={t(lang, label)}
          aria-pressed={current === panel}
          onClick={() => setPanel(current === panel ? null : panel)}
        >
          <Icon size={24} />
          {badge(panel)}
        </button>
      ))}
    </nav>
  );
}
