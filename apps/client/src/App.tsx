import { useEffect } from 'react';
import { savedLang, savedMapMode, watchVisibility } from './game/session';
import { MapCanvas } from './map/MapCanvas';
import { useGame } from './store';
import { SideRail } from './ui/SideRail';
import { Hud } from './ui/Hud';
import { ConnectionBanner, EndScreen, PickBanner, SeasonNews, TopStack } from './ui/Overlays';
import { PanelView } from './ui/Panels';
import { GroupSheet } from './ui/GroupSheet';
import { SendSheet } from './ui/SendSheet';
import { TitleScreen } from './ui/TitleScreen';
import { TownSheet } from './ui/TownSheet';

function Drawer() {
  const panel = useGame((s) => s.panel);
  const send = useGame((s) => s.send);
  const group = useGame((s) => s.group);
  const selected = useGame((s) => s.selected);
  const picking = useGame((s) => s.picking);
  if (panel) return <PanelView panel={panel} />;
  if (send) return <SendSheet key={`${send.from}-${send.to}`} from={send.from} to={send.to} />;
  if (group !== null) return <GroupSheet key={group} to={group} />;
  if (selected !== null && !picking) return <TownSheet townId={selected} />;
  return null;
}

function GameScreen() {
  const ready = useGame((s) => s.view !== null);
  const picking = useGame((s) => s.picking);
  return (
    <div className="game">
      <MapCanvas />
      {ready && (
        <>
          <div className="overlay-top">
            <Hud />
            <TopStack />
          </div>
          {picking && <PickBanner />}
          <Drawer />
          <SideRail />
          <EndScreen />
          <SeasonNews />
          <ConnectionBanner />
        </>
      )}
    </div>
  );
}

export function App() {
  const screen = useGame((s) => s.screen);
  const lang = useGame((s) => s.lang);

  useEffect(() => {
    const stored = savedLang();
    if (stored) useGame.getState().setLang(stored);
    const mode = savedMapMode();
    if (mode) useGame.getState().setMapMode(mode);
    return watchVisibility();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return screen === 'title' ? <TitleScreen /> : <GameScreen />;
}
