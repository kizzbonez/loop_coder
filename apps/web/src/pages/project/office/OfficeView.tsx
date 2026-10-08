import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import clsx from 'clsx';
import { Gamepad2, Menu as MenuIcon, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SYSTEM_ROLE_KEYS } from '@loop/shared';
import { Button } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/misc';
import { useFlowState } from '../../../hooks/useFlowState';
import { SEGMENT_ID } from '../../../lib/flow/timeline';
import { OfficeAudio } from '../../../lib/office/audio';
import { roleCharacter } from '../../../lib/office/characters';
import { lineFromActivity, lineFromRemark, type ChatLine } from '../../../lib/office/chatter';
import { hash } from '../../../lib/office/pixels';
import { loadSettings, saveSettings, type OfficeSettings } from '../../../lib/office/settings';
import { OfficeSim, type CastRole } from '../../../lib/office/sim';
import { useActivity, useLiveRemarks } from '../../../lib/queries';
import { useBoardLookups, useProjectContext } from '../context';
import { ModeToggle } from '../../../components/flow/ModeToggle';
import { ReplayBar } from '../../../components/flow/ReplayBar';
import { DialogueBox } from './DialogueBox';
import { PixelAvatar } from './PixelAvatar';
import { GameMenu } from './GameMenu';
import { OfficeCanvas } from './OfficeCanvas';

const LOG_SIZE = 60;

/**
 * The agent office: a pixel-art world where each agent walks to the station of the role it is
 * playing, talks about what it is doing, and reacts when poked. Live by default; `?replay=all`
 * (or `kickoff`, `sprint-2`, …) replays that part of the history on a real clock, like the Flow tab.
 */
export function OfficeView() {
  const ctx = useProjectContext();
  const { project, tasks, roles } = ctx;
  const lookups = useBoardLookups(project, tasks, roles);
  const [params, setParams] = useSearchParams();
  const replayParam = params.get('replay');
  const replaying = Boolean(replayParam);
  const segment = replayParam && SEGMENT_ID.test(replayParam) ? replayParam : 'all';
  const state = useFlowState(ctx, { replay: replaying, segment });
  const activity = useActivity(project.id, 100);
  const remarks = useLiveRemarks(project.id);

  const [settings, setSettings] = useState<OfficeSettings>(loadSettings);
  const [menuOpen, setMenuOpen] = useState(false);
  const [log, setLog] = useState<ChatLine[]>([]);
  const [current, setCurrent] = useState<ChatLine | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const menuButton = useRef<HTMLButtonElement>(null);

  const sim = useMemo(() => new OfficeSim(hash(project.id)), [project.id]);
  const audio = useMemo(() => new OfficeAudio(), []);
  useEffect(() => {
    // Hidden tabs throttle timers, which would make the music stutter: pause until visible again.
    const onVisibility = () => (document.hidden ? audio.suspend() : audio.resume());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      audio.dispose();
    };
  }, [audio]);
  useEffect(() => {
    audio.apply(settings);
    sim.textSpeed = settings.textSpeed;
    saveSettings(settings);
  }, [audio, sim, settings]);

  const rolesByKey = lookups.rolesByKey;
  const agentsOnline = state.agents;
  const stageName = useCallback((kind: string) => state.stages.get(kind as never)?.label ?? kind, [state.stages]);

  // One character per enabled role: built-in roles in team order, then roles added later.
  const cast = useMemo<CastRole[]>(() => {
    const rank = (key: string) => {
      const i = (SYSTEM_ROLE_KEYS as readonly string[]).indexOf(key);
      return i === -1 ? SYSTEM_ROLE_KEYS.length : i;
    };
    return roles
      .filter((r) => r.enabled)
      .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name))
      .map((r) => ({ key: r.key, name: r.name, color: r.color }));
  }, [roles]);
  const castByKey = useMemo(() => new Map(cast.map((r) => [r.key, r])), [cast]);
  useEffect(() => sim.setCast(cast), [sim, cast]);

  // Agents and board numbers → the office: each agent plays the character of its current role.
  useEffect(() => {
    sim.stats = Object.fromEntries(state.counts);
    sim.sync(
      state.agents.map((a) => ({
        id: a.id,
        name: a.name,
        stage: a.stage,
        roleKey: a.roleKey,
        roleColor: a.roleKey ? (rolesByKey.get(a.roleKey)?.color ?? null) : null,
        working: a.working,
        taskKey: a.taskKey,
      })),
    );
  }, [sim, state.agents, state.counts, rolesByKey, cast]);

  // Lines to speak: live activity and remarks, or everything recorded in the replayed segment.
  const replayEvents = state.replay.events;
  const replayRemarks = state.replay.remarks;
  const allLines = useMemo(() => {
    const fromActivity = (state.replaying ? replayEvents : (activity.data ?? [])).map((a) => lineFromActivity(a, stageName));
    const fromRemarks = (state.replaying ? replayRemarks : (remarks.data ?? [])).map(lineFromRemark);
    return [...fromActivity, ...fromRemarks].filter((l): l is ChatLine => Boolean(l)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [state.replaying, replayEvents, replayRemarks, activity.data, remarks.data, stageName]);
  // In a replay, only what was said up to the moment shown.
  const t = state.replay.t;
  const lines = useMemo(() => (state.replaying ? allLines.filter((l) => Date.parse(l.at) <= t) : allLines), [state.replaying, allLines, t]);

  const spoken = useRef<Set<string> | null>(null);
  const mode = useRef({ replaying: state.replaying, tape: state.replay.segment?.id, t });
  useEffect(() => {
    const tape = state.replay.segment?.id;
    // Switching live ↔ replay or the segment starts a fresh conversation. Jumping in a replay lists
    // what was said up to there without saying it all again; while it plays, lines are said as their time comes.
    if (mode.current.replaying !== state.replaying || mode.current.tape !== tape || (state.replaying && (!state.replay.advanced || t < mode.current.t))) {
      spoken.current = null;
      setCurrent(null);
      if (!state.replaying || mode.current.replaying !== state.replaying) setLog([]);
    }
    mode.current = { replaying: state.replaying, tape, t };
    if (!state.replaying && !activity.data) return;
    if (!spoken.current) {
      // What happened before the office opened is history: list it, but do not say it.
      spoken.current = new Set(lines.map((l) => l.id));
      setLog(lines.slice(-20).reverse());
      return;
    }
    const fresh = lines.filter((l) => !spoken.current!.has(l.id));
    if (fresh.length === 0) return;
    for (const line of fresh) {
      spoken.current.add(line.id);
      // Forget the oldest ids so the set stays small during long sessions.
      if (spoken.current.size > 1000) spoken.current.delete(spoken.current.values().next().value!);
      sim.say({ ...line.speaker, roleKey: line.roleKey }, line.text, line.tone);
      if (line.cue) audio.play(line.cue);
    }
    setLog((old) => [...fresh.reverse(), ...old].slice(0, LOG_SIZE));
    setCurrent(fresh[0]!);
  }, [lines, state.replaying, state.replay.segment?.id, state.replay.advanced, t, activity.data, sim, audio]);

  const setReplay = (value: string | null) =>
    setParams((p) => {
      if (value) p.set('replay', value);
      else p.delete('replay');
      return p;
    });

  if (state.loading || activity.isPending) return <PageLoader />;
  const quickMute = !settings.sfx && !settings.music;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Gamepad2 className="size-4 text-accent" /> Office
          </h2>
          <p className="text-[13px] text-muted">Your agents at work in a pixel office. Click anyone or anything.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={quickMute ? VolumeX : Volume2}
            aria-label={quickMute ? 'Turn sound on' : 'Mute'}
            onClick={() => {
              audio.unlock();
              setSettings((s) => (quickMute ? { ...s, sfx: true } : { ...s, sfx: false, music: false }));
            }}
          >
            <span className="hidden sm:inline">{quickMute ? 'Sound off' : 'Sound on'}</span>
          </Button>
          <Button
            ref={menuButton}
            size="sm"
            icon={MenuIcon}
            onClick={() => {
              audio.unlock();
              setMenuOpen(true);
            }}
          >
            Menu
          </Button>
          <ModeToggle label="Office mode" replaying={replaying} onChange={(on) => setReplay(on ? 'all' : null)} />
        </div>
      </div>

      <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card relative overflow-hidden p-3">
          <OfficeCanvas
            sim={sim}
            audio={audio}
            settings={settings}
            onPoke={(text) => setAnnouncement(text)}
            onOpenMenu={() => setMenuOpen(true)}
          />
          <DialogueBox
            line={current}
            speed={settings.textSpeed}
            audio={audio}
            role={current?.roleKey ? castByKey.get(current.roleKey) : undefined}
          />
          {state.replaying && (
            <div className="-mx-3 mt-3 -mb-3">
              <ReplayBar state={state} onExit={() => setReplay(null)} onSegment={setReplay} />
            </div>
          )}
          {menuOpen && (
            <GameMenu
              settings={settings}
              onChange={setSettings}
              audio={audio}
              onClose={() => {
                setMenuOpen(false);
                menuButton.current?.focus();
              }}
            />
          )}
          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </section>

        <aside className="grid content-start gap-4 md:grid-cols-2 min-[1500px]:grid-cols-1">
          <section className="card overflow-hidden">
            <header className="border-b border-line px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">Team · {cast.length}</h3>
              <p className="mt-0.5 text-xs text-muted">
                {agentsOnline.length === 0
                  ? 'No agent connected. Connect one and it takes over the role it plays.'
                  : `Agents: ${[...new Set(agentsOnline.map((a) => a.name))].sort((a, b) => a.localeCompare(b)).join(', ')}`}
              </p>
            </header>
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {cast.map((role) => {
                const players = state.agents.filter((a) => a.working && a.roleKey === role.key);
                return (
                  <li key={role.key} className={clsx('flex items-center gap-3 px-4 py-2', players.length > 0 && 'bg-accent-soft/60')}>
                    <PixelAvatar look={roleCharacter(role)} size={2} />
                    <div className="min-w-0 text-[13px]">
                      <p className="font-semibold">{role.name}</p>
                      <p className="text-xs text-muted">
                        {players.length === 0
                          ? 'At their desk'
                          : players.map((a) => (
                              <span key={a.id} className="mr-2 inline-block">
                                <span className="font-medium text-accent">{a.name}</span> · {stageName(a.stage)}
                                {a.taskKey && <span className="font-mono"> · {a.taskKey}</span>}
                              </span>
                            ))}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="card overflow-hidden">
            <header className="border-b border-line px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">{state.replaying ? 'Replayed chatter' : 'Office chatter'}</h3>
            </header>
            {log.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-muted">{state.replaying ? 'Press play to replay the history.' : 'Everything said in the office appears here.'}</p>
            ) : (
              <ol className="max-h-[440px] divide-y divide-line overflow-y-auto" role="log" aria-label="Office chatter">
                {log.map((l) => {
                  const role = l.roleKey ? rolesByKey.get(l.roleKey) : undefined;
                  return (
                    <li key={l.id} className="flow-feed-in px-4 py-2 text-[13px]">
                      <span className="font-semibold" style={role ? { color: role.color } : undefined}>
                        {l.speaker.name}
                        {l.speaker.kind === 'user' && ' (you)'}
                      </span>
                      <span className="text-muted">: </span>
                      <span className={clsx(l.tone === 'question' && 'font-medium text-warning')}>{l.text}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
