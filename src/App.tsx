import React, { useState, useEffect, useCallback } from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import NativelyInterface from "./components/NativelyInterface"
import SettingsPopup from "./components/SettingsPopup" // Keeping for legacy/specific window support if needed
import Launcher from "./components/Launcher"
import ModelSelectorWindow from "./components/ModelSelectorWindow"
import SettingsOverlay from "./components/SettingsOverlay"
import StartupSequence from "./components/StartupSequence"
import { AnimatePresence, motion } from "framer-motion"
import UpdateBanner from "./components/UpdateBanner"
import { SupportToaster } from "./components/SupportToaster"
import { PermissionsToaster }   from "./components/onboarding/PermissionsToaster"
import { AlertCircle, RefreshCw } from "lucide-react"
import { clampOverlayOpacity, OVERLAY_OPACITY_DEFAULT, getDefaultOverlayOpacity } from "./lib/overlayAppearance"
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from './lib/meetingInterfaceTheme'
import { isMac } from "./utils/platformUtils"
import { trackAppOpen } from "./lib/toasterGating"
import { analytics } from "./lib/analytics/analytics.service"
import { ErrorBoundary } from "./components/ErrorBoundary"
import ModesSettings from "./components/settings/ModesSettings"
import { ProfileIntelligenceSettings } from "./components/ProfileIntelligenceSettings"

const queryClient = new QueryClient()

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
  const isModelSelectorWindow = new URLSearchParams(window.location.search).get('window') === 'model-selector';
  const isCropperWindow = new URLSearchParams(window.location.search).get('window') === 'cropper';

  // Default to launcher if not specified (dev mode safety)
  const isDefault = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !isCropperWindow;

  if (isCropperWindow) {
    const Cropper = React.lazy(() => import('./components/Cropper'));
    return (
      <React.Suspense fallback={<div className="w-screen h-screen bg-transparent" />}>
        <Cropper />
      </React.Suspense>
    );
  }

  // Initialize Analytics
  useEffect(() => {
    // Only init if we are in a main window context to avoid duplicate events from helper windows
    // Actually, we probably want to track app open from the main entry point.
    // Let's protect initialization to ensure single run per window.
    // The service handles single-init, but let's be thoughtful about WHICH window tracks "App Open".
    // Launcher is the main entry. Overlay is the "Assistant".

    analytics.initAnalytics();

    if (isLauncherWindow || isDefault) {
      analytics.trackAppOpen();
    }

    if (isOverlayWindow) {
      analytics.trackAssistantStart();
    }

    // Cleanup / Session End
    const handleUnload = () => {
      if (isOverlayWindow) {
        analytics.trackAssistantStop();
      }
      if (isLauncherWindow || isDefault) {
        analytics.trackAppClose();
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [isLauncherWindow, isOverlayWindow, isDefault]);

  // State
  // One-shot first-run startup sequence. Once the user dismisses it (or any
  // future code flips the flag), it never appears again on subsequent launches.
  const [showStartup, setShowStartup] = useState<boolean | null>(() => {
    try {
      const val = localStorage.getItem('natively_seen_startup_v1');
      if (val === 'true') return false;
      if (val === 'false') return true;
      return null;
    } catch {
      return null;
    }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string>('general');
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const openSettingsExclusive = useCallback((tab: string = 'general') => {
    setIsModesOpen(false);
    setIsProfileOpen(false);
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  }, []);
  const openProfileExclusive = useCallback(() => {
    setIsModesOpen(false);
    setIsSettingsOpen(false);
    setIsProfileOpen(true);
  }, []);
  const openModesExclusive = useCallback(() => {
    setIsProfileOpen(false);
    setIsSettingsOpen(false);
    setIsModesOpen(true);
  }, []);
  // Overlay opacity — only meaningful when isOverlayWindow, but stored centrally
  // so it can be initialized once from localStorage and updated via IPC.
  const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
    const stored = localStorage.getItem('natively_overlay_opacity');
    const parsed = stored ? parseFloat(stored) : NaN;
    // Treat missing value or the old default (0.65) as "not user-set"
    const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
    return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
  });

  const [meetingInterfaceTheme, setMeetingInterfaceThemeState] = useState<MeetingInterfaceTheme>(getMeetingInterfaceTheme);

  // Ollama Auto-Pull State
  const [ollamaPullStatus, setOllamaPullStatus] = useState<'idle' | 'downloading' | 'complete' | 'failed'>('idle');
  const [ollamaPullPercent, setOllamaPullPercent] = useState<number>(0);
  const [ollamaPullMessage, setOllamaPullMessage] = useState<string>('');

  // Re-index State
  const [incompatibleWarning, setIncompatibleWarning] = useState<{count: number; oldProvider: string; newProvider: string} | null>(null);
  // Automatic background re-index progress (fired after an embedding-model upgrade).
  const [reindexProgress, setReindexProgress] = useState<{done: number; total: number} | null>(null);
  
  // ── Onboarding / promo toasters ───────────────────────────
  const [showPermissionsToaster, setShowPermissionsToaster] = useState(false);

  useEffect(() => {
    // Track app opens for global gating
    trackAppOpen();

    // Clean up old local storage
    localStorage.removeItem('useLegacyAudioBackend');

    const fallbackLocal = () => {
      try {
        const localSeen = localStorage.getItem('natively_seen_startup_v1') === 'true';
        setShowStartup(!localSeen);
      } catch {
        setShowStartup(true);
      }
    };

    if (window.electronAPI?.onboardingGetFlags) {
      window.electronAPI.onboardingGetFlags()
        .then((flags) => {
          if (flags) {
            // 1. seenStartup
            if (flags.seenStartup) {
              setShowStartup(false);
              try { localStorage.setItem('natively_seen_startup_v1', 'true'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('natively_seen_startup_v1') === 'true';
                if (localSeen) {
                  setShowStartup(false);
                  window.electronAPI?.onboardingSetFlag?.('seenStartup', true).catch(() => {});
                } else {
                  setShowStartup(true);
                }
              } catch {
                setShowStartup(true);
              }
            }

            // 2. seenModesOnboarding
            if (flags.seenModesOnboarding) {
              try { localStorage.setItem('natively_seen_modes_onboarding_v5', 'true'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('natively_seen_modes_onboarding_v5') === 'true';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('seenModesOnboarding', true).catch(() => {});
                }
              } catch {}
            }

            // 3. seenProfileOnboarding
            if (flags.seenProfileOnboarding) {
              try { localStorage.setItem('natively_seen_profile_onboarding_v1', 'true'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('natively_seen_profile_onboarding_v1') === 'true';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('seenProfileOnboarding', true).catch(() => {});
                }
              } catch {}
            }

            // 4. permsShown
            if (flags.permsShown) {
              try { localStorage.setItem('natively_perms_shown_v1', '1'); } catch {}
            } else {
              try {
                const localSeen = localStorage.getItem('natively_perms_shown_v1') === '1';
                if (localSeen) {
                  window.electronAPI?.onboardingSetFlag?.('permsShown', true).catch(() => {});
                }
              } catch {}
            }
          } else {
            fallbackLocal();
          }
        })
        .catch(() => {
          fallbackLocal();
        });
    } else {
      fallbackLocal();
    }

    // ── Onboarding toasters ──────────────────────────────────
    if (isLauncherWindow || isDefault) {
      const permsShown = localStorage.getItem('natively_perms_shown_v1');
      if (!permsShown) {
        // First ever launch — show permissions toaster
        setShowPermissionsToaster(true);
      }
    }

    // Listen for open-settings-tab events from other windows (e.g. overlay Modes button)
    const removeOpenSettingsTab = window.electronAPI?.onOpenSettingsTab?.((tab: string) => {
      openSettingsExclusive(tab);
    });

    // Listen for Ollama Auto-Pull Progress
    let removeProgress: (() => void) | undefined;
    let removeComplete: (() => void) | undefined;
    if (window.electronAPI?.onOllamaPullProgress && window.electronAPI?.onOllamaPullComplete) {
      removeProgress = window.electronAPI.onOllamaPullProgress((data) => {
        setOllamaPullStatus('downloading');
        setOllamaPullPercent(data.percent || 0);
        setOllamaPullMessage(data.status || 'Downloading...');
      });

      removeComplete = window.electronAPI.onOllamaPullComplete(() => {
        setOllamaPullStatus('complete');
        setOllamaPullMessage('Local AI memory ready');
        setOllamaPullPercent(100);
        setTimeout(() => setOllamaPullStatus('idle'), 3000);
      });
    }

    let removeWarning: (() => void) | undefined;
    if (window.electronAPI?.onIncompatibleProviderWarning) {
      removeWarning = window.electronAPI.onIncompatibleProviderWarning((data) => {
        setIncompatibleWarning(data);
      });
    }

    let removeReindexProgress: (() => void) | undefined;
    if (window.electronAPI?.onReindexProgress) {
      removeReindexProgress = window.electronAPI.onReindexProgress((phase, data) => {
        if (phase === 'started') {
          setReindexProgress({ done: 0, total: data.count ?? 0 });
        } else if (phase === 'progress') {
          setReindexProgress({ done: data.done ?? 0, total: data.total ?? 0 });
        } else if (phase === 'complete') {
          // On a full completion show 100%; on a partial bail (paused by continuous
          // live meetings — resumes next launch) reflect the actual done count rather
          // than forcing 100%. Either way, briefly show then dismiss.
          const total = data.total ?? 0;
          const done = data.partial ? (data.done ?? 0) : total;
          setReindexProgress({ done, total });
          setTimeout(() => setReindexProgress(null), 4000);
        }
      });
    }

    return () => {
      if (removeProgress) removeProgress();
      if (removeComplete) removeComplete();
      if (removeWarning) removeWarning();
      if (removeReindexProgress) removeReindexProgress();
      if (removeOpenSettingsTab) removeOpenSettingsTab();
    }
  }, []);

  // Listen for overlay opacity changes — scoped to overlay window only
  useEffect(() => {
    if (!isOverlayWindow) return;
    const removeOpacityListener = window.electronAPI?.onOverlayOpacityChanged?.((opacity) => {
      setOverlayOpacity(opacity);
    });
    return () => {
      if (removeOpacityListener) removeOpacityListener();
    };
  }, [isOverlayWindow]);

  // When the theme switches and no user preference is stored, reset to theme-aware default
  useEffect(() => {
    if (!isOverlayWindow || !window.electronAPI?.onThemeChanged) return;
    return window.electronAPI.onThemeChanged(() => {
      const stored = localStorage.getItem('natively_overlay_opacity');
      if (!stored) {
        setOverlayOpacity(getDefaultOverlayOpacity());
      }
    });
  }, [isOverlayWindow]);

  useEffect(() => {
    // Two propagation channels:
    //  1. `storage` event — fires within the same window when our own
    //     setMeetingInterfaceTheme() dispatches it (covers settings-pane → App
    //     state in the launcher).
    //  2. IPC `interface-theme:changed` broadcast — main relays the new theme
    //     to EVERY BrowserWindow, including the overlay. Without this the
    //     overlay holds a stale theme value across hide/show cycles, which
    //     yielded the half-painted UI on next meeting start.
    const handleStorage = () => setMeetingInterfaceThemeState(getMeetingInterfaceTheme());
    window.addEventListener('storage', handleStorage);
    const unsubscribeIpc = window.electronAPI?.onMeetingInterfaceThemeChanged?.((theme) => {
      const valid: MeetingInterfaceTheme[] = ['default', 'liquid-glass', 'modern'];
      if (valid.includes(theme as MeetingInterfaceTheme)) {
        setMeetingInterfaceThemeState(theme as MeetingInterfaceTheme);
      }
    });
    return () => {
      window.removeEventListener('storage', handleStorage);
      unsubscribeIpc?.();
    };
  }, []);


  // Handlers
  const handleReindex = async () => {
    if (window.electronAPI?.reindexIncompatibleMeetings) {
      setIncompatibleWarning(null);
      await window.electronAPI.reindexIncompatibleMeetings();
    }
  };

  const handleStartMeeting = async () => {
    try {
      localStorage.setItem('natively_last_meeting_start', Date.now().toString());
      const inputDeviceId = localStorage.getItem('preferredInputDeviceId');
      let outputDeviceId = localStorage.getItem('preferredOutputDeviceId');
      // SCK is a macOS-only backend (ScreenCaptureKit + CoreAudio Process Tap
      // live in the Rust speaker module under #[cfg(target_os = "macos")]).
      // F-003 hid the toggle UI on Windows, but the localStorage key can be
      // present on a Windows machine via cross-OS sync or restored backup —
      // routing "sck" as an outputDeviceId then hands the Windows speaker
      // module an unknown WASAPI device id and silently breaks system audio.
      // Defense-in-depth: also require isMac at the consumer.
      const useExperimentalSck = isMac && localStorage.getItem('useExperimentalSckBackend') === 'true';

      // Override output device ID to force SCK if experimental mode is enabled
      // Default to CoreAudio unless experimental is enabled
      if (useExperimentalSck) {
        console.log("[App] Using ScreenCaptureKit backend (Experimental).");
        outputDeviceId = "sck";
      } else if (isMac) {
        console.log("[App] Using CoreAudio backend (Default).");
      }

      const meetingRetention = await window.electronAPI.getMeetingRetention?.().catch(() => 'forever');
      const result = await window.electronAPI.startMeeting({
        audio: { inputDeviceId, outputDeviceId },
        doNotPersist: meetingRetention === 'never'
      });
      if (result.success) {
        analytics.trackMeetingStarted();
        // Window swap happens inside main's startMeeting() now (before the
        // meeting-state broadcast) to avoid a blue→green CTA flash on the
        // launcher. No follow-up setWindowMode IPC needed here.
      } else {
        console.error("Failed to start meeting:", result.error);
      }
    } catch (err) {
      console.error("Failed to start meeting:", err);
    }
  };

  const handleEndMeeting = () => {
    console.log("[App.tsx] handleEndMeeting triggered");
    analytics.trackMeetingEnded();
    // Local bookkeeping that does not depend on the main process.
    const startStr = localStorage.getItem('natively_last_meeting_start');
    if (startStr) {
      const duration = Date.now() - parseInt(startStr, 10);
      const threshold = import.meta.env.DEV ? 10000 : 180000;
      if (duration >= threshold) {
        localStorage.setItem('natively_show_profile_toaster', 'true');
      }
      localStorage.removeItem('natively_last_meeting_start');
    }

    // Fire-and-forget: main's endMeeting() handler now performs the
    // launcher swap synchronously at the top, BEFORE any blocking audio
    // teardown. Awaiting here would stall the overlay's React render
    // loop for the IPC round-trip while libuv-blocking setImmediate
    // native stops fire on the main process — which is the lag the user
    // was seeing. The launcher window receives a 'meetings-updated'
    // event after the BG teardown so its list refreshes on its own.
    window.electronAPI.endMeeting().catch(err => {
      console.error("Failed to end meeting:", err);
      // Belt-and-suspenders: if the IPC itself rejected, the swap may
      // not have happened — request it manually so the user isn't
      // stranded on a dead overlay.
      window.electronAPI.setWindowMode('launcher');
    });
  };

  const interfaceThemeAttribute = meetingInterfaceTheme === 'default' ? undefined : meetingInterfaceTheme;

  // Render Logic
  if (isSettingsWindow) {
    return (
      <ErrorBoundary context="SettingsPopup">
        <div className="h-full min-h-0 w-full" data-interface-theme={interfaceThemeAttribute}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <SettingsPopup />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  if (isModelSelectorWindow) {
    return (
      <ErrorBoundary context="ModelSelector">
        <div
          className="h-full min-h-0 w-full overflow-hidden"
          data-interface-theme={interfaceThemeAttribute}
        >
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ModelSelectorWindow />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- OVERLAY WINDOW (Meeting Interface) ---
  if (isOverlayWindow) {
    return (
      <ErrorBoundary context="Overlay">
        <div className="w-full h-full relative overflow-hidden bg-transparent">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <div
                style={{
                  ['--overlay-opacity' as '--overlay-opacity']: String(overlayOpacity),
                  transition: 'background-color 75ms ease, border-color 75ms ease, box-shadow 75ms ease'
                } as React.CSSProperties}
              >
                <NativelyInterface
                  onEndMeeting={handleEndMeeting}
                  overlayOpacity={overlayOpacity}
                  interfaceTheme={meetingInterfaceTheme}
                />
              </div>
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- LAUNCHER WINDOW (Default) ---
  // Renders if window=launcher OR no param
  if (showStartup === null) {
    return (
      <div className="h-full w-full bg-[#000000]" />
    );
  }

  return (
    <ErrorBoundary context="Launcher">
    <div className="h-full min-h-0 w-full relative bg-[#000000]">
      <AnimatePresence>
        {showStartup ? (
          <motion.div
            key="startup"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, pointerEvents: "none", transition: { duration: 0.6, ease: "easeInOut" } }}
          >
            <StartupSequence onComplete={() => {
              try { localStorage.setItem('natively_seen_startup_v1', 'true'); } catch {}
              window.electronAPI?.onboardingSetFlag?.('seenStartup', true).catch(() => {});
              setShowStartup(false);
            }} />
          </motion.div>
        ) : (
          <motion.div
            key="main"
            className="h-full w-full"
            initial={{ opacity: 0, scale: 0.98, y: 15 }} // "Linear" style entry: slightly down and scaled down
            animate={{ opacity: 1, scale: 1, y: 0 }}      // Slide up and snap to place
            transition={{
              duration: 0.8,
              ease: [0.19, 1, 0.22, 1], // Expo-out: snappy start, smooth landing
              delay: 0.1
            }}
          >
            <QueryClientProvider client={queryClient}>
              <ToastProvider>
                <div id="launcher-container" className="h-full w-full relative">
                  <Launcher
                    onStartMeeting={handleStartMeeting}
                    onOpenSettings={(tab = 'general') => openSettingsExclusive(tab)}
                    onOpenProfile={() => openProfileExclusive()}
                    onOpenModes={() => openModesExclusive()}
                    ollamaPullStatus={ollamaPullStatus}
                    ollamaPullPercent={ollamaPullPercent}
                    ollamaPullMessage={ollamaPullMessage}
                  />
                </div>
                <SettingsOverlay
                  isOpen={isSettingsOpen}
                  onClose={() => {
                    setIsSettingsOpen(false);
                  }}
                  initialTab={settingsInitialTab}
                />
                <AnimatePresence>
                  {isModesOpen && (
                    <motion.div
                      key="modes-panel"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                      onClick={(e) => { if (e.target === e.currentTarget) setIsModesOpen(false); }}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 18, filter: 'blur(12px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(8px)' }}
                        transition={{
                          opacity: { duration: 0.32, ease: [0.23, 1, 0.32, 1] },
                          filter: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
                          scale: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                          y: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                        }}
                        style={{
                          willChange: 'transform, opacity, filter',
                          transformOrigin: 'center',
                          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.65), 0 16px 40px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                        className="w-[820px] h-[600px] max-w-[95vw] max-h-[90vh] rounded-2xl overflow-hidden border border-white/10 bg-[#141414]"
                      >
                        <ModesSettings onClose={() => setIsModesOpen(false)} isPremium={true} isLoaded={true} isTrialActive={false} onOpenNativelyAPI={() => openSettingsExclusive('ai-providers')} />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {isProfileOpen && (
                    <motion.div
                      key="profile-panel"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                      onClick={(e) => { if (e.target === e.currentTarget) setIsProfileOpen(false); }}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 18, filter: 'blur(12px)' }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(8px)' }}
                        transition={{
                          opacity: { duration: 0.32, ease: [0.23, 1, 0.32, 1] },
                          filter: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
                          scale: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                          y: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
                        }}
                        style={{
                          willChange: 'transform, opacity, filter',
                          transformOrigin: 'center',
                          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.65), 0 16px 40px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                        className="w-[820px] h-[600px] max-w-[95vw] max-h-[90vh] rounded-2xl overflow-hidden border border-white/10 bg-[#141414]"
                      >
                        <ProfileIntelligenceSettings
                          onClose={() => setIsProfileOpen(false)}
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <ToastViewport />
              </ToastProvider>
            </QueryClientProvider>
          </motion.div>
        )}
      </AnimatePresence>


      <AnimatePresence>
        {incompatibleWarning && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed bottom-6 right-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-[#ff3333]/30 shadow-2xl rounded-2xl p-5 max-w-[340px] flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#ff3333] shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-[#E0E0E0] font-medium text-sm">Provider Changed</h3>
                  <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                    ⚠ {incompatibleWarning.count} meetings used your previous AI provider ({incompatibleWarning.oldProvider}) and won't appear in search results under {incompatibleWarning.newProvider}.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-1 justify-end">
                <button 
                  onClick={() => setIncompatibleWarning(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#A0A0A0] hover:text-white hover:bg-white/5 transition-colors"
                >
                  Dismiss
                </button>
                <button 
                  onClick={handleReindex}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ff3333]/10 text-[#ff3333] hover:bg-[#ff3333]/20 transition-colors"
                >
                  Re-index automatically
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reindexProgress && isDefault && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed bottom-6 right-6 z-50 pointer-events-auto"
          >
            <div className="bg-[#1A1A1A] border border-white/10 shadow-2xl rounded-2xl p-5 max-w-[340px] flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <RefreshCw className={`w-5 h-5 text-[#A0A0A0] shrink-0 mt-0.5 ${reindexProgress.done < reindexProgress.total ? 'animate-spin' : ''}`} />
                <div className="flex-1">
                  <h3 className="text-[#E0E0E0] font-medium text-sm">
                    {reindexProgress.done >= reindexProgress.total && reindexProgress.total > 0
                      ? 'Search index updated'
                      : 'Updating search index'}
                  </h3>
                  <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                    {reindexProgress.done >= reindexProgress.total && reindexProgress.total > 0
                      ? 'Your past conversations are searchable again.'
                      : `Re-indexing your past conversations for the upgraded AI model… ${reindexProgress.done}/${reindexProgress.total}`}
                  </p>
                  {reindexProgress.total > 0 && (
                    <div className="mt-2 h-1 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-[#E0E0E0] transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.round((reindexProgress.done / reindexProgress.total) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <UpdateBanner />
      <SupportToaster />

      {/* Permissions toaster — first ever launch */}
      <PermissionsToaster
        isOpen={showPermissionsToaster}
        onDismiss={() => {
          localStorage.setItem('natively_perms_shown_v1', '1');
          window.electronAPI?.onboardingSetFlag?.('permsShown', true).catch(() => {});
          setShowPermissionsToaster(false);
        }}
      />
    </div>
    </ErrorBoundary>
  )
}

export default App
