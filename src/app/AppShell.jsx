import React, { useEffect, useState } from 'react';
import { ChevronLeft, Home } from 'lucide-react';
import { api } from '../services/morphApi.js';
import { PAGES } from './routes.js';
import Sidebar from '../components/Sidebar.jsx';
import AppUpdateBanner from '../components/AppUpdateBanner.jsx';
import ConvertPage from '../features/conversion/ConvertPage.jsx';
import useConversionQueue from '../features/conversion/useConversionQueue.js';
import useFileIntake from '../features/conversion/useFileIntake.js';
import UnitsPage from '../features/units/UnitsPage.jsx';
import HistoryPage from '../features/history/HistoryPage.jsx';
import SettingsPage from '../features/settings/SettingsPage.jsx';

// Page composition and navigation only. The conversion list lives in useConversionQueue so it
// survives moving between pages.
export default function AppShell() {
  const [page, setPage] = useState('convert');
  const [settings, setSettings] = useState(null);
  const [tools, setTools] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const [appUpdate, setAppUpdate] = useState(null);
  const queue = useConversionQueue();
  const intake = useFileIntake({ itemsRef: queue.itemsRef, addDetected: queue.addDetected, active: page === 'convert' });

  useEffect(() => {
    if (!api) return undefined;
    api.getSettings().then(setSettings);
    api.toolStatus().then(setTools);
    api.appVersion().then(setAppVersion);
    return api.onAppUpdate(setAppUpdate);
  }, []);

  // Optimistic, then corrected by main's validated result (or its current values on refusal).
  const saveSettings = (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    api.setSettings(patch).then(setSettings, () => api.getSettings().then(setSettings));
  };

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} tools={tools} appVersion={appVersion} />
      <main className="main" {...intake.dropHandlers}>
        <div className="breadcrumbs"><Home size={16} /> <ChevronLeft size={14} /> <span>{PAGES.find((p) => p.id === page).label}</span></div>
        <AppUpdateBanner
          status={appUpdate}
          onDownload={() => { setAppUpdate((s) => ({ ...s, state: 'downloading', percent: 0 })); api.downloadAppUpdate(); }}
          onInstall={() => api.installAppUpdate()}
        />

        {page === 'units' && <UnitsPage />}
        {page === 'history' && <HistoryPage />}
        {page === 'settings' && settings && (
          <SettingsPage
            settings={settings} onChange={saveSettings} tools={tools}
            app={{ version: appVersion, status: appUpdate, check: async () => {
              setAppUpdate({ state: 'checking' });
              if (!(await api.checkAppUpdate())) setAppUpdate({ state: 'dev' });
            } }}
          />
        )}
        {page === 'convert' && <ConvertPage queue={queue} intake={intake} settings={settings} />}
      </main>
    </div>
  );
}
