/**
 * One shared subscription to a league's social room per socket.
 *
 * League chat, the unread badge and the Trade Centre all listen in the same Socket.IO room, and
 * `social:leave` removes the socket from it for everyone. So the room is joined when the first
 * screen subscribes and left only when the last one unsubscribes.
 */

export type LeagueSocialRoomStatus =
  /** A join is in flight. */
  | 'joining'
  /** The server admitted the socket; events are being delivered. */
  | 'live'
  /** No Socket.IO process, a disconnected socket, or a join the server never answered. */
  | 'unavailable'
  /** The server answered and refused the join. */
  | 'refused';

export interface LeagueSocialRoomSocket {
  connected: boolean;
  emit: (event: string, ...args: unknown[]) => unknown;
  on: (event: string, handler: () => void) => unknown;
  off: (event: string, handler: () => void) => unknown;
}

type Listener = (status: LeagueSocialRoomStatus) => void;

interface RoomEntry {
  listeners: Set<Listener>;
  status: LeagueSocialRoomStatus;
  attempt: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
  handleConnect: () => void;
  handleDisconnect: () => void;
}

export const LEAGUE_SOCIAL_JOIN_TIMEOUT_MS = 5_000;

const roomsBySocket = new WeakMap<object, Map<string, RoomEntry>>();

function setStatus(entry: RoomEntry, status: LeagueSocialRoomStatus): void {
  entry.status = status;
  // Copy first: a listener may unsubscribe while being notified.
  [...entry.listeners].forEach((listener) => listener(status));
}

function clearJoinTimeout(entry: RoomEntry): void {
  if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
  entry.timeoutId = null;
}

function join(socket: LeagueSocialRoomSocket, leagueId: string, entry: RoomEntry): void {
  clearJoinTimeout(entry);
  const attempt = ++entry.attempt;
  setStatus(entry, 'joining');
  entry.timeoutId = setTimeout(() => {
    entry.timeoutId = null;
    if (entry.attempt === attempt) setStatus(entry, 'unavailable');
  }, LEAGUE_SOCIAL_JOIN_TIMEOUT_MS);
  socket.emit('social:join', { leagueId }, (acknowledgement: { ok?: boolean } | undefined) => {
    // A late answer to an earlier join must not overwrite the current one.
    if (entry.attempt !== attempt || entry.listeners.size === 0) return;
    clearJoinTimeout(entry);
    setStatus(entry, acknowledgement?.ok === true ? 'live' : 'refused');
  });
}

/**
 * Subscribes to the league's social room. The listener is called with the current status at once
 * and on every change; `live` is reported again after each reconnect, which is the cue to resync.
 * Returns the unsubscribe function.
 */
export function subscribeLeagueSocialRoom(
  socket: LeagueSocialRoomSocket,
  leagueId: string,
  listener: Listener
): () => void {
  let rooms = roomsBySocket.get(socket);
  if (!rooms) {
    rooms = new Map();
    roomsBySocket.set(socket, rooms);
  }

  let entry = rooms.get(leagueId);
  if (entry) {
    entry.listeners.add(listener);
    listener(entry.status);
  } else {
    const created: RoomEntry = {
      listeners: new Set([listener]),
      status: 'unavailable',
      attempt: 0,
      timeoutId: null,
      handleConnect: () => join(socket, leagueId, created),
      handleDisconnect: () => {
        clearJoinTimeout(created);
        created.attempt += 1;
        setStatus(created, 'unavailable');
      },
    };
    entry = created;
    rooms.set(leagueId, created);
    socket.on('connect', created.handleConnect);
    socket.on('disconnect', created.handleDisconnect);
    if (socket.connected) join(socket, leagueId, created);
    else listener(created.status);
  }

  const subscribed = entry;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    subscribed.listeners.delete(listener);
    if (subscribed.listeners.size > 0) return;

    clearJoinTimeout(subscribed);
    subscribed.attempt += 1;
    socket.off('connect', subscribed.handleConnect);
    socket.off('disconnect', subscribed.handleDisconnect);
    roomsBySocket.get(socket)?.delete(leagueId);
    socket.emit('social:leave', { leagueId });
  };
}
