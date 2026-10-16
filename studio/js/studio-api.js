// studio/js/studio-api.js — Canonical `window.slopscore.studio` implementation (CONTRACTS.md §9).
// Consumed by `studio/index.html`, `studio/webmcp-bridge.js`, and `studio/assistant/panel.js`.

/**
 * Create and register `window.slopscore.studio` bound to the active Studio UI controller.
 * @param {object} host callbacks and state accessors provided by studio/index.html
 */
export function createStudioApi(host) {
  const listeners = new Map();

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (err) { console.warn(`[studio-api] listener error (${event}):`, err); }
    }
  }

  const api = {
    emit,

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => api.off(event, fn);
    },

    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },

    getState() {
      return host.getState();
    },

    async seek(opts = {}) {
      const res = await host.seek(opts);
      emit('timeupdate', res);
      emit('statechange', res);
      return res;
    },

    async play() {
      const res = await host.play();
      emit('statechange', res);
      return res;
    },

    async pause() {
      const res = await host.pause();
      emit('statechange', res);
      return res;
    },

    async setTab(tabId) {
      const res = await host.setTab(tabId);
      emit('statechange', res);
      return res;
    },

    async getProject() {
      return host.getProject();
    },

    async getClips() {
      return host.getClips();
    },

    async getNotes() {
      return host.getNotes();
    },

    async getSources() {
      return host.getSources();
    },

    async getStems() {
      return host.getStems();
    },

    async addNote(noteInput = {}) {
      const res = await host.addNote(noteInput);
      emit('notes', res);
      return res;
    },

    async selectSource(sourceId) {
      const res = await host.selectSource(sourceId);
      emit('statechange', host.getState());
      return res;
    },

    async setLoop(loopOpts = {}) {
      const res = await host.setLoop(loopOpts);
      emit('statechange', host.getState());
      return res;
    },

    async automatchLoop(opts = {}) {
      const res = await host.automatchLoop(opts);
      emit('statechange', host.getState());
      return res;
    },

    async saveClip(clipInput = {}) {
      const res = await host.saveClip(clipInput);
      emit('clips', res);
      return res;
    },

    async bindClip({ clipId, chapterIndex } = {}) {
      const res = await host.bindClip({ clipId, chapterIndex });
      emit('overrides', res);
      return res;
    },

    async getOverrides() {
      return host.getOverrides();
    },

    async setOverrides(overrides = {}) {
      const res = await host.setOverrides(overrides);
      emit('overrides', res);
      return res;
    },

    async setShaderParam({ param, value, chapterId } = {}) {
      const res = await host.setShaderParam({ param, value, chapterId });
      emit('overrides', res);
      return res;
    },

    async setCameraParam({ param, value, chapterId } = {}) {
      const res = await host.setCameraParam({ param, value, chapterId });
      emit('overrides', res);
      return res;
    },

    async setRendererParam({ param, value } = {}) {
      return host.setRendererParam({ param, value });
    },

    async setStemMix({ stemId, mute, solo, volume } = {}) {
      return host.setStemMix({ stemId, mute, solo, volume });
    },

    async runCommand({ action, range, customCmd } = {}) {
      const res = await host.runCommand({ action, range, customCmd });
      emit('run', res);
      return res;
    },

    async captureFrame() {
      return host.captureFrame();
    }
  };

  window.slopscore = window.slopscore || {};
  window.slopscore.studio = api;
  return api;
}
