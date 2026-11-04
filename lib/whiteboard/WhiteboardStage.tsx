'use client';

/**
 * Excalidraw board (LiveDoc whiteboard), drawn over the LiveDoc stage while the current LiveDoc
 * file is an Excalidraw board. Host, co-hosts and presenters draw together; everyone else watches
 * and follows the leader's view. The leader (see boardLeader) also saves the board to Kloud.
 *
 * Loaded with next/dynamic (ssr: false): Excalidraw is large and browser-only.
 */

import * as React from 'react';
import { RoomEvent, type Participant, type Room } from 'livekit-client';
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  getSceneVersion,
  getVisibleSceneBounds,
  reconcileElements,
} from '@excalidraw/excalidraw';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  AppState,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { createOrUpdateInstantAccount } from '@/lib/livedoc/client';
import { useI18n } from '@/lib/i18n';
import {
  WB_LIVE_TOPIC,
  WB_TOPIC,
  boardLeader,
  boardText,
  canEditBoard,
  fitBounds,
  parseLive,
  parseReliable,
  parseSavedBoard,
  rememberElements,
  serializeBoard,
  takeChangedElements,
  type BoardElement,
  type BoardRoles,
  type LiveMessage,
  type ReliableMessage,
  type SceneBounds,
} from './protocol';
import styles from '@/styles/WhiteboardStage.module.css';

// Fonts come from our own origin (scripts/copy-excalidraw-assets.cjs), not the library's CDN
if (typeof window !== 'undefined') {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
}

/** MeetingServer ExceptionEnum.WHITEBOARD_VERSION_CONFLICT */
const VERSION_CONFLICT = 227;
const SEND_EVERY_MS = 50;
const POINTER_EVERY_MS = 50;
const VIEW_EVERY_MS = 120;
const VIEW_HEARTBEAT_MS = 2000;
const SAVE_IDLE_MS = 2000;
const SAVE_MAX_WAIT_MS = 10000;
const POINTER_STALE_MS = 8000;
const RETRY_DELAYS_MS = [3000, 10000, 30000];
const CURSOR_COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#c2255c', '#6741d9', '#0c8599', '#f08c00'];

type SaveStatus = 'loading' | 'saved' | 'saving' | 'unsaved' | 'offline' | 'error';

export interface WhiteboardStageProps {
  room: Room;
  /** LiveDoc AttachmentID of the board */
  attachmentId: number;
  username: string;
  roles: BoardRoles;
}

interface SceneResponse {
  code?: number;
  msg?: string;
  data?: unknown;
}

const backupKey = (board: number) => `kloudmeet.whiteboard.${board}`;

function readBackup(board: number): BoardElement[] {
  try {
    return parseSavedBoard(localStorage.getItem(backupKey(board)));
  } catch {
    return [];
  }
}

function writeBackup(board: number, elements: readonly BoardElement[]) {
  try {
    localStorage.setItem(backupKey(board), serializeBoard(elements));
  } catch {
    // Full or blocked storage: the board still syncs and saves, there is just no local copy
  }
}

function clearBackup(board: number) {
  try {
    localStorage.removeItem(backupKey(board));
  } catch {
    // ignore
  }
}

/** Keeps the newer copy of each element (same rule as Excalidraw's reconcile, without app state). */
function mergeNewest(a: readonly BoardElement[], b: readonly BoardElement[]): BoardElement[] {
  const byId = new Map<string, BoardElement>();
  for (const el of [...a, ...b]) {
    const cur = byId.get(el.id);
    if (!cur || cur.version < el.version || (cur.version === el.version && cur.versionNonce > el.versionNonce)) {
      byId.set(el.id, el);
    }
  }
  return [...byId.values()];
}

function cursorColor(identity: string) {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) | 0;
  const stroke = CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length];
  return { background: stroke, stroke };
}

const asBoard = (els: readonly OrderedExcalidrawElement[]) => els as unknown as BoardElement[];
const asExcalidraw = (els: readonly BoardElement[]) => els as unknown as OrderedExcalidrawElement[];

export default function WhiteboardStage({ room, attachmentId, username, roles }: WhiteboardStageProps) {
  const { t } = useI18n();
  const localIdentity = room.localParticipant.identity;

  const [initial, setInitial] = React.useState<BoardElement[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [status, setStatus] = React.useState<SaveStatus>('loading');
  const [present, setPresent] = React.useState<string[]>(() => [
    localIdentity,
    ...room.remoteParticipants.keys(),
  ]);

  const editable = canEditBoard(localIdentity, roles);
  const leader = boardLeader(present, roles);
  const isLeader = leader === localIdentity;
  const [following, setFollowing] = React.useState(!editable);

  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null);
  /**
   * The scene as of the last onChange. Saves read this, not apiRef: when the board closes,
   * Excalidraw is torn down before our cleanup runs and its API would report an empty scene.
   */
  const elementsRef = React.useRef<readonly OrderedExcalidrawElement[]>([]);
  /** Elements that arrived before the canvas was ready; applied as soon as it is */
  const pendingInRef = React.useRef<BoardElement[]>([]);
  const [apiReady, setApiReady] = React.useState(false);
  const tokenRef = React.useRef<string | null>(null);
  const knownRef = React.useRef(new Map<string, number>());
  const savedVersionRef = React.useRef(0);
  const savedSceneVersionRef = React.useRef(0);
  const pendingOutRef = React.useRef(new Map<string, BoardElement>());
  const flushTimerRef = React.useRef<number | null>(null);
  const saveIdleTimerRef = React.useRef<number | null>(null);
  const saveMaxTimerRef = React.useRef<number | null>(null);
  const savingRef = React.useRef(false);
  const retryRef = React.useRef(0);
  const backupTimerRef = React.useRef<number | null>(null);
  const collaboratorsRef = React.useRef(new Map<SocketId, Collaborator & { seen: number }>());
  const lastPointerSentRef = React.useRef(0);
  const lastViewSentRef = React.useRef(0);
  const lastViewRef = React.useRef<SceneBounds | null>(null);
  const viewAppliedAtRef = React.useRef(0);

  // Latest values for the long-lived handlers below
  const live = React.useRef({ editable, isLeader, leader, roles, following });
  live.current = { editable, isLeader, leader, roles, following };

  /* ---------- presence ---------- */
  React.useEffect(() => {
    const refresh = () => setPresent([room.localParticipant.identity, ...room.remoteParticipants.keys()]);
    room.on(RoomEvent.ParticipantConnected, refresh);
    room.on(RoomEvent.ParticipantDisconnected, refresh);
    refresh();
    return () => {
      room.off(RoomEvent.ParticipantConnected, refresh);
      room.off(RoomEvent.ParticipantDisconnected, refresh);
    };
  }, [room]);

  /* ---------- sending ---------- */
  const sendReliable = React.useCallback(
    (msg: ReliableMessage, to?: string[]) => {
      room.localParticipant
        .sendText(JSON.stringify(msg), { topic: WB_TOPIC, destinationIdentities: to })
        .catch((e) => console.warn('whiteboard: send failed', e));
    },
    [room],
  );

  const sendLive = React.useCallback(
    (msg: LiveMessage) => {
      const data = new TextEncoder().encode(JSON.stringify(msg));
      room.localParticipant.publishData(data, { reliable: false, topic: WB_LIVE_TOPIC }).catch(() => undefined);
    },
    [room],
  );

  const flushOut = React.useCallback(() => {
    flushTimerRef.current = null;
    const elements = [...pendingOutRef.current.values()];
    pendingOutRef.current.clear();
    if (elements.length) sendReliable({ t: 'el', board: attachmentId, elements });
  }, [attachmentId, sendReliable]);

  /* ---------- saving (leader only) ---------- */
  const fetchScene = React.useCallback(async (): Promise<{ version: number; elements: BoardElement[] }> => {
    const token = tokenRef.current ?? (tokenRef.current = await createOrUpdateInstantAccount(username || 'Guest'));
    const res = await fetch(`/api/whiteboard/scene?attachmentId=${attachmentId}`, {
      headers: { UserToken: token },
      cache: 'no-store',
    });
    const json = (await res.json()) as SceneResponse;
    if (!res.ok || json.code !== 0) throw new Error(json.msg || `scene ${res.status}`);
    const data = (json.data ?? {}) as { version?: number; scene?: string | null };
    return { version: Number(data.version) || 0, elements: parseSavedBoard(data.scene) };
  }, [attachmentId, username]);

  const mergeRemote = React.useCallback((remote: readonly BoardElement[]) => {
    const api = apiRef.current;
    if (!remote.length) return;
    if (!api) {
      pendingInRef.current.push(...remote);
      return;
    }
    rememberElements(remote, knownRef.current);
    const merged = reconcileElements(
      api.getSceneElementsIncludingDeleted(),
      remote as unknown as RemoteExcalidrawElement[],
      api.getAppState(),
    );
    api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
  }, []);

  const clearSaveTimers = () => {
    if (saveIdleTimerRef.current !== null) window.clearTimeout(saveIdleTimerRef.current);
    if (saveMaxTimerRef.current !== null) window.clearTimeout(saveMaxTimerRef.current);
    saveIdleTimerRef.current = null;
    saveMaxTimerRef.current = null;
  };

  const saveNow = React.useCallback(
    async (opts: { keepalive?: boolean } = {}): Promise<void> => {
      if (!live.current.isLeader) return;
      clearSaveTimers();
      if (savingRef.current) {
        saveIdleTimerRef.current = window.setTimeout(() => void saveNow(), SAVE_IDLE_MS);
        return;
      }
      const scene = elementsRef.current;
      // Erased elements stay in the list as deleted, so an empty list means "not loaded", never "cleared"
      if (scene.length === 0 && savedVersionRef.current > 0) return;
      const elements = asBoard(scene);
      const sceneVersion = getSceneVersion(scene);
      if (sceneVersion === savedSceneVersionRef.current) return;
      savingRef.current = true;
      setStatus('saving');
      try {
        const token = tokenRef.current ?? (tokenRef.current = await createOrUpdateInstantAccount(username || 'Guest'));
        const body = JSON.stringify({
          attachmentId,
          baseVersion: savedVersionRef.current,
          scene: serializeBoard(elements),
          textContent: boardText(elements),
          elementCount: elements.filter((el) => !el.isDeleted).length,
        });
        const res = await fetch('/api/whiteboard/scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', UserToken: token },
          body,
          // keepalive bodies are capped at 64 KB; bigger boards rely on the page staying open
          keepalive: opts.keepalive && body.length < 60000,
        });
        const json = (await res.json()) as SceneResponse;
        if (res.ok && json.code === 0) {
          savedVersionRef.current = Number(json.data) || savedVersionRef.current + 1;
          savedSceneVersionRef.current = sceneVersion;
          retryRef.current = 0;
          clearBackup(attachmentId);
          sendReliable({ t: 'saved', board: attachmentId, version: savedVersionRef.current });
          const stillDirty = getSceneVersion(elementsRef.current) !== sceneVersion;
          setStatus(stillDirty ? 'unsaved' : 'saved');
          if (stillDirty) saveIdleTimerRef.current = window.setTimeout(() => void saveNow(), SAVE_IDLE_MS);
          return;
        }
        if (json.code === VERSION_CONFLICT) {
          // Someone else saved first (e.g. a previous leader): take their scene, merge, save again
          const server = await fetchScene();
          mergeRemote(server.elements);
          savedVersionRef.current = server.version;
          saveIdleTimerRef.current = window.setTimeout(() => void saveNow(), 300);
          setStatus('unsaved');
          return;
        }
        throw new Error(json.msg || `save ${res.status}`);
      } catch (e) {
        console.warn('whiteboard: save failed', e);
        writeBackup(attachmentId, elements);
        setStatus('offline');
        const delay = RETRY_DELAYS_MS[Math.min(retryRef.current, RETRY_DELAYS_MS.length - 1)];
        retryRef.current++;
        saveIdleTimerRef.current = window.setTimeout(() => void saveNow(), delay);
      } finally {
        savingRef.current = false;
      }
    },
    [attachmentId, fetchScene, mergeRemote, sendReliable, username],
  );

  const scheduleSave = React.useCallback(() => {
    if (!live.current.isLeader) return;
    if (saveIdleTimerRef.current !== null) window.clearTimeout(saveIdleTimerRef.current);
    saveIdleTimerRef.current = window.setTimeout(() => void saveNow(), SAVE_IDLE_MS);
    if (saveMaxTimerRef.current === null) {
      saveMaxTimerRef.current = window.setTimeout(() => void saveNow(), SAVE_MAX_WAIT_MS);
    }
  }, [saveNow]);

  /* ---------- load ---------- */
  React.useEffect(() => {
    let cancelled = false;
    setInitial(null);
    setLoadError(false);
    setStatus('loading');
    knownRef.current = new Map();
    fetchScene()
      .then(({ version, elements }) => {
        if (cancelled) return;
        // Anything this browser drew but never saw saved (crash, network drop) comes back too
        const merged = mergeNewest(elements, readBackup(attachmentId));
        savedVersionRef.current = version;
        savedSceneVersionRef.current = getSceneVersion(asExcalidraw(elements));
        elementsRef.current = asExcalidraw(merged);
        rememberElements(merged, knownRef.current);
        setInitial(merged);
        setStatus('saved');
      })
      .catch((e) => {
        console.warn('whiteboard: load failed', e);
        if (!cancelled) {
          setLoadError(true);
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId, fetchScene]);

  const loaded = initial !== null;

  // Apply what arrived while the canvas was starting
  React.useEffect(() => {
    if (!apiReady || !pendingInRef.current.length) return;
    const pending = pendingInRef.current;
    pendingInRef.current = [];
    mergeRemote(pending);
  }, [apiReady, mergeRemote]);

  // Once the canvas is up, ask the leader for anything drawn since the last save
  React.useEffect(() => {
    if (!apiReady || !leader || leader === localIdentity) return;
    sendReliable({ t: 'req', board: attachmentId, have: savedVersionRef.current }, [leader]);
  }, [apiReady, leader, localIdentity, attachmentId, sendReliable]);

  /* ---------- receiving ---------- */
  React.useEffect(() => {
    const onReliable = (msg: ReliableMessage, from: string) => {
      if (msg.board !== attachmentId) return;
      const { roles: r, isLeader: leading } = live.current;
      if (msg.t === 'el') {
        if (canEditBoard(from, r)) mergeRemote(msg.elements);
      } else if (msg.t === 'full') {
        if (!canEditBoard(from, r)) return;
        mergeRemote(msg.elements);
        savedVersionRef.current = Math.max(savedVersionRef.current, msg.version);
      } else if (msg.t === 'req') {
        if (!leading || !apiRef.current) return;
        sendReliable(
          {
            t: 'full',
            board: attachmentId,
            version: savedVersionRef.current,
            elements: asBoard(elementsRef.current),
          },
          [from],
        );
      } else if (msg.t === 'saved') {
        if (from === localIdentity || !canEditBoard(from, r)) return;
        savedVersionRef.current = Math.max(savedVersionRef.current, msg.version);
        if (pendingOutRef.current.size === 0) {
          clearBackup(attachmentId);
          setStatus('saved');
        }
      }
    };

    const topicHandler: Parameters<Room['registerTextStreamHandler']>[1] = (reader, info) => {
      reader
        .readAll()
        .then((text) => {
          const msg = parseReliable(text);
          if (msg) onReliable(msg, info.identity);
        })
        .catch(() => undefined);
    };
    try {
      room.unregisterTextStreamHandler(WB_TOPIC);
    } catch {
      // not registered yet
    }
    room.registerTextStreamHandler(WB_TOPIC, topicHandler);

    const onData = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== WB_LIVE_TOPIC || !participant) return;
      const msg = parseLive(new TextDecoder().decode(payload));
      if (!msg || msg.board !== attachmentId) return;
      const api = apiRef.current;
      if (!api) return;
      const { roles: r, leader: lead, following: follow } = live.current;
      if (msg.t === 'view') {
        if (participant.identity !== lead) return;
        lastViewRef.current = msg.bounds;
        if (follow) applyView(api, msg.bounds);
        return;
      }
      if (!canEditBoard(participant.identity, r)) return;
      const id = participant.identity as SocketId;
      collaboratorsRef.current.set(id, {
        id: participant.identity,
        socketId: id,
        username: participant.name || participant.identity,
        pointer: { x: msg.x, y: msg.y, tool: msg.tool },
        button: msg.down ? 'down' : 'up',
        color: cursorColor(participant.identity),
        seen: Date.now(),
      });
      api.updateScene({ collaborators: new Map(collaboratorsRef.current) });
    };
    room.on(RoomEvent.DataReceived, onData);

    // Drop cursors of people who stopped moving or left
    const sweep = window.setInterval(() => {
      const api = apiRef.current;
      const now = Date.now();
      let changed = false;
      for (const [id, c] of collaboratorsRef.current) {
        if (now - c.seen > POINTER_STALE_MS || !room.remoteParticipants.has(id)) {
          collaboratorsRef.current.delete(id);
          changed = true;
        }
      }
      if (changed && api) api.updateScene({ collaborators: new Map(collaboratorsRef.current) });
    }, 2000);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
      window.clearInterval(sweep);
      try {
        room.unregisterTextStreamHandler(WB_TOPIC);
      } catch {
        // already gone
      }
    };
  }, [room, attachmentId, localIdentity, mergeRemote, sendReliable]);

  /* ---------- following the leader's view ---------- */
  function applyView(api: ExcalidrawImperativeAPI, bounds: SceneBounds) {
    const { width, height } = api.getAppState();
    if (!width || !height) return;
    const fit = fitBounds(bounds, width, height);
    viewAppliedAtRef.current = Date.now();
    api.updateScene({
      appState: { scrollX: fit.scrollX, scrollY: fit.scrollY, zoom: { value: fit.zoom } as AppState['zoom'] },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  const sendView = React.useCallback(
    (appState: AppState) => {
      const b = getVisibleSceneBounds(appState);
      sendLive({ t: 'view', board: attachmentId, bounds: [b[0], b[1], b[2], b[3]] });
      lastViewSentRef.current = Date.now();
    },
    [attachmentId, sendLive],
  );

  // The leader repeats its view now and then, so people who just arrived catch up
  React.useEffect(() => {
    if (!isLeader || !loaded) return;
    const timer = window.setInterval(() => {
      const api = apiRef.current;
      if (api) sendView(api.getAppState());
    }, VIEW_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [isLeader, loaded, sendView]);

  // Losing or gaining the right to draw: viewers go back to following, editors stop
  React.useEffect(() => {
    setFollowing(!editable);
  }, [editable]);

  const followLeader = () => {
    setFollowing(true);
    const api = apiRef.current;
    if (api && lastViewRef.current) applyView(api, lastViewRef.current);
  };

  /* ---------- leader hand-off and leaving ---------- */
  React.useEffect(() => {
    if (!isLeader || !loaded) return;
    // A new leader saves whatever the previous one may not have
    if (getSceneVersion(elementsRef.current) !== savedSceneVersionRef.current) scheduleSave();
  }, [isLeader, loaded, scheduleSave]);

  React.useEffect(() => {
    const onPageHide = () => {
      if (flushTimerRef.current !== null) flushOut();
      if (live.current.isLeader) void saveNow({ keepalive: true });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      // Switching to another file: send what is queued and save once more
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushOut();
      }
      if (backupTimerRef.current !== null) window.clearTimeout(backupTimerRef.current);
      if (live.current.isLeader) void saveNow({ keepalive: true });
      clearSaveTimers();
    };
  }, [flushOut, saveNow]);

  /* ---------- Excalidraw callbacks ---------- */
  const onChange = (elements: readonly OrderedExcalidrawElement[]) => {
    if (!loaded) return;
    // Excalidraw reports [] once before it has applied the initial scene; that is not the board
    if (elements.length || !elementsRef.current.length) elementsRef.current = elements;
    if (live.current.editable) {
      const changed = takeChangedElements(asBoard(elements), knownRef.current);
      if (changed.length) {
        for (const el of changed) pendingOutRef.current.set(el.id, el);
        if (flushTimerRef.current === null) flushTimerRef.current = window.setTimeout(flushOut, SEND_EVERY_MS);
        if (!live.current.isLeader) setStatus('unsaved');
        if (backupTimerRef.current === null) {
          backupTimerRef.current = window.setTimeout(() => {
            backupTimerRef.current = null;
            if (elementsRef.current.length) writeBackup(attachmentId, asBoard(elementsRef.current));
          }, 1000);
        }
      }
    }
    // Remote changes count too: the leader saves whatever the board looks like
    if (live.current.isLeader && getSceneVersion(elements) !== savedSceneVersionRef.current) {
      setStatus((s) => (s === 'saving' || s === 'offline' ? s : 'unsaved'));
      scheduleSave();
    }
  };

  const onPointerUpdate = (payload: {
    pointer: { x: number; y: number; tool: 'pointer' | 'laser' };
    button: 'down' | 'up';
  }) => {
    if (!live.current.editable) return;
    const now = Date.now();
    if (now - lastPointerSentRef.current < POINTER_EVERY_MS) return;
    lastPointerSentRef.current = now;
    sendLive({
      t: 'ptr',
      board: attachmentId,
      x: payload.pointer.x,
      y: payload.pointer.y,
      tool: payload.pointer.tool,
      down: payload.button === 'down',
    });
  };

  const onScrollChange = () => {
    const api = apiRef.current;
    if (!api) return;
    if (live.current.isLeader) {
      if (Date.now() - lastViewSentRef.current >= VIEW_EVERY_MS) sendView(api.getAppState());
      return;
    }
    // Moving the board yourself stops following until "Follow presenter"
    if (live.current.following && Date.now() - viewAppliedAtRef.current > 300) setFollowing(false);
  };

  const statusLabel: Record<SaveStatus, string> = {
    loading: t('whiteboard.loading'),
    saved: t('whiteboard.saved'),
    saving: t('whiteboard.saving'),
    unsaved: t('whiteboard.unsaved'),
    offline: t('whiteboard.offline'),
    error: t('whiteboard.loadFailed'),
  };

  return (
    <div className={styles.stage} data-editable={editable ? 'true' : 'false'}>
      {loadError ? (
        <div className={styles.message} role="alert">
          {t('whiteboard.loadFailed')}
        </div>
      ) : !initial ? (
        <div className={styles.message}>{t('whiteboard.loading')}</div>
      ) : (
        <Excalidraw
          key={attachmentId}
          initialData={{
            elements: asExcalidraw(initial),
            appState: { viewBackgroundColor: '#ffffff', theme: 'light' },
          }}
          excalidrawAPI={(api) => {
            apiRef.current = api;
            setApiReady(true);
          }}
          isCollaborating
          viewModeEnabled={!editable}
          theme="light"
          name={t('whiteboard.title')}
          onChange={onChange}
          onPointerUpdate={onPointerUpdate}
          onScrollChange={onScrollChange}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: false,
              clearCanvas: editable,
              export: false,
              loadScene: false,
              saveAsImage: false,
              saveToActiveFile: false,
              toggleTheme: false,
            },
            tools: { image: false },
          }}
        >
          <MainMenu>
            {editable && <MainMenu.DefaultItems.ClearCanvas />}
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
      )}

      <div className={styles.chips}>
        {!editable && <span className={styles.chip}>{t('whiteboard.viewOnly')}</span>}
        {editable && status !== 'loading' && (
          <span className={styles.chip} data-status={status} aria-live="polite">
            {statusLabel[status]}
          </span>
        )}
        {!following && leader && leader !== localIdentity && (
          <button type="button" className={styles.followButton} onClick={followLeader}>
            {t('whiteboard.followPresenter')}
          </button>
        )}
      </div>
    </div>
  );
}
