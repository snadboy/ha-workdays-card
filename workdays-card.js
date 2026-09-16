/* workdays-card — month grid of workday checkboxes with reason badges.
   checked = workday.  badges: H = holiday, M = manual override. */
const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

class WorkdaysCard extends HTMLElement {
  setConfig(config) {
    if (!config.overrides_calendar) throw new Error("overrides_calendar is required");
    this.config = {
      workday_calendar: "calendar.workday_sensor_us_calendar",
      workday_sensor: "binary_sensor.workday_base",
      holiday_calendar: "",
      settings_path: "/config/integrations/integration/workday",
      title: "Workdays",
      ...config,
    };
    // setConfig runs again whenever Home Assistant re-applies a config to the SAME element
    // (dashboard edits, and every time a Bubble pop-up rebuilds its children). Building the
    // shadow root unconditionally throws on the second call and the card shows
    // "Configuration error", so the DOM is created exactly once.
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML =
        `<style>${WorkdaysCard.styles}</style><ha-card></ha-card><dialog class="settings"></dialog>`;
      this._root = this.shadowRoot.querySelector("ha-card");
      this._dlg = this.shadowRoot.querySelector("dialog.settings");
      this._root.addEventListener("click", (e) => this._onClick(e));
      this._dlg.addEventListener("click", (e) => {
        if (e.target === this._dlg) return this._closeDialog();   // click on the backdrop
        this._onClick(e);
      });
      this._dlg.addEventListener("close", () => { this._draft = null; });
    }
    if (!this._cursor) {
      this._cursor = new Date();
      this._cursor.setDate(1);
    }
    this._base = this._base || new Set();
    this._over = this._over || new Map();
    this._names = this._names || new Map();
    this._draft = null;
    this._loaded = null;
    if (this._hass) this._load();
  }

  set hass(hass) {
    this._hass = hass;
    const key = `${this._cursor.getFullYear()}-${this._cursor.getMonth()}`;
    if (this._loaded !== key) {
      this._load();
      return;
    }
    // hass changes on every state update in the system — several times a second on a busy
    // instance. Re-rendering each time replaces the node under the cursor and the hover
    // style restarts, which reads as flicker. Only re-render when something we show changed.
    const sig = (this._defaultWorkdays() || []).join(",");
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
  }

  getCardSize() { return 8; }

  _monthRange() {
    const s = new Date(this._cursor.getFullYear(), this._cursor.getMonth(), 1);
    const e = new Date(this._cursor.getFullYear(), this._cursor.getMonth() + 1, 1);
    s.setDate(s.getDate() - 10);
    e.setDate(e.getDate() + 16);
    return [s, e];
  }

  async _fetch(entity, start, end) {
    if (!entity) return [];
    try {
      return await this._hass.callApi("GET",
        `calendars/${entity}?start=${start.toISOString()}&end=${end.toISOString()}`);
    } catch (err) {
      return [];
    }
  }

  _expandInto(ev, target) {
    const sd = ev.start && (ev.start.date || ev.start.dateTime);
    const ed = ev.end && (ev.end.date || ev.end.dateTime);
    if (!sd) return;
    const cur = new Date(sd.slice(0, 10) + "T00:00:00");
    const stop = ed ? new Date(ed.slice(0, 10) + "T00:00:00") : new Date(cur);
    let guard = 0;
    while (guard++ < 40) {
      const k = iso(cur);
      if (target instanceof Set) target.add(k);
      else target.set(k, { uid: ev.uid, summary: ev.summary || "" });
      cur.setDate(cur.getDate() + 1);
      if (!ed || cur >= stop) break;
    }
  }

  async _load() {
    if (!this._hass) return;
    this._loaded = `${this._cursor.getFullYear()}-${this._cursor.getMonth()}`;
    const [s, e] = this._monthRange();
    const [base, over, hol] = await Promise.all([
      this._fetch(this.config.workday_calendar, s, e),
      this._fetch(this.config.overrides_calendar, s, e),
      this._fetch(this.config.holiday_calendar, s, e),
    ]);
    // a slower response from a month we have since navigated away from must not clobber the current one
    if (this._loaded !== `${this._cursor.getFullYear()}-${this._cursor.getMonth()}`) return;
    this._base = new Set();
    (base || []).forEach((ev) => this._expandInto(ev, this._base));
    this._over = new Map();
    (over || []).forEach((ev) => this._expandInto(ev, this._over));
    this._names = new Map();
    (hol || []).forEach((ev) => this._expandInto(ev, this._names));
    this._render();
  }

  _defaultWorkdays() {
    const st = this._hass && this._hass.states[this.config.workday_sensor];
    return (st && st.attributes.workdays) || ["mon", "tue", "wed", "thu", "fri"];
  }

  _dayInfo(d) {
    const key = iso(d);
    const normal = this._defaultWorkdays().includes(WD[d.getDay()]);
    const base = this._base.has(key);
    const ov = this._over.get(key) || null;
    const forcedOn = !!ov && /workday/i.test(ov.summary);
    const holiday = normal && !base;
    const workday = ov ? forcedOn : base;
    const named = this._names.get(key);
    const badge = ov ? "Override" : holiday ? (named && named.summary ? named.summary : "Holiday") : "";
    return { key, normal, base, ov, holiday, workday, badge, badgeKind: ov ? "m" : "h" };
  }

  async _onClick(e) {
    const nav = e.composedPath().find((n) => n.dataset && n.dataset.nav);
    if (nav) {
      const n = nav.dataset.nav;
      if (n === "settings") {
        this._draft = [...this._defaultWorkdays()];
        this._renderDialog();
        if (!this._dlg.open) this._dlg.showModal();
        return;
      }
      if (n === "wd-toggle") {
        const d = nav.dataset.day;
        this._draft = this._draft.includes(d) ? this._draft.filter((x) => x !== d) : [...this._draft, d];
        this._renderDialog();
        return;
      }
      if (n === "cancel") { this._closeDialog(); return; }
      if (n === "save") { this._saveSettings(nav); return; }
      if (n === "advanced") {
        history.pushState(null, "", this.config.settings_path);
        window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
        return;
      }
      const now = new Date();
      this._cursor = n === "today"
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(this._cursor.getFullYear(), this._cursor.getMonth() + Number(n), 1);
      this._loaded = null;
      this._load();
      return;
    }
    const cell = e.composedPath().find((n) => n.dataset && n.dataset.date);
    if (!cell) return;
    const info = this._dayInfo(new Date(cell.dataset.date + "T00:00:00"));
    const want = !info.workday;
    cell.classList.add("busy");
    try {
      if (info.ov) {
        await this._hass.callWS({
          type: "calendar/event/delete",
          entity_id: this.config.overrides_calendar,
          uid: info.ov.uid,
        });
      }
      if (want !== info.base) {
        const end = new Date(cell.dataset.date + "T00:00:00");
        end.setDate(end.getDate() + 1);
        await this._hass.callService("calendar", "create_event", {
          entity_id: this.config.overrides_calendar,
          summary: want ? "Workday" : "Day off",
          start_date: info.key,
          end_date: iso(end),
        });
      }
    } catch (err) {
      console.error("workdays-card:", err);
    }
    this._loaded = null;
    await this._load();
  }

  _closeDialog() {
    if (this._dlg.open) this._dlg.close();
    this._draft = null;
  }

  async _saveSettings(btn) {
    btn.textContent = "Saving…";
    btn.style.pointerEvents = "none";
    try {
      const entries = await this._hass.callWS({ type: "config_entries/get" });
      const entry = entries.find((e) => e.domain === "workday");
      if (!entry) throw new Error("Workday integration not found");
      // start its options flow: the returned schema carries the current values as defaults
      const flow = await this._hass.callApi("POST", "config/config_entries/options/flow",
        { handler: entry.entry_id, show_advanced_options: true });
      const data = {};
      (flow.data_schema || []).forEach((f) => { if (f.default !== undefined) data[f.name] = f.default; });
      const picked = WD.filter((d) => this._draft.includes(d));
      data.workdays = picked;
      // a day cannot be both a workday and excluded
      data.excludes = (data.excludes || []).filter((d) => !picked.includes(d));
      await this._hass.callApi("POST", `config/config_entries/options/flow/${flow.flow_id}`, data);
      this._closeDialog();
      // the integration reloads and regenerates its calendar; until it does, the fetch
      // comes back empty and every day would render as a holiday. retry until it answers.
      for (let i = 0; i < 8; i++) {
        this._loaded = null;
        await this._load();
        if (this._base.size > 0) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error("workdays-card settings:", err);
      btn.textContent = "Failed — see console";
      btn.style.pointerEvents = "";
    }
  }

  _renderDialog() {
    const sel = this._draft || this._defaultWorkdays();
    const st = this._hass.states[this.config.workday_sensor];
    const chips = [1, 2, 3, 4, 5, 6, 0].map((i) => {
      const d = WD[i];
      const label = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][i];
      return `<button class="chip ${sel.includes(d) ? "on" : ""}" data-nav="wd-toggle" data-day="${d}">${label}</button>`;
    }).join("");
    this._dlg.innerHTML = `
      <div class="hdr">
        <div class="title">Workdays · settings</div>
        <div class="nav"><button data-nav="cancel" title="Close">&times;</button></div>
      </div>
      <div class="sect">Default workdays</div>
      <div class="chips">${chips}</div>
      <div class="note">Holidays are excluded automatically. These are the days that count as workdays before holidays and your own overrides are applied.</div>
      <div class="sect">Holiday source</div>
      <div class="note mono">${this.config.workday_calendar}<br>${st ? (st.attributes.country || "Workday integration") : "unavailable"}</div>
      <div class="sect">Your overrides</div>
      <div class="note mono">${this.config.overrides_calendar}</div>
      <div class="actions">
        <button data-nav="advanced" class="ghost">Holidays &amp; country…</button>
        <button data-nav="cancel" class="ghost">Cancel</button>
        <button data-nav="save" class="primary">Save</button>
      </div>`;
  }

  _render() {
    if (!this._hass) return;
    const cur = this._cursor;
    const monthName = cur.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const todayKey = iso(new Date());
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const info = this._dayInfo(d);
      const out = d.getMonth() !== cur.getMonth();
      const label = `${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} — ${info.workday ? "workday" : "not a workday"}${info.badge ? " (" + info.badge + ")" : ""}`;
      cells += `<button type="button" class="cell${out ? " out" : ""}${info.key === todayKey ? " today" : ""}"
          data-date="${info.key}" title="${label}" aria-label="${label}" aria-pressed="${info.workday}">
          <span class="num">${d.getDate()}</span>
          <span class="box ${info.workday ? "on" : "off"}">${info.workday ? "✓" : ""}</span>
          <span class="tag ${info.badge ? "show" : ""} ${info.badgeKind}">${info.badge}</span>
        </button>`;
    }
    const html = `
      <div class="hdr">
        <div class="title">${this.config.title}</div>
        <div class="nav">
          <button data-nav="-1" title="Previous month">&lsaquo;</button>
          <button data-nav="1" title="Next month">&rsaquo;</button>
          <button class="today" data-nav="today">Today</button>
          <button class="gear" data-nav="settings" title="Workday settings">&#9881;</button>
        </div>
      </div>
      <div class="month">${monthName}</div>
      <div class="grid dow">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<div class="dowc">${x}</div>`).join("")}</div>
      <div class="grid">${cells}</div>`;
    // identical markup: leave the existing nodes alone so hover/focus survive
    if (html === this._html) return;
    this._html = html;
    this._sig = (this._defaultWorkdays() || []).join(",");
    this._root.innerHTML = html;
  }
}

WorkdaysCard.styles = `
  ha-card { padding: 12px 14px 14px; }
  .hdr { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .title { font-size:16px; font-weight:500; }
  .nav { display:flex; gap:4px; align-items:center; }
  button { background:var(--secondary-background-color); color:var(--primary-text-color);
    border:none; border-radius:14px; padding:4px 10px; cursor:pointer; line-height:1.4;
    font-family:inherit; font-size:14px; }
  button:hover { background:var(--divider-color); }
  .today { font-size:13px; }
  .month { text-align:center; font-weight:500; font-size:15px; margin:8px 0 6px; }
  .grid { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
  .dowc { text-align:center; font-size:12px; color:var(--secondary-text-color); padding-bottom:2px; }
  /* the whole cell is a button: generous target, and children never intercept the click */
  .cell { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:flex-start;
    gap:2px; border-radius:10px; padding:6px 3px 5px; min-height:66px; width:100%; cursor:pointer;
    background:var(--secondary-background-color); border:2px solid transparent; text-align:center;
    font-family:inherit; color:inherit; transition:background .12s ease, border-color .12s ease; }
  .cell > * { pointer-events:none; }
  .cell:hover { background:var(--divider-color); }
  .cell:active { transform:scale(0.97); }
  .cell:focus-visible { outline:none; border-color:var(--primary-color); }
  .cell.out { opacity:0.38; }
  .cell.today { border-color:var(--primary-color); }
  .cell.today .num { color:var(--primary-color); font-weight:700; }
  .cell.busy { opacity:0.5; pointer-events:none; }
  .num { display:block; font-size:12px; line-height:1; color:var(--secondary-text-color); }
  .box { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px;
    border:2px solid var(--divider-color); border-radius:5px; font-size:14px; line-height:1; }
  .box.on { background:var(--primary-color); border-color:var(--primary-color); color:var(--text-primary-color,#fff); }
  /* holiday name / Override label */
  .tag { display:none; font-size:9.5px; line-height:1.15; font-weight:600; width:100%;
    padding:1px 2px; border-radius:4px; overflow:hidden; word-break:break-word;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .tag.show { display:-webkit-box; }
  .tag.h { color:var(--warning-color,#ffa726); }
  .tag.m { color:var(--info-color,#39c0ed); }
  dialog.settings { border:none; border-radius:var(--ha-card-border-radius,14px); padding:18px 20px 16px;
    max-width:380px; width:calc(100vw - 48px); color:var(--primary-text-color);
    background:var(--ha-card-background,var(--card-background-color,#fff));
    box-shadow:0 8px 32px rgba(0,0,0,0.4); }
  dialog.settings::backdrop { background:rgba(0,0,0,0.55); backdrop-filter:blur(2px); }
  .sect { margin:16px 0 8px; font-size:14px; font-weight:600; color:var(--primary-text-color); }
  .chips { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { min-width:46px; border-radius:16px; padding:7px 12px; font-size:14px;
    background:var(--secondary-background-color); border:2px solid transparent; }
  .chip.on { background:var(--primary-color); color:var(--text-primary-color,#fff); }
  .note { font-size:13px; color:var(--secondary-text-color); line-height:1.5; }
  .note.mono { font-family:var(--code-font-family,monospace); font-size:12.5px; }
  .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; flex-wrap:wrap; }
  .primary { background:var(--primary-color); color:var(--text-primary-color,#fff); padding:8px 18px; font-size:14px; }
  .ghost { background:var(--secondary-background-color); padding:8px 14px; font-size:14px; }
`;

customElements.define("workdays-card", WorkdaysCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "workdays-card",
  name: "Workdays Card",
  description: "Month grid of workday checkboxes with holiday/manual badges",
});
