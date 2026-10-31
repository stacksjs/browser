/**
 * Which tabs keep a live page. A sleeping tab keeps its row, its last snapshot
 * and its address; its page process goes, and it reloads when shown again.
 * This is most of a browser's memory: one live page is commonly 50 to 300 MB.
 */

export interface TabActivity {
  id: string
  lastActiveAt: number
  /** It has a page now. */
  live: boolean
  /** Shown in a window or a split pane right now. */
  visible: boolean
  /** Playing sound or video, or using the camera or microphone: never put to sleep. */
  busy?: boolean
  /** A pinned tab or favorite, which sleeps later than a Today tab. */
  pinned?: boolean
}

export interface HibernationPolicy {
  /** A Today tab sleeps after this long unseen. */
  idleMs: number
  /** A pinned tab or favorite sleeps after this long unseen. */
  pinnedIdleMs: number
  /** At most this many live pages; the longest unseen go first. */
  maxLive: number
}

export const DEFAULT_POLICY: HibernationPolicy = { idleMs: 30 * 60_000, pinnedIdleMs: 4 * 3_600_000, maxLive: 12 }

/** The policy under memory pressure: the system asked for memory back, so keep only what is on screen and busy. */
export const PRESSURE_POLICY: HibernationPolicy = { idleMs: 0, pinnedIdleMs: 0, maxLive: 0 }

/** The tabs to put to sleep now, longest unseen first. */
export function tabsToSleep(tabs: TabActivity[], now: number, policy: HibernationPolicy = DEFAULT_POLICY): string[] {
  const candidates = tabs.filter(tab => tab.live && !tab.visible && !tab.busy)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
  const asleep = new Set(candidates
    .filter(tab => now - tab.lastActiveAt >= (tab.pinned ? policy.pinnedIdleMs : policy.idleMs))
    .map(tab => tab.id))
  // Over the limit, the longest unseen of what is left go too. What is on screen or busy never counts against it.
  let live = candidates.length - asleep.size
  for (const tab of candidates) {
    if (live <= policy.maxLive) break
    if (asleep.has(tab.id)) continue
    asleep.add(tab.id)
    live--
  }
  return candidates.filter(tab => asleep.has(tab.id)).map(tab => tab.id)
}
