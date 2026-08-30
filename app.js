(function () {
  "use strict";

  const STORAGE_NAMESPACE = "moth-field-edit-session";
  const DATA_VERSION = String(window.MOTH_FIELD_VERSION || "unversioned");
  const STORAGE_KEY = `${STORAGE_NAMESPACE}:${DATA_VERSION}`;
  const ORIGINAL = clone(window.MOTH_FIELD || {});
  const loadedSession = loadSession();
  let data = loadedSession || clone(ORIGINAL);
  const migratedRelationshipGraph = normaliseData(data);

  const state = {
    lens: "field",
    selected: null,
    editMode: false,
    editorRef: null,
    zoomTransform: d3.zoomIdentity,
    userMoved: false,
    dragBefore: null,
    fellowFocusId: null,
    linkedConceptFocusId: null,
    connectionDraft: null,
    pendingConnection: null,
    editMoveReadyId: null,
    inspectorExpanded: false,
    savedSnapshot: JSON.stringify(data),
    saveState: "saved"
  };

  const history = [snapshot()];
  let historyIndex = 0;
  let root;
  let zoom;

  const svg = d3.select("#field-map");
  const editorShell = document.querySelector(".editor-shell");
  const itemEditor = document.querySelector(".item-editor");
  const editorEmpty = document.querySelector(".editor-empty");
  const mobileLayoutQuery = window.matchMedia("(max-width: 900px), (max-height: 520px) and (max-width: 950px)");

  if (!window.d3 || !data.canvas) {
    document.querySelector(".map-stage").innerHTML = `<p class="load-error">${escapeHtml(data.copy?.loadError || "Map unavailable")}</p>`;
    return;
  }

  const collectionLabels = {
    centre: "Centre",
    territories: "Territory",
    concepts: "Concept / practice",
    thresholds: "Annotation",
    movements: "Movement",
    questions: "Question",
    fellows: "Fellow",
    lenses: "Lens",
    copy: "Interface and map copy",
    relationships: "Relationship"
  };

  const richTextFields = new Set([
    "shortDescription", "description", "longDescription", "references",
    "question", "proposition", "notes", "attribution", "sourceText", "rootNote"
  ]);

  const preferredFields = {
    centre: ["label", "subtitle", "proposition", "shortDescription", "description", "longDescription", "references", "question", "keywords", "tags", "attribution", "sourceText", "x", "y", "weight"],
    territories: ["label", "subtitle", "rootLabel", "rootNote", "shortDescription", "description", "longDescription", "references", "question", "keywords", "terms", "tags", "attribution", "sourceText", "x", "y", "weight", "radiusX", "radiusY", "rotation", "tone"],
    concepts: ["label", "subtitle", "shortDescription", "description", "longDescription", "references", "question", "keywords", "terms", "tags", "attribution", "sourceText", "type", "territories", "related", "x", "y", "weight", "priority"],
    thresholds: ["label", "subtitle", "shortDescription", "description", "longDescription", "references", "question", "keywords", "terms", "tags", "attribution", "sourceText", "territories", "related", "x", "y", "weight"],
    movements: ["label", "subtitle", "from", "to", "shortDescription", "description", "longDescription", "references", "question", "keywords", "terms", "tags", "attribution", "sourceText", "relatedConcepts", "territories", "x1", "y1", "x2", "y2", "weight"],
    questions: ["label", "text", "subtitle", "shortDescription", "description", "longDescription", "references", "keywords", "terms", "tags", "attribution", "sourceText", "territories", "related", "x", "y", "weight"],
    fellows: ["name", "subtitle", "shortDescription", "description", "longDescription", "references", "questions", "offers", "needs", "notes", "keywords", "terms", "tags", "attribution", "sourceText", "territories", "waysOfKnowing", "waysOfActing", "movements", "x", "y", "weight"],
    lenses: ["label", "description"],
    relationships: ["source", "target", "type", "description", "references", "attribution", "sourceText"]
  };

  const fieldLabels = {
    label: "Label / title",
    name: "Name / title",
    text: "Question text",
    proposition: "Central proposition / question",
    subtitle: "Subtitle",
    shortDescription: "Short description",
    description: "Long description / interpretation",
    longDescription: "Additional long description",
    references: "References",
    question: "Central question",
    rootLabel: "Source / root title",
    rootNote: "Source / attribution line",
    sourceText: "Attribution / source text",
    attribution: "Attribution",
    keywords: "Keywords",
    terms: "Terms",
    tags: "Tags",
    related: "Related concepts",
    relatedConcepts: "Related concepts",
    territories: "Related territories",
    waysOfKnowing: "Ways of knowing",
    waysOfActing: "Ways of acting",
    questions: "Fellow questions",
    offers: "Fellow offers",
    needs: "Fellow needs",
    notes: "Fellow notes",
    from: "Movement from wording",
    to: "Movement to wording",
    type: "Type",
    x: "X position",
    y: "Y position",
    x1: "From X",
    y1: "From Y",
    x2: "To X",
    y2: "To Y",
    weight: "Prominence / weight",
    priority: "Visibility priority",
    radiusX: "Territory width",
    radiusY: "Territory height",
    rotation: "Territory rotation",
    tone: "Territory tone"
  };

  setupEvents();
  setupZoom();
  renderAll();
  fitInitial();
  if (loadedSession && migratedRelationshipGraph) scheduleAutoSave();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapshot() {
    return JSON.stringify(data);
  }

  function loadSession() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const session = JSON.parse(stored);
      if (session?.version !== DATA_VERSION || !session.data) return null;
      return session.data;
    } catch (error) {
      return null;
    }
  }

  function normaliseData(target) {
    target.canvas = target.canvas || clone(ORIGINAL.canvas) || { width: 1600, height: 1000 };
    target.copy = { ...(ORIGINAL.copy || {}), ...(target.copy || {}) };
    target.lenses = Array.isArray(target.lenses) && target.lenses.length ? target.lenses : clone(ORIGINAL.lenses || []);
    target.relationshipTypes = Array.isArray(target.relationshipTypes) ? target.relationshipTypes : clone(ORIGINAL.relationshipTypes || []);
    ["territories", "concepts", "thresholds", "movements", "questions", "fellows", "relationships"].forEach(key => {
      if (!Array.isArray(target[key])) target[key] = [];
    });
    migrateContentSchema(target);
    applyRequiredContentMigrations(target);
    const relationshipGraphMigrated = migrateRelationshipGraph(target);
    const hasCentralTerritory = target.territories.some(item => item.role === "centre");
    if (!target.centre && !hasCentralTerritory) {
      target.centre = clone(ORIGINAL.centre) || { id: "moth", label: "MOTH", x: target.canvas.width / 2, y: target.canvas.height / 2, weight: 1 };
    }
    target.relationships.forEach((relationship, index) => {
      if (!relationship.id) relationship.id = uniqueId("relationship", target.relationships, index + 1);
    });
    return relationshipGraphMigrated;
  }

  function migrateRelationshipGraph(target) {
    const baselineRevision = String(ORIGINAL.relationshipGraphRevision || "");
    if (!baselineRevision || target.relationshipGraphRevision === baselineRevision) return false;
    const changedIds = new Set([
      "relationship-11",
      "relationship-editorial-kawsak-sacha-territory-lineage",
      "relationship-editorial-grief-inner-landscapes-enables"
    ]);
    const canonicalRelationships = ORIGINAL.relationships || [];
    const currentById = new Map(target.relationships.map(relationship => [relationship.id, relationship]));
    canonicalRelationships.forEach(relationship => {
      const current = currentById.get(relationship.id);
      if (current && changedIds.has(relationship.id)) Object.assign(current, clone(relationship));
      else if (!current) target.relationships.push(clone(relationship));
    });
    target.relationshipGraphRevision = baselineRevision;
    return true;
  }

  function migrateContentSchema(target) {
    const items = [
      ...(target.centre ? [target.centre] : []),
      ...target.territories,
      ...target.concepts,
      ...target.thresholds,
      ...target.movements,
      ...target.questions,
      ...target.fellows,
      ...target.relationships
    ];
    items.forEach(item => {
      if (typeof item.references !== "string") item.references = "";
      if (!item.references && typeof item.longDescription === "string" && /^\s*References?\s*:/i.test(item.longDescription)) {
        item.references = item.longDescription.replace(/^\s*References?\s*:\s*/i, "");
        item.longDescription = "";
      }
    });
  }

  function applyRequiredContentMigrations(target) {
    const hiddenConceptIds = new Set(target.concepts
      .filter(item => /^HIDDEN(?:\s|$)/.test(String(item.label || "")))
      .map(item => item.id));
    if (hiddenConceptIds.size) {
      target.concepts = target.concepts.filter(item => !hiddenConceptIds.has(item.id));
      removeReferences(target, hiddenConceptIds);
    }
    target.copy.footerNote = 'This map is unfinished. Edit and update it using the "edit" button at the top.';
    target.copy.footerPrinciple = "https://mothlife.org/";
  }

  function removeReferences(target, ids) {
    target.relationships = target.relationships.filter(relationship => !ids.has(relationship.source) && !ids.has(relationship.target));
    const items = [
      ...(target.centre ? [target.centre] : []),
      ...target.territories,
      ...target.concepts,
      ...target.thresholds,
      ...target.movements,
      ...target.questions,
      ...target.fellows
    ];
    items.forEach(item => {
      Object.keys(item).forEach(key => {
        if (Array.isArray(item[key])) item[key] = item[key].filter(value => !ids.has(value));
      });
    });
  }

  function uniqueId(base, collection, suffix = 1) {
    const used = new Set((collection || []).map(item => item.id));
    let id = `${base}-${suffix}`;
    let n = suffix;
    while (used.has(id)) id = `${base}-${++n}`;
    return id;
  }

  function setupEvents() {
    document.querySelector(".edit-mode-toggle").addEventListener("click", () => toggleEditMode());
    document.querySelector(".editor-close").addEventListener("click", () => toggleEditMode(false));
    document.querySelector(".inspector-close").addEventListener("click", closeInspector);
    document.querySelector(".inspector-sheet-toggle").addEventListener("click", toggleInspectorSheet);
    document.querySelector(".inspector-return-fellow").addEventListener("click", returnToFocusedFellow);
    document.querySelector(".relationship-type-form").addEventListener("submit", savePendingRelationship);
    document.querySelector(".relationship-type-cancel").addEventListener("click", closeRelationshipTypeChooser);

    document.querySelectorAll("[data-zoom]").forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.zoom;
      if (action === "reset") returnToTerritoryOverview();
      else svg.transition().duration(260).call(zoom.scaleBy, action === "in" ? 1.25 : 0.8);
    }));

    document.querySelectorAll("[data-editor-tab]").forEach(button => button.addEventListener("click", () => switchEditorTab(button.dataset.editorTab)));
    document.querySelector(".content-search").addEventListener("input", renderContentList);
    document.querySelectorAll("[data-create]").forEach(button => button.addEventListener("click", () => createItem(button.dataset.create)));
    document.querySelector(".relationship-add-form").addEventListener("submit", addRelationshipFromForm);
    document.querySelectorAll(".relationship-add-form [data-node-search]").forEach(input => input.addEventListener("input", () => updateRelationshipNodeOptions(input.dataset.nodeSearch)));
    document.querySelector(".preview-lens").addEventListener("change", event => setLens(event.target.value));
    document.querySelector(".territory-navigator select").addEventListener("change", selectTerritoryFromNavigator);
    document.querySelector(".mobile-edit-toolbar-toggle").addEventListener("click", toggleMobileEditToolbar);
    document.querySelector(".editor-sheet-toggle").addEventListener("click", toggleEditorSheet);

    document.querySelector(".global-search-toggle").addEventListener("click", toggleGlobalSearch);
    document.querySelector(".global-search-close").addEventListener("click", () => toggleGlobalSearch(false));
    document.querySelector(".global-search-clear").addEventListener("click", clearGlobalSearch);
    document.querySelector(".global-search-input").addEventListener("input", renderGlobalSearchResults);

    document.querySelectorAll("[data-edit-action]").forEach(control => {
      const action = control.dataset.editAction;
      if (action === "import") control.addEventListener("change", importJson);
      else control.addEventListener("click", () => runEditAction(action));
    });

    document.addEventListener("click", event => {
      if (!state.editMode) return;
      const target = event.target.closest("[data-edit-collection]");
      if (!target || target.closest(".editor-shell")) return;
      event.preventDefault();
      event.stopPropagation();
      openEditor(target.dataset.editCollection, target.dataset.editId);
    });

    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && !document.querySelector(".relationship-type-popover").hidden) {
        closeRelationshipTypeChooser();
        return;
      }
      if (event.key === "Escape" && !document.querySelector(".global-search-panel").hidden) {
        toggleGlobalSearch(false);
        return;
      }
      if (!state.editMode || !(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
    });

    window.addEventListener("pagehide", flushAutoSave);
    window.addEventListener("beforeunload", flushAutoSave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAutoSave();
    });
    window.addEventListener("resize", handleViewportChange);
  }

  function setupZoom() {
    zoom = d3.zoom()
      .scaleExtent(zoomScaleExtent())
      .filter(event => {
        if (event.touches?.length > 1) return true;
        if (state.editMode && event.target.closest?.(".editable-object")) return false;
        return !event.target.closest?.(".concept, .territory-hit, .movement, .question-node, .fellow, .threshold, .moth-centre");
      })
      .on("zoom", event => {
        state.zoomTransform = event.transform;
        if (root) {
          root.attr("transform", event.transform);
          applySemanticZoom(event.transform.k);
        }
      });
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("mousedown.track touchstart.track wheel.track", () => { state.userMoved = true; });
    svg.on("click", event => {
      if (!state.editMode && !event.target.closest?.(".concept, .territory-hit, .movement, .question-node, .fellow, .threshold, .moth-centre")) closeInspector();
    });
  }

  function isMobileLayout() {
    return mobileLayoutQuery.matches;
  }

  function zoomScaleExtent() {
    return isMobileLayout() ? [0.72, 7.5] : [0.65, 2.5];
  }

  function applySemanticZoom(scale = state.zoomTransform.k || 1) {
    if (!root) return;
    const level = !isMobileLayout() || scale >= 3.2 ? "detail" : scale >= 1.65 ? "middle" : "overview";
    root
      .classed("semantic-overview", level === "overview")
      .classed("semantic-middle", level === "middle")
      .classed("semantic-detail", level === "detail");
  }

  function handleViewportChange() {
    window.clearTimeout(handleViewportChange.timer);
    handleViewportChange.timer = window.setTimeout(() => {
      zoom.scaleExtent(zoomScaleExtent());
      document.querySelector(".inspector")?.classList.remove("is-expanded");
      document.querySelector(".editor-shell")?.classList.remove("is-expanded");
      applySemanticZoom();
      if (!state.userMoved) fitInitial();
    }, 120);
  }

  function renderAll(refreshEditor = true) {
    renderPublicCopy();
    drawMap();
    renderGlobalSearchResults();
    renderContentList();
    renderRelationshipManager();
    updateHistoryButtons();
    updateEditStatus();
    if (refreshEditor && state.editorRef) {
      const item = getItem(state.editorRef.collection, state.editorRef.id);
      if (item) renderItemEditor();
      else closeItemEditor();
    }
  }

  function renderPublicCopy() {
    document.title = data.copy.pageTitle || "";
    document.querySelector('meta[name="description"]').setAttribute("content", data.copy.metaDescription || "");
    document.querySelectorAll("[data-copy]").forEach(element => { element.textContent = data.copy[element.dataset.copy] || ""; });
    document.querySelector(".map-stage").setAttribute("aria-label", data.copy.mapAriaLabel || "");
    document.querySelector("#map-title").textContent = data.copy.mapTitle || "";
    document.querySelector("#map-description").textContent = data.copy.mapDescription || "";
    document.querySelector(".inspector-close").setAttribute("aria-label", data.copy.closeDetailLabel || "");
    document.querySelector(".zoom-controls").setAttribute("aria-label", data.copy.zoomControlsLabel || "");
    document.querySelector('[data-zoom="out"]').setAttribute("aria-label", data.copy.zoomOutLabel || "");
    document.querySelector('[data-zoom="reset"]').setAttribute("aria-label", "Return to territory overview");
    document.querySelector('[data-zoom="in"]').setAttribute("aria-label", data.copy.zoomInLabel || "");

    const toggle = document.querySelector(".edit-mode-toggle");
    toggle.textContent = state.editMode ? data.copy.viewModeLabel : data.copy.editModeLabel;
    toggle.setAttribute("aria-pressed", String(state.editMode));

    const nav = document.querySelector(".lens-nav");
    nav.setAttribute("aria-label", data.copy.lensNavigationLabel || "Map lenses");
    nav.innerHTML = data.lenses.map(lens => `<button type="button" class="lens-button${lens.key === state.lens ? " is-active" : ""}" data-lens="${escapeAttr(lens.key)}" data-edit-collection="lenses" data-edit-id="${escapeAttr(lens.id)}" aria-pressed="${lens.key === state.lens}">${escapeHtml(lens.label)}</button>`).join("");
    nav.querySelectorAll(".lens-button").forEach(button => button.addEventListener("click", event => {
      if (state.editMode) {
        event.preventDefault();
        event.stopPropagation();
        openEditor("lenses", button.dataset.editId);
      } else setLens(button.dataset.lens);
    }));

    const preview = document.querySelector(".preview-lens");
    preview.innerHTML = data.lenses.map(lens => `<option value="${escapeAttr(lens.key)}"${lens.key === state.lens ? " selected" : ""}>${escapeHtml(lens.label)}</option>`).join("");

    const territorySelect = document.querySelector(".territory-navigator select");
    const selectedTerritory = territorySelect.value;
    territorySelect.innerHTML = `<option value="">Territories…</option>${data.territories.map(territory => `<option value="${escapeAttr(territory.id)}">${escapeHtml(territory.label)}</option>`).join("")}`;
    if (data.territories.some(territory => territory.id === selectedTerritory)) territorySelect.value = selectedTerritory;
  }

  function selectTerritoryFromNavigator(event) {
    const territory = data.territories.find(item => item.id === event.target.value);
    if (!territory) return;
    if (state.editMode) {
      openEditor("territories", territory.id);
      return;
    }
    if (state.lens !== "field") setLens("field");
    selectPublicItem(territory, "territory");
    focusMapItem(territory, 2.15);
  }

  function toggleMobileEditToolbar() {
    const toolbar = document.querySelector(".edit-toolbar");
    const toggle = document.querySelector(".mobile-edit-toolbar-toggle");
    const open = !toolbar.classList.contains("is-mobile-open");
    toolbar.classList.toggle("is-mobile-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }

  function toggleInspectorSheet() {
    const panel = document.querySelector(".inspector");
    state.inspectorExpanded = !panel.classList.contains("is-expanded");
    panel.classList.toggle("is-expanded", state.inspectorExpanded);
    const toggle = panel.querySelector(".inspector-sheet-toggle");
    toggle.setAttribute("aria-expanded", String(state.inspectorExpanded));
    toggle.setAttribute("aria-label", state.inspectorExpanded ? "Collapse details" : "Expand details");
  }

  function toggleEditorSheet() {
    const expanded = !editorShell.classList.contains("is-expanded");
    editorShell.classList.toggle("is-expanded", expanded);
    const toggle = document.querySelector(".editor-sheet-toggle");
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Collapse" : "Expand";
    toggle.setAttribute("aria-label", expanded ? "Collapse field editor" : "Expand field editor");
  }

  function toggleGlobalSearch(force) {
    const panel = document.querySelector(".global-search-panel");
    const toggle = document.querySelector(".global-search-toggle");
    const open = typeof force === "boolean" ? force : panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      renderGlobalSearchResults();
      window.requestAnimationFrame(() => document.querySelector(".global-search-input").focus());
    }
  }

  function clearGlobalSearch() {
    const input = document.querySelector(".global-search-input");
    input.value = "";
    renderGlobalSearchResults();
    input.focus();
  }

  function renderGlobalSearchResults() {
    const container = document.querySelector(".global-search-results");
    if (!container) return;
    const query = document.querySelector(".global-search-input").value.trim().toLocaleLowerCase();
    if (!query) {
      container.innerHTML = '<p class="global-search-empty">Type to search the map.</p>';
      return;
    }
    const matches = globalSearchRecords()
      .filter(record => record.searchText.toLocaleLowerCase().includes(query))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    container.innerHTML = matches.length ? matches.map(record => `
      <button type="button" class="global-search-result" data-search-collection="${escapeAttr(record.collection)}" data-search-id="${escapeAttr(record.id)}">
        <span><strong>${escapeHtml(record.label)}</strong><em>${escapeHtml(record.kind)}</em></span>
        <small>${escapeHtml(searchMatchPreview(record.searchText, query))}</small>
      </button>`).join("") : '<p class="global-search-empty">No map content matches that search.</p>';
    container.querySelectorAll("[data-search-collection]").forEach(button => button.addEventListener("click", () => {
      selectGlobalSearchResult(button.dataset.searchCollection, button.dataset.searchId);
    }));
  }

  function globalSearchRecords() {
    const records = [];
    const groups = [
      ["centre", data.centre ? [data.centre] : []],
      ["territories", data.territories],
      ["concepts", data.concepts],
      ["thresholds", data.thresholds],
      ["movements", data.movements],
      ["questions", data.questions],
      ["fellows", data.fellows]
    ];
    groups.forEach(([collection, items]) => items.forEach(item => {
      const label = displayTitle(item) || item.id;
      records.push({ collection, id: item.id, item, label, kind: searchKind(collection), searchText: `${label} ${editorialSearchText(item)}`.replace(/\s+/g, " ").trim() });
    }));

    const byId = itemMap();
    const questionIds = new Set(data.questions.map(item => item.id));
    data.relationships.forEach(item => {
      if (questionIds.has(item.source) || questionIds.has(item.target)) return;
      const source = questionIds.has(item.source) ? null : byId.get(item.source);
      const target = questionIds.has(item.target) ? null : byId.get(item.target);
      const label = relationshipLabel(item, byId);
      const endpointText = [source ? displayTitle(source) : "", target ? displayTitle(target) : ""].filter(Boolean).join(" ");
      records.push({ collection: "relationships", id: item.id, item, label, kind: "Relationship", searchText: `${label} ${endpointText} ${editorialSearchText(item)}`.replace(/\s+/g, " ").trim() });
    });
    return records;
  }

  function editorialSearchText(item) {
    const excluded = new Set(["id", "x", "y", "x1", "y1", "x2", "y2", "weight", "priority", "radiusX", "radiusY", "rotation", "manualPosition", "question", "questions"]);
    const values = [];
    const collect = value => {
      if (typeof value === "string") values.push(richTextPlain(value));
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, nested]) => { if (!excluded.has(key)) collect(nested); });
    };
    Object.entries(item || {}).forEach(([key, value]) => { if (!excluded.has(key)) collect(value); });
    return values.join(" ");
  }

  function searchMatchPreview(text, query) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    const index = clean.toLocaleLowerCase().indexOf(query);
    if (index < 0) return clean.slice(0, 130);
    const start = Math.max(0, index - 45);
    const end = Math.min(clean.length, index + query.length + 72);
    return `${start ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
  }

  function searchKind(collection) {
    return ({ centre: "Centre", territories: "Territory", concepts: "Concept", thresholds: "Annotation", movements: "Movement", questions: "Question", fellows: "Fellow" })[collection] || humanize(collection);
  }

  function relationshipLabel(item, byId = itemMap()) {
    const source = displayTitle(byId.get(item.source)) || item.source;
    const target = displayTitle(byId.get(item.target)) || item.target;
    return `${source} ${data.copy.sourceArrow || "→"} ${target}`;
  }

  function selectGlobalSearchResult(collection, id) {
    const byId = itemMap();
    let item = collection === "relationships" ? data.relationships.find(entry => entry.id === id) : getItem(collection, id);
    if (!item) return;
    const lens = collection === "movements" ? "movements" : collection === "questions" ? "questions" : collection === "fellows" ? "fellows" : "field";
    setLens(lens);

    let publicItem = item;
    let kind = searchKind(collection).toLocaleLowerCase();
    if (collection === "relationships") {
      const source = positionedItem(byId.get(item.source));
      const target = positionedItem(byId.get(item.target));
      publicItem = {
        ...item,
        label: relationshipLabel(item, byId),
        related: [item.source, item.target],
        x: source && target ? (Number(source.x) + Number(target.x)) / 2 : undefined,
        y: source && target ? (Number(source.y) + Number(target.y)) / 2 : undefined
      };
      kind = "relationship";
    }

    focusMapItem(publicItem);
    highlightSearchResult(collection, item);
    if (state.editMode) openEditor(collection, id);
    else selectPublicItem(publicItem, kind);
    toggleGlobalSearch(false);
  }

  function focusMapItem(item, requestedScale) {
    const positioned = positionedItem(item);
    if (!hasPosition(positioned)) return;
    const scale = requestedScale || (isMobileLayout() ? 3.8 : 1.35);
    const x = data.canvas.width / 2 - Number(positioned.x) * scale;
    const targetY = isMobileLayout() ? data.canvas.height * 0.38 : data.canvas.height / 2;
    const y = targetY - Number(positioned.y) * scale;
    state.userMoved = true;
    svg.transition().duration(520).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
  }

  function highlightSearchResult(collection, item) {
    clearMapHighlight();
    if (collection === "relationships") {
      const ids = new Set([item.source, item.target]);
      root.selectAll(".concept, .movement, .fellow, .threshold, .moth-centre").classed("is-related", d => ids.has(d.id)).classed("is-unrelated", d => !ids.has(d.id));
      root.selectAll(".field-thread").classed("is-related", d => d.id === item.id).classed("is-unrelated", d => d.id !== item.id).classed("is-search-focus", d => d.id === item.id);
      root.selectAll(".territory").classed("is-active", d => ids.has(d.id));
      return;
    }
    if (collection === "territories") hoverTerritory(item.id);
    else highlightRelated(item);
    const selectors = { centre: ".moth-centre", territories: ".territory", concepts: ".concept", thresholds: ".threshold", movements: ".movement", fellows: ".fellow" };
    root.selectAll(selectors[collection] || ".concept").classed("is-search-focus", d => d.id === item.id);
  }

  function itemMap() {
    const map = new Map();
    if (data.centre) map.set(data.centre.id, data.centre);
    ["territories", "concepts", "thresholds", "movements", "questions", "fellows"].forEach(collection => data[collection].forEach(item => map.set(item.id, item)));
    return map;
  }

  function fellowConceptRelationships(fellowId) {
    const conceptById = new Map(data.concepts.map(concept => [concept.id, concept]));
    return data.relationships.flatMap(relationship => {
      const conceptId = relationship.source === fellowId ? relationship.target : relationship.target === fellowId ? relationship.source : null;
      const concept = conceptById.get(conceptId);
      return concept ? [{ relationship, concept }] : [];
    });
  }

  function directionalRelationshipType(type) {
    return new Set(["challenge", "translation", "lineage", "practice", "question", "enables"]).has(type);
  }

  function selectRelationshipPublic(relationship) {
    const byId = itemMap();
    const source = positionedItem(byId.get(relationship.source));
    const target = positionedItem(byId.get(relationship.target));
    selectPublicItem({
      ...relationship,
      label: relationshipLabel(relationship, byId),
      related: [relationship.source, relationship.target],
      x: source && target ? (Number(source.x) + Number(target.x)) / 2 : undefined,
      y: source && target ? (Number(source.y) + Number(target.y)) / 2 : undefined
    }, "relationship");
  }

  function centralMapItem(target = data) {
    return target.centre || null;
  }

  function drawMap() {
    const W = data.canvas.width;
    const H = data.canvas.height;
    const byId = itemMap();
    const fellowIds = new Set(data.fellows.map(item => item.id));
    const conceptIds = new Set(data.concepts.map(item => item.id));
    const focusedFellow = state.lens === "fellows" ? data.fellows.find(item => item.id === state.fellowFocusId) : null;
    const focusedFellowRelationships = focusedFellow ? fellowConceptRelationships(focusedFellow.id) : [];
    const linkedConceptIds = new Set(focusedFellowRelationships.map(entry => entry.concept.id));
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
    svg.selectAll("defs, g.map-root").remove();

    const defs = svg.insert("defs", ":first-child");
    defs.append("marker")
      .attr("id", "movement-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-4L9,0L0,4Z").attr("class", "movement-arrow");
    defs.append("marker")
      .attr("id", "relationship-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 12)
      .attr("markerWidth", 4)
      .attr("markerHeight", 4)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-3.5L8,0L0,3.5Z").attr("class", "relationship-arrow");

    root = svg.append("g").attr("class", "map-root").attr("transform", state.zoomTransform);
    const territoryLayer = root.append("g").attr("class", `layer territory-layer${state.lens !== "field" ? " lens-soft" : ""}`);
    const threadLayer = root.append("g").attr("class", `layer thread-layer${state.lens !== "field" ? " lens-hidden" : ""}`);
    const fellowRelationshipLayer = root.append("g").attr("class", `layer fellow-relationship-layer${focusedFellow ? "" : " lens-hidden"}`);
    const connectionDraftLayer = root.append("g").attr("class", "layer connection-draft-layer");
    const thresholdLayer = root.append("g").attr("class", `layer threshold-layer${state.lens !== "field" ? " lens-hidden" : ""}`);
    const conceptLayer = root.append("g").attr("class", `layer concept-layer${state.lens !== "field" && !focusedFellow ? " lens-soft" : ""}`);
    const centreLayer = root.append("g").attr("class", `layer centre-layer${state.lens !== "field" ? " lens-soft" : ""}`);
    const movementLayer = root.append("g").attr("class", `layer movement-layer${state.lens !== "movements" ? " lens-hidden" : ""}`);
    const questionLayer = root.append("g").attr("class", `layer question-layer${state.lens !== "questions" ? " lens-hidden" : ""}`);
    const fellowLayer = root.append("g").attr("class", `layer fellow-layer${state.lens !== "fellows" ? " lens-hidden" : ""}`);

    const palette = {
      moss: css("--moss"), dusk: css("--dusk"), mineral: css("--mineral"), clay: css("--clay"), earth: css("--earth"),
      ochre: css("--ochre"), lichen: css("--lichen"), stone: css("--stone")
    };

    const territories = territoryLayer.selectAll("g.territory")
      .data(data.territories, d => d.id)
      .join("g")
      .attr("class", d => `territory editable-object${state.editMode ? " is-editable" : ""}${state.editMoveReadyId === d.id ? " is-edit-move-ready" : ""}`)
      .attr("data-id", d => d.id)
      .attr("data-collection", "territories")
      .attr("transform", d => territoryTransform(d));

    territories.append("path").attr("class", "territory-haze").attr("d", d => territoryPath(d, 1)).attr("fill", d => palette[d.tone] || palette.earth);
    territories.append("path").attr("class", "territory-fill").attr("d", d => territoryPath(d, 2)).attr("fill", d => palette[d.tone] || palette.earth);
    territories.append("path").attr("class", "territory-edge").attr("d", d => territoryPath(d, 3)).attr("stroke", d => palette[d.tone] || palette.earth);
    territories.append("path").attr("class", "territory-hit").attr("d", d => territoryPath(d, 2))
      .on("mouseenter", (_, d) => { if (!state.editMode) hoverTerritory(d.id); })
      .on("mouseleave", () => { if (!state.editMode) hoverTerritory(null); })
      .on("click", (event, d) => handleObjectClick(event, "territories", d, "territory"));

    const territoryLabels = territories.append("g")
      .attr("transform", d => `rotate(${-1 * (d.rotation || 0)}) translate(${-d.radiusX * 0.56},${-d.radiusY * 0.48})`);
    territoryLabels.append("text").attr("class", "territory-name").text(d => d.rootLabel ? "" : d.label);
    const rooted = territoryLabels.filter(d => d.rootLabel);
    rooted.append("text").attr("class", "territory-root").attr("y", 30).text(d => `${d.rootLabel}  ${data.copy.sourceArrow || ""}  ${d.label}`);
    rooted.append("text").attr("class", "territory-root-note").attr("y", 49).text(d => d.rootNote || d.attribution || "");

    const relationData = data.relationships.map(relationship => ({
      ...relationship,
      sourceItem: positionedItem(byId.get(relationship.source)),
      targetItem: positionedItem(byId.get(relationship.target))
    })).filter(relationship => hasPosition(relationship.sourceItem) && hasPosition(relationship.targetItem));

    const fieldRelationData = relationData.filter(relationship => !fellowIds.has(relationship.source) && !fellowIds.has(relationship.target));
    const fellowRelationData = relationData.filter(relationship => focusedFellowRelationships.some(entry => entry.relationship.id === relationship.id));

    const threads = threadLayer.selectAll("path.field-thread")
      .data(fieldRelationData, d => d.id)
      .join("path")
      .attr("class", "field-thread")
      .attr("data-source", d => d.source)
      .attr("data-target", d => d.target)
      .attr("data-type", d => d.type)
      .attr("d", d => curvedPath(d.sourceItem, d.targetItem, 0.07));

    const fellowThreads = fellowRelationshipLayer.selectAll("path.fellow-relationship")
      .data(fellowRelationData, d => d.id)
      .join("path")
      .attr("class", d => `fellow-relationship${state.linkedConceptFocusId && (d.source === state.linkedConceptFocusId || d.target === state.linkedConceptFocusId) ? " is-focused" : ""}`)
      .attr("data-source", d => d.source)
      .attr("data-target", d => d.target)
      .attr("data-type", d => d.type)
      .attr("marker-end", d => directionalRelationshipType(d.type) ? "url(#relationship-arrow)" : null)
      .attr("d", d => curvedPath(d.sourceItem, d.targetItem, 0.04))
      .on("click", (event, relationship) => {
        event.stopPropagation();
        if (state.editMode) openEditor("relationships", relationship.id);
        else selectRelationshipPublic(relationship);
      });
    fellowThreads.append("title").text(d => `${displayTitle(byId.get(d.source)) || d.source} → ${d.type} → ${displayTitle(byId.get(d.target)) || d.target}`);

    const thresholds = thresholdLayer.selectAll("g.threshold")
      .data(data.thresholds, d => d.id)
      .join("g")
      .attr("class", d => `threshold editable-object${state.editMode ? " is-editable" : ""}${state.editMoveReadyId === d.id ? " is-edit-move-ready" : ""}`)
      .attr("data-id", d => d.id)
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .on("click", (event, d) => handleObjectClick(event, "thresholds", d, "annotation"));
    thresholds.append("circle").attr("class", "map-touch-target").attr("r", 30);
    thresholds.append("line").attr("class", "threshold-mark").attr("x1", -13).attr("x2", -4);
    thresholds.append("text").attr("class", "threshold-label").attr("x", 1).attr("dy", "0.32em").text(d => d.label);

    const concepts = conceptLayer.selectAll("g.concept")
      .data(data.concepts, d => d.id)
      .join("g")
      .attr("class", d => `concept editable-object${d.priority >= 3 ? " is-detail" : ""}${state.editMode ? " is-editable" : ""}${state.editMoveReadyId === d.id ? " is-edit-move-ready" : ""}${focusedFellow ? (linkedConceptIds.has(d.id) ? " is-fellow-linked" : " is-fellow-unrelated") : ""}${state.linkedConceptFocusId === d.id ? " is-fellow-focus" : ""}`)
      .attr("data-id", d => d.id)
      .attr("data-type", d => d.type)
      .attr("data-priority", d => Math.max(1, Math.min(3, Number(d.priority) || 1)))
      .attr("data-weight", d => Number(d.weight) || 1)
      .attr("data-overview", d => String((Number(d.priority) || 1) === 1 && (Number(d.weight) || 1) >= 1.08))
      .style("--weight", d => d.weight || 1)
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .on("mouseenter", (_, d) => { if (!state.editMode) highlightRelated(d); })
      .on("mouseleave", () => { if (!state.editMode && !state.selected) clearMapHighlight(); })
      .on("click", (event, d) => handleObjectClick(event, "concepts", d, d.type || "concept"));
    concepts.append("circle").attr("class", "map-touch-target").attr("r", 30);
    concepts.append("line").attr("class", "concept-stem").attr("x1", -8).attr("x2", -2);
    concepts.append("circle").attr("class", "concept-dot").attr("r", d => 1.25 + (d.weight || 1) * 0.55);
    concepts.append("text").attr("class", "concept-label").attr("x", 7).attr("dy", "0.34em").text(d => d.label);

    const centralItem = centralMapItem();
    const centralCollection = "centre";
    let centre = centreLayer.selectAll("g.moth-centre");
    if (centralItem) {
      centre = centreLayer.append("g")
        .datum(centralItem)
        .attr("class", `moth-centre editable-object${state.editMode ? " is-editable" : ""}${state.editMoveReadyId === centralItem.id ? " is-edit-move-ready" : ""}`)
        .attr("data-id", centralItem.id)
        .attr("data-collection", centralCollection)
        .style("--weight", centralItem.weight || 1)
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .on("click", (event, d) => handleObjectClick(event, centralCollection, d, "centre"));
      centre.append("ellipse").attr("class", "moth-halo").attr("rx", 126 * (centralItem.weight || 1) / 1.35).attr("ry", 56 * (centralItem.weight || 1) / 1.35).attr("transform", "rotate(-8)");
      centre.append("text").attr("class", "moth-mark").attr("text-anchor", "middle").attr("y", -5).text(d => d.label);
      if (centralItem.subtitle) centre.append("text").attr("class", "moth-subtitle").attr("text-anchor", "middle").attr("y", 18).text(centralItem.subtitle);
      const propositionY = centralItem.subtitle ? 40 : 24;
      const centralProposition = centralItem.proposition || centralItem.question || "";
      wrapSvgText(centre.append("text").attr("class", "moth-proposition").attr("text-anchor", "middle").attr("y", propositionY), centralProposition, 410, 0, 18, "middle");
    }

    const movements = movementLayer.selectAll("g.movement")
      .data(data.movements, d => d.id)
      .join("g")
      .attr("class", d => `movement editable-object${state.editMode ? " is-editable" : ""}${state.editMoveReadyId === d.id ? " is-edit-move-ready" : ""}`)
      .attr("data-id", d => d.id)
      .attr("data-weight", d => Number(d.weight) || 1)
      .style("--weight", d => d.weight || 1)
      .on("mouseenter", (_, d) => { if (!state.editMode) highlightRelated(d); })
      .on("mouseleave", () => { if (!state.editMode && !state.selected) clearMapHighlight(); })
      .on("click", (event, d) => {
        handleObjectClick(event, "movements", d, "movement");
        if (!state.editMode) animateMovement(d, event.currentTarget);
      });
    movements.append("path").attr("class", "movement-touch-target")
      .attr("d", d => curvedPath({ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }, 0.1));
    movements.append("path").attr("class", "movement-path").attr("marker-end", "url(#movement-arrow)")
      .attr("d", d => curvedPath({ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }, 0.1));
    movements.append("text").attr("class", "movement-from").attr("x", d => d.x1).attr("y", d => d.y1 - 10).text(d => d.from);
    movements.append("text").attr("class", "movement-to").attr("text-anchor", "end").attr("x", d => d.x2).attr("y", d => d.y2 - 10).text(d => d.to);

    const questions = questionLayer.selectAll("g.question-node")
      .data(data.questions, d => d.id)
      .join("g")
      .attr("class", d => `question-node editable-object${state.editMode ? " is-editable" : ""}${state.editMoveReadyId === d.id ? " is-edit-move-ready" : ""}`)
      .attr("data-id", d => d.id)
      .attr("data-weight", d => Number(d.weight) || 1)
      .style("--weight", d => d.weight || 1)
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .on("mouseenter", (_, d) => { if (!state.editMode) highlightRelated(d); })
      .on("mouseleave", () => { if (!state.editMode && !state.selected) clearMapHighlight(); })
      .on("click", (event, d) => handleObjectClick(event, "questions", d, "question"));
    questions.append("circle").attr("class", "map-touch-target").attr("r", 30);
    questions.append("circle").attr("class", "question-mark").attr("r", 9);
    questions.append("text").attr("class", "question-text").attr("x", 17).attr("dy", "0.33em").each(function (d) {
      wrapSvgText(d3.select(this), d.text || d.label || "", d.weight > 1 ? 310 : 270, 17, 18, "start");
    });

    const fellows = fellowLayer.selectAll("g.fellow")
      .data(data.fellows, d => d.id)
      .join("g")
      .attr("class", d => `fellow editable-object${state.editMode ? " is-editable" : ""}${state.editMoveReadyId === d.id ? " is-edit-move-ready" : ""}${focusedFellow ? (d.id === focusedFellow.id ? " is-fellow-focus" : " is-fellow-unrelated") : ""}`)
      .attr("data-id", d => d.id)
      .attr("data-weight", d => Number(d.weight) || 1)
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .on("mouseenter", (_, d) => { if (!state.editMode) highlightRelated(d); })
      .on("mouseleave", () => { if (!state.editMode && !state.selected) clearMapHighlight(); })
      .on("click", (event, d) => handleObjectClick(event, "fellows", d, "fellow"));
    fellows.each(function (d) {
      const group = d3.select(this);
      group.append("circle").attr("class", "map-touch-target").attr("r", 30);
      const angles = (d.territories || []).map((_, index) => (Math.PI * 2 * index) / Math.max(3, d.territories.length) - Math.PI / 2);
      group.selectAll("line").data(angles).join("line").attr("class", "fellow-ray").attr("x2", angle => Math.cos(angle) * 30).attr("y2", angle => Math.sin(angle) * 30);
      group.append("circle").attr("class", "fellow-core").attr("r", 8 * (d.weight || 1));
      group.append("text").attr("class", "fellow-label").attr("x", 15).attr("dy", "0.33em").text(d.name);
    });

    if (state.editMode) {
      const refreshRelationshipPaths = () => {
        threads.attr("d", d => curvedPath(d.sourceItem, d.targetItem, 0.07));
        fellowThreads.attr("d", d => curvedPath(d.sourceItem, d.targetItem, 0.04));
      };
      attachDrag(territories, "territories", d => territoryTransform(d), refreshRelationshipPaths);
      attachDrag(concepts, "concepts", d => `translate(${d.x},${d.y})`, refreshRelationshipPaths);
      attachDrag(thresholds, "thresholds", d => `translate(${d.x},${d.y})`);
      attachDrag(questions, "questions", d => `translate(${d.x},${d.y})`);
      attachDrag(fellows, "fellows", d => `translate(${d.x},${d.y})`, refreshRelationshipPaths);
      attachConnectionHandles(concepts, "concepts", d => 22 + Math.min(190, String(d.label || "").length * 7));
      attachConnectionHandles(fellows, "fellows", d => 25 + Math.min(190, String(d.name || "").length * 8));
      if (centralItem) attachDrag(centre, centralCollection, d => `translate(${d.x},${d.y})`, refreshRelationshipPaths);
    }

    if (state.lens === "field") centreLayer.raise();
    if (state.lens === "movements") movementLayer.raise();
    if (state.lens === "questions") questionLayer.raise();
    if (state.lens === "fellows") fellowLayer.raise();
    applySemanticZoom();
  }

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function seededRandom(seed) {
    let value = seed + 0x6d2b79f5;
    return function () {
      value += 0x6d2b79f5;
      let result = Math.imul(value ^ (value >>> 15), 1 | value);
      result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function territoryPath(item, variant) {
    const random = seededRandom(item.id.length * 71 + variant * 991);
    const radiusX = Number(item.radiusX) || 250;
    const radiusY = Number(item.radiusY) || 200;
    const points = d3.range(18).map(index => {
      const angle = (index / 18) * Math.PI * 2;
      const wobble = 0.86 + random() * 0.24 + Math.sin(angle * 3 + variant) * 0.035;
      return [Math.cos(angle) * radiusX * wobble, Math.sin(angle) * radiusY * wobble];
    });
    return d3.line().curve(d3.curveCatmullRomClosed.alpha(0.72))(points);
  }

  function territoryTransform(item) {
    return `translate(${item.x},${item.y}) rotate(${item.rotation || 0})`;
  }

  function curvedPath(source, target, bend = 0.18) {
    const middleX = (source.x + target.x) / 2;
    const middleY = (source.y + target.y) / 2;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    return `M${source.x},${source.y} Q${middleX - dy * bend},${middleY + dx * bend} ${target.x},${target.y}`;
  }

  function hasPosition(item) {
    return item && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y));
  }

  function positionedItem(item) {
    if (!item) return null;
    if (hasPosition(item)) return item;
    if ([item.x1, item.y1, item.x2, item.y2].every(value => Number.isFinite(Number(value)))) {
      return { ...item, x: (Number(item.x1) + Number(item.x2)) / 2, y: (Number(item.y1) + Number(item.y2)) / 2 };
    }
    return item;
  }

  function wrapSvgText(text, value, width, x, lineHeight, anchor) {
    const words = String(value || "").split(/\s+/).filter(Boolean);
    let line = [];
    let lines = 0;
    let tspan = text.text(null).append("tspan").attr("x", x).attr("dy", "0em").attr("text-anchor", anchor);
    words.forEach(word => {
      line.push(word);
      tspan.text(line.join(" "));
      if (tspan.node().getComputedTextLength() > width && line.length > 1) {
        line.pop();
        tspan.text(line.join(" "));
        line = [word];
        tspan = text.append("tspan").attr("x", x).attr("dy", lineHeight).attr("text-anchor", anchor).text(word);
        lines += 1;
      }
    });
    if (lines) text.attr("transform", `translate(0,${-lines * lineHeight * 0.35})`);
  }

  function attachDrag(selection, collection, transform, onMove) {
    selection.call(d3.drag()
      .filter((event, item) => !isMobileLayout() || state.editMoveReadyId === item.id)
      .subject((_, item) => ({ x: Number(item.x) || 0, y: Number(item.y) || 0 }))
      .on("start", event => {
        event.sourceEvent.stopPropagation();
        state.dragBefore = snapshot();
        d3.select(event.sourceEvent.currentTarget).classed("is-dragging", true);
      })
      .on("drag", function (event, item) {
        item.x = Math.round(event.x);
        item.y = Math.round(event.y);
        item.manualPosition = true;
        d3.select(this).attr("transform", transform(item));
        if (onMove) onMove();
        updateOpenCoordinateFields(item);
        markUnsaved();
      })
      .on("end", function () {
        d3.select(this).classed("is-dragging", false);
        pushHistory();
        drawMap();
        renderContentList();
      }));
  }

  function attachConnectionHandles(selection, collection, offsetX) {
    const handles = selection.append("g")
      .attr("class", "relationship-handle")
      .attr("transform", item => `translate(${offsetX(item)},0)`)
      .attr("aria-label", item => `Create relationship from ${displayTitle(item)}`);
    handles.append("circle").attr("class", "relationship-handle-hit").attr("r", 10);
    handles.append("circle").attr("class", "relationship-handle-mark").attr("r", 4.2);
    handles.on("mousedown.connect touchstart.connect pointerdown.connect", event => event.stopPropagation());
    handles.call(d3.drag()
      .container(() => root.node())
      .on("start", (event, item) => {
        event.sourceEvent.stopPropagation();
        closeRelationshipTypeChooser();
        startConnectionDrag(collection, item);
      })
      .on("drag", event => updateConnectionDrag(event.sourceEvent))
      .on("end", event => finishConnectionDrag(event.sourceEvent)));
  }

  function startConnectionDrag(collection, item) {
    const position = positionedItem(item);
    if (!hasPosition(position)) return;
    const targets = connectionTargets(collection, item.id);
    state.connectionDraft = { sourceCollection: collection, source: item, sourcePosition: position, targets, hovered: null };
    root.classed("is-connecting", true)
      .classed("is-connecting-from-concept", collection === "concepts")
      .classed("is-connecting-from-fellow", collection === "fellows");
    root.selectAll(".concept, .fellow").classed("is-connection-target", target => targets.some(candidate => candidate.item.id === target.id));
    root.select(".connection-draft-layer").append("path")
      .attr("class", "relationship-draft")
      .attr("d", `M${position.x},${position.y} L${position.x},${position.y}`);
  }

  function connectionTargets(sourceCollection, sourceId) {
    if (sourceCollection === "fellows") return data.concepts.map(item => ({ collection: "concepts", item }));
    if (sourceCollection === "concepts") {
      return [
        ...data.concepts.filter(item => item.id !== sourceId).map(item => ({ collection: "concepts", item })),
        ...data.fellows.map(item => ({ collection: "fellows", item }))
      ];
    }
    return [];
  }

  function updateConnectionDrag(sourceEvent) {
    const draft = state.connectionDraft;
    if (!draft || !sourceEvent) return;
    const [x, y] = d3.pointer(sourceEvent, root.node());
    const hitRadius = 34 / Math.max(0.65, state.zoomTransform.k || 1);
    let hovered = null;
    let nearestDistance = Infinity;
    draft.targets.forEach(candidate => {
      const position = positionedItem(candidate.item);
      if (!hasPosition(position)) return;
      const distance = Math.hypot(Number(position.x) - x, Number(position.y) - y);
      const node = root.selectAll(candidate.collection === "concepts" ? ".concept" : ".fellow").filter(item => item.id === candidate.item.id).node();
      const bounds = node?.getBBox();
      const insideLabel = bounds && x >= Number(position.x) + bounds.x - 10 && x <= Number(position.x) + bounds.x + bounds.width + 10
        && y >= Number(position.y) + bounds.y - 10 && y <= Number(position.y) + bounds.y + bounds.height + 10;
      if ((distance <= hitRadius || insideLabel) && distance < nearestDistance) {
        hovered = candidate;
        nearestDistance = distance;
      }
    });
    draft.hovered = hovered;
    root.selectAll(".concept, .fellow").classed("is-connection-hover", target => hovered?.item.id === target.id);
    const end = hovered ? positionedItem(hovered.item) : { x, y };
    root.select(".relationship-draft").attr("d", `M${draft.sourcePosition.x},${draft.sourcePosition.y} L${end.x},${end.y}`);
  }

  function finishConnectionDrag(sourceEvent) {
    const draft = state.connectionDraft;
    if (!draft) return;
    const hovered = draft.hovered;
    const clientX = Number(sourceEvent?.clientX) || window.innerWidth / 2;
    const clientY = Number(sourceEvent?.clientY) || window.innerHeight / 2;
    clearConnectionDrag();
    if (hovered) openRelationshipTypeChooser({
      source: draft.source.id,
      sourceCollection: draft.sourceCollection,
      target: hovered.item.id,
      targetCollection: hovered.collection
    }, clientX, clientY);
  }

  function clearConnectionDrag() {
    state.connectionDraft = null;
    if (!root) return;
    root.classed("is-connecting is-connecting-from-concept is-connecting-from-fellow", false);
    root.selectAll(".is-connection-target, .is-connection-hover").classed("is-connection-target is-connection-hover", false);
    root.selectAll(".relationship-draft").remove();
  }

  function openRelationshipTypeChooser(connection, clientX, clientY) {
    const byId = itemMap();
    const source = byId.get(connection.source);
    const target = byId.get(connection.target);
    if (!source || !target || source.id === target.id) return;
    state.pendingConnection = connection;
    const popover = document.querySelector(".relationship-type-popover");
    const select = popover.querySelector("select[name='type']");
    select.innerHTML = data.relationshipTypes.map(type => `<option value="${escapeAttr(type)}"${type === "resonance" ? " selected" : ""}>${escapeHtml(type)}</option>`).join("");
    popover.querySelector(".relationship-type-endpoints").textContent = `${displayTitle(source)} → ${displayTitle(target)}`;
    popover.hidden = false;
    const stageRect = document.querySelector(".map-stage").getBoundingClientRect();
    const width = 250;
    const left = Math.max(12, Math.min(stageRect.width - width - 12, clientX - stageRect.left + 10));
    const top = Math.max(12, Math.min(stageRect.height - 180, clientY - stageRect.top + 10));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    window.requestAnimationFrame(() => select.focus());
  }

  function closeRelationshipTypeChooser() {
    state.pendingConnection = null;
    const popover = document.querySelector(".relationship-type-popover");
    if (popover) popover.hidden = true;
    clearConnectionDrag();
  }

  function savePendingRelationship(event) {
    event.preventDefault();
    const pending = state.pendingConnection;
    if (!pending) return;
    const type = String(new FormData(event.currentTarget).get("type") || "").trim();
    if (!data.relationshipTypes.includes(type)) {
      setStatus("Choose a supported relationship type.", true);
      return;
    }
    const duplicate = data.relationships.some(relationship => relationship.source === pending.source && relationship.target === pending.target && relationship.type === type);
    if (duplicate) {
      setStatus("That relationship already exists.", true);
      return;
    }
    data.relationships.push({
      id: uniqueId("relationship", data.relationships, data.relationships.length + 1),
      source: pending.source,
      target: pending.target,
      type,
      description: "",
      references: "",
      attribution: "",
      sourceText: ""
    });
    const fellowId = pending.sourceCollection === "fellows" ? pending.source : pending.targetCollection === "fellows" ? pending.target : null;
    if (fellowId && state.lens === "fellows") state.fellowFocusId = fellowId;
    closeRelationshipTypeChooser();
    pushHistory();
    renderAll(false);
    setStatus("Relationship added.");
  }

  function updateOpenCoordinateFields(item) {
    if (!state.editorRef || state.editorRef.id !== item.id) return;
    ["x", "y"].forEach(key => {
      const input = itemEditor.querySelector(`[name="${key}"]`);
      if (input) input.value = item[key];
    });
  }

  function handleObjectClick(event, collection, item, kind) {
    event.stopPropagation();
    if (state.editMode) {
      openEditor(collection, item.id);
      if (isMobileLayout() && state.editMoveReadyId !== item.id) {
        state.editMoveReadyId = item.id;
        drawMap();
      }
    }
    else selectPublicItem(item, kind);
  }

  function selectPublicItem(item, kind) {
    const isFellow = data.fellows.some(fellow => fellow.id === item.id);
    const isConcept = data.concepts.some(concept => concept.id === item.id);
    if (state.lens === "fellows" && isFellow) {
      state.fellowFocusId = item.id;
      state.linkedConceptFocusId = null;
      drawMap();
    } else if (state.lens === "fellows" && state.fellowFocusId && isConcept) {
      state.linkedConceptFocusId = item.id;
      drawMap();
    }
    state.selected = item;
    const title = displayTitle(item);
    const summaryValues = [item.shortDescription].filter(Boolean);
    const longValues = [item.description, item.longDescription, kind === "fellow" ? item.notes : ""]
      .filter(value => value && !summaryValues.includes(value));
    const question = item.question || (kind === "question" ? item.text : "") || "";
    const relatedIds = item.related || item.relatedConcepts || [];
    const byId = itemMap();
    const related = relatedIds.map(id => byId.get(id)).filter(Boolean).map(displayTitle).slice(0, 8);
    if (isFellow) {
      (item.offers || []).forEach(value => related.push(`Offers: ${value}`));
      (item.needs || []).forEach(value => related.push(`Seeking: ${value}`));
    }
    document.querySelector(".inspector-kind").textContent = humanize(kind);
    document.querySelector(".inspector-title").textContent = title;
    const subtitleElement = document.querySelector(".inspector-subtitle");
    subtitleElement.textContent = isFellow ? (item.subtitle || "") : kind === "relationship" ? humanize(item.type) : "";
    subtitleElement.hidden = !subtitleElement.textContent;
    setRichContent(document.querySelector(".inspector-description"), summaryValues);
    setRichContent(document.querySelector(".inspector-long-description"), longValues);
    const questionElement = document.querySelector(".inspector-question");
    setRichContent(questionElement, question ? [question] : []);
    const referencesSection = document.querySelector(".inspector-references");
    setRichContent(document.querySelector(".inspector-references-content"), item.references ? [item.references] : []);
    referencesSection.hidden = !item.references;
    const relatedElement = document.querySelector(".inspector-related");
    relatedElement.textContent = related.length ? `${data.copy.relationPrefix} · ${related.join(" · ")}` : "";
    relatedElement.hidden = !related.length;
    renderLinkedConcepts(isFellow ? item : null);
    const returnButton = document.querySelector(".inspector-return-fellow");
    const focusedFellow = state.fellowFocusId ? data.fellows.find(fellow => fellow.id === state.fellowFocusId) : null;
    returnButton.hidden = !focusedFellow || isFellow;
    returnButton.textContent = focusedFellow && !isFellow ? `← Back to ${focusedFellow.name}` : "";
    const panel = document.querySelector(".inspector");
    state.inspectorExpanded = false;
    panel.classList.remove("is-expanded");
    const sheetToggle = panel.querySelector(".inspector-sheet-toggle");
    sheetToggle.setAttribute("aria-expanded", "false");
    sheetToggle.setAttribute("aria-label", "Expand details");
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    if (isFellow) highlightRelated(item);
  }

  function renderLinkedConcepts(fellow) {
    const section = document.querySelector(".inspector-linked-concepts");
    const list = document.querySelector(".inspector-linked-concepts-list");
    if (!fellow) {
      section.hidden = true;
      list.innerHTML = "";
      return;
    }
    const grouped = new Map();
    fellowConceptRelationships(fellow.id).forEach(({ relationship, concept }) => {
      if (!grouped.has(concept.id)) grouped.set(concept.id, { concept, types: [] });
      grouped.get(concept.id).types.push(relationship.type);
    });
    const entries = [...grouped.values()].sort((a, b) => a.concept.label.localeCompare(b.concept.label, undefined, { sensitivity: "base" }));
    list.innerHTML = entries.map(({ concept, types }) => `
      <button type="button" data-linked-concept="${escapeAttr(concept.id)}">
        <span>${escapeHtml(concept.label)}</span>
        <small>${escapeHtml([...new Set(types)].join(" · "))}</small>
      </button>`).join("");
    list.querySelectorAll("[data-linked-concept]").forEach(button => button.addEventListener("click", () => {
      const concept = data.concepts.find(item => item.id === button.dataset.linkedConcept);
      if (!concept) return;
      selectPublicItem(concept, concept.type || "concept");
      focusMapItem(concept);
    }));
    section.hidden = !entries.length;
  }

  function returnToFocusedFellow() {
    const fellow = data.fellows.find(item => item.id === state.fellowFocusId);
    if (!fellow) return;
    selectPublicItem(fellow, "fellow");
    focusMapItem(fellow);
  }

  function setRichContent(element, values) {
    const content = values.filter(Boolean).map(value => richTextHtml(value)).filter(Boolean);
    element.innerHTML = content.join("");
    element.hidden = !content.length;
  }

  function closeInspector(options = {}) {
    const hadFellowFocus = Boolean(state.fellowFocusId);
    state.selected = null;
    state.fellowFocusId = null;
    state.linkedConceptFocusId = null;
    const panel = document.querySelector(".inspector");
    state.inspectorExpanded = false;
    panel.classList.remove("is-open", "is-expanded");
    const sheetToggle = panel.querySelector(".inspector-sheet-toggle");
    sheetToggle.setAttribute("aria-expanded", "false");
    sheetToggle.setAttribute("aria-label", "Expand details");
    panel.setAttribute("aria-hidden", "true");
    clearMapHighlight();
    if (hadFellowFocus && state.lens === "fellows" && options.redraw !== false) drawMap();
  }

  function hoverTerritory(id) {
    root.selectAll(".territory").classed("is-active", d => d.id === id).classed("is-unrelated", d => Boolean(id) && d.id !== id);
    root.selectAll(".concept").classed("is-related", d => Boolean(id) && (d.territories || []).includes(id)).classed("is-unrelated", d => Boolean(id) && !(d.territories || []).includes(id));
    root.select(".concept-layer").classed("show-detail", Boolean(id));
  }

  function highlightRelated(item) {
    const ids = new Set([
      item.id,
      ...(item.related || []),
      ...(item.relatedConcepts || []),
      ...(item.waysOfKnowing || []),
      ...(item.waysOfActing || []),
      ...(item.questions || []),
      ...(item.movements || [])
    ]);
    data.relationships.forEach(relationship => {
      if (relationship.source === item.id) ids.add(relationship.target);
      if (relationship.target === item.id) ids.add(relationship.source);
    });
    const territoryIds = new Set(item.territories || []);
    root.selectAll(".concept").classed("is-related", d => ids.has(d.id)).classed("is-unrelated", d => !ids.has(d.id));
    root.selectAll(".field-thread, .fellow-relationship").classed("is-related", d => ids.has(d.source) && ids.has(d.target)).classed("is-unrelated", d => !(ids.has(d.source) && ids.has(d.target)));
    root.selectAll(".territory").classed("is-active", d => territoryIds.has(d.id)).classed("is-unrelated", d => territoryIds.size && !territoryIds.has(d.id));
    root.selectAll(".movement, .question-node, .fellow").classed("is-selected", d => d.id === item.id).classed("is-unrelated", d => !ids.has(d.id) && d.id !== item.id);
    root.select(".concept-layer").classed("show-detail", true);
  }

  function clearMapHighlight() {
    if (!root) return;
    root.selectAll(".is-related, .is-unrelated, .is-active, .is-selected, .is-search-focus").classed("is-related is-unrelated is-active is-selected is-search-focus", false);
    root.select(".concept-layer").classed("show-detail", false);
  }

  function animateMovement(item, node) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const path = d3.select(node).select(".movement-path");
    const length = path.node().getTotalLength();
    path.attr("stroke-dasharray", `${length} ${length}`).attr("stroke-dashoffset", length)
      .transition().duration(900).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
      .on("end", () => path.attr("stroke-dasharray", null).attr("stroke-dashoffset", null));
  }

  function setLens(lens) {
    state.lens = lens;
    closeInspector({ redraw: false });
    renderPublicCopy();
    drawMap();
  }

  function fitInitial() {
    const scale = isMobileLayout() ? 1.04 : 0.93;
    const W = data.canvas.width;
    const H = data.canvas.height;
    state.userMoved = false;
    svg.call(zoom.transform, d3.zoomIdentity.translate((W - W * scale) / 2, (H - H * scale) / 2).scale(scale));
  }

  function returnToTerritoryOverview() {
    if (state.lens !== "field") setLens("field");
    else closeInspector();
    document.querySelector(".territory-navigator select").value = "";
    fitInitial();
  }

  function toggleEditMode(force) {
    state.editMode = typeof force === "boolean" ? force : !state.editMode;
    state.editMoveReadyId = null;
    document.body.classList.toggle("edit-mode", state.editMode);
    editorShell.setAttribute("aria-hidden", String(!state.editMode));
    closeRelationshipTypeChooser();
    if (state.editMode) closeInspector({ redraw: false });
    else {
      closeItemEditor();
      editorShell.classList.remove("is-expanded");
      document.querySelector(".edit-toolbar").classList.remove("is-mobile-open");
      document.querySelector(".mobile-edit-toolbar-toggle").setAttribute("aria-expanded", "false");
    }
    renderPublicCopy();
    drawMap();
  }

  function switchEditorTab(tab) {
    document.querySelectorAll("[data-editor-tab]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.editorTab === tab)));
    document.querySelectorAll("[data-editor-pane]").forEach(pane => pane.classList.toggle("is-active", pane.dataset.editorPane === tab));
  }

  function getItem(collection, id) {
    if (collection === "copy") return data.copy;
    if (collection === "centre") return data.centre;
    return (data[collection] || []).find(item => item.id === id);
  }

  function openEditor(collection, id) {
    const item = getItem(collection, id);
    if (!item) return;
    state.editorRef = { collection, id: item.id || id };
    switchEditorTab("item");
    renderItemEditor();
  }

  function closeItemEditor() {
    state.editorRef = null;
    itemEditor.hidden = true;
    itemEditor.innerHTML = "";
    editorEmpty.hidden = false;
  }

  function renderItemEditor() {
    const { collection, id } = state.editorRef;
    const item = getItem(collection, id);
    if (!item) return closeItemEditor();
    editorEmpty.hidden = true;
    itemEditor.hidden = false;

    const fields = orderedFields(collection, item);
    const canDelete = ["concepts", "questions", "fellows"].includes(collection);
    const deleteLabel = collection === "concepts" ? "Delete concept" : "Remove";
    const heading = displayTitle(item) || collectionLabels[collection];
    const relationSection = item.id && collection !== "relationships" && collection !== "copy" && collection !== "lenses" ? renderConnectedRelationships(item.id) : "";

    itemEditor.innerHTML = `
      <div class="item-editor-heading">
        <div><span>${escapeHtml(collectionLabels[collection] || humanize(collection))}</span><h3>${escapeHtml(heading)}</h3></div>
        ${canDelete ? `<button type="button" class="delete-item" data-delete-item="true">${escapeHtml(deleteLabel)}</button>` : ""}
      </div>
      <p class="item-id">ID · ${escapeHtml(item.id || "map-copy")}</p>
      <div class="editor-fields">${fields.map(field => renderField(collection, item, field)).join("")}</div>
      ${relationSection}
    `;

    bindItemEditorInputs(collection, item);
    itemEditor.querySelector("[data-delete-item]")?.addEventListener("click", () => removeItem(collection, item.id));
    itemEditor.querySelectorAll("[data-remove-relationship]").forEach(button => button.addEventListener("click", () => removeRelationship(button.dataset.removeRelationship)));
    itemEditor.querySelectorAll("[data-relationship-type]").forEach(select => {
      select.addEventListener("focus", () => { select._before = snapshot(); });
      select.addEventListener("change", () => {
        const relationship = data.relationships.find(entry => entry.id === select.dataset.relationshipType);
        if (relationship) relationship.type = select.value;
        pushHistory();
        drawMap();
        renderRelationshipManager();
      });
    });
    itemEditor.querySelector("[data-open-relationships]")?.addEventListener("click", () => {
      switchEditorTab("relationships");
      const form = document.querySelector(".relationship-add-form");
      form.elements.sourceSearch.value = "";
      updateRelationshipNodeOptions("source");
      const source = form.elements.source;
      if ([...source.options].some(option => option.value === item.id)) source.value = item.id;
    });
  }

  function orderedFields(collection, item) {
    const excluded = new Set(["id", "key", "role", "manualPosition"]);
    if (collection === "copy") return Object.keys(item).filter(key => !excluded.has(key) && key !== "emptyDescription");
    const preferred = preferredFields[collection] || [];
    const keys = [...preferred, ...Object.keys(item)].filter((key, index, array) => !excluded.has(key) && array.indexOf(key) === index);
    return keys;
  }

  function renderField(collection, item, key) {
    const value = item[key] ?? defaultValueFor(key);
    const label = fieldLabels[key] || humanize(key);
    const isArray = Array.isArray(value) || arrayField(key);
    const isNumber = typeof value === "number" || numericField(key);
    const isLong = isArray || String(value).length > 80 || /description|question|proposition|notes|source|footer|meta/i.test(key);
    const valueString = isArray ? (Array.isArray(value) ? value.join(", ") : value) : value;

    if (collection === "relationships" && ["source", "target"].includes(key)) {
      return `<label class="editor-field"><span>${escapeHtml(label)}</span><select name="${key}" data-value-kind="string">${nodeOptions(valueString)}</select></label>`;
    }
    if (collection === "relationships" && key === "type") {
      return `<label class="editor-field"><span>${escapeHtml(label)}</span><input name="type" list="relationship-types" value="${escapeAttr(valueString)}" data-value-kind="string"></label>`;
    }
    if (!isArray && richTextFields.has(key)) {
      const labelId = `rich-label-${key}`;
      return `<div class="editor-field editor-field-wide rich-text-editor">
        <span id="${escapeAttr(labelId)}">${escapeHtml(label)}</span>
        <div class="rich-text-toolbar" role="toolbar" aria-label="${escapeAttr(label)} formatting">
          <button type="button" data-rich-command="bold" aria-label="Bold"><strong>B</strong></button>
          <button type="button" data-rich-command="italic" aria-label="Italic">I</button>
          <button type="button" data-rich-command="underline" aria-label="Underline">U</button>
          <button type="button" data-rich-command="insertUnorderedList" aria-label="Bullet points">• List</button>
        </div>
        <div class="rich-text-input rich-text" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="${escapeAttr(labelId)}" data-rich-field="${escapeAttr(key)}">${richTextHtml(valueString)}</div>
      </div>`;
    }
    if (isLong) {
      return `<label class="editor-field editor-field-wide"><span>${escapeHtml(label)}</span><textarea name="${key}" rows="${isArray ? 2 : 4}" data-value-kind="${isArray ? "array" : "string"}">${escapeHtml(valueString)}</textarea></label>`;
    }
    return `<label class="editor-field"><span>${escapeHtml(label)}</span><input name="${key}" type="${isNumber ? "number" : "text"}" ${isNumber ? 'step="any"' : ""} value="${escapeAttr(valueString)}" data-value-kind="${isNumber ? "number" : "string"}"></label>`;
  }

  function defaultValueFor(key) {
    if (arrayField(key)) return [];
    if (numericField(key)) return key === "weight" ? 1 : 0;
    return "";
  }

  function arrayField(key) {
    return ["keywords", "terms", "tags", "related", "relatedConcepts", "territories", "questions", "offers", "needs", "waysOfKnowing", "waysOfActing", "movements"].includes(key);
  }

  function numericField(key) {
    return ["x", "y", "x1", "y1", "x2", "y2", "weight", "priority", "radiusX", "radiusY", "rotation"].includes(key);
  }

  function bindItemEditorInputs(collection, item) {
    itemEditor.querySelectorAll("input[name], textarea[name], select[name]").forEach(control => {
      control.addEventListener("focus", () => { control._before = snapshot(); });
      control.addEventListener("input", () => {
        const key = control.name;
        const kind = control.dataset.valueKind;
        if (kind === "array") item[key] = control.value.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
        else if (kind === "number") item[key] = Number(control.value);
        else item[key] = control.value;
        if (["x", "y", "x1", "y1", "x2", "y2"].includes(key)) item.manualPosition = true;
        markUnsaved();
        renderPublicCopy();
        drawMap();
        scheduleHistory();
      });
      control.addEventListener("change", () => {
        window.clearTimeout(scheduleHistory.timer);
        pushHistory();
        renderContentList();
        renderRelationshipManager();
        const title = itemEditor.querySelector(".item-editor-heading h3");
        if (title) title.textContent = displayTitle(item) || collectionLabels[collection];
      });
    });

    itemEditor.querySelectorAll(".rich-text-input[data-rich-field]").forEach(editor => {
      editor.addEventListener("focus", () => {
        editor._before = snapshot();
        try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (error) { /* Browser default remains usable. */ }
      });
      editor.addEventListener("input", () => {
        const key = editor.dataset.richField;
        item[key] = sanitiseRichText(editor.innerHTML);
        markUnsaved();
        renderPublicCopy();
        drawMap();
        scheduleHistory();
      });
      editor.addEventListener("paste", event => {
        event.preventDefault();
        const clipboard = event.clipboardData;
        const pasted = clipboard?.getData("text/html") || clipboard?.getData("text/plain") || "";
        const safe = richTextHtml(pasted);
        try { document.execCommand("insertHTML", false, safe); } catch (error) { /* The browser will retain the current content. */ }
      });
      editor.addEventListener("blur", () => {
        editor.innerHTML = richTextHtml(item[editor.dataset.richField] || "");
        window.clearTimeout(scheduleHistory.timer);
        pushHistory();
        renderContentList();
        renderRelationshipManager();
      });
    });

    itemEditor.querySelectorAll("[data-rich-command]").forEach(button => {
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", () => {
        const editor = button.closest(".rich-text-editor")?.querySelector(".rich-text-input");
        if (!editor) return;
        editor.focus();
        try { document.execCommand(button.dataset.richCommand, false, null); } catch (error) { /* Formatting remains unchanged. */ }
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  }

  function renderConnectedRelationships(id) {
    const connected = data.relationships.filter(relationship => relationship.source === id || relationship.target === id);
    const byId = itemMap();
    return `
      <section class="connected-relationships">
        <div class="section-heading"><h3>Relationships</h3><button type="button" data-open-relationships="true">Add</button></div>
        ${connected.length ? connected.map(relationship => {
          const otherId = relationship.source === id ? relationship.target : relationship.source;
          const other = byId.get(otherId);
          return `<div class="connected-relationship"><span>${escapeHtml(displayTitle(other) || otherId)}</span><select data-relationship-type="${escapeAttr(relationship.id)}">${relationshipTypeOptions(relationship.type)}</select><button type="button" data-remove-relationship="${escapeAttr(relationship.id)}" aria-label="Remove relationship">×</button></div>`;
        }).join("") : '<p class="empty-note">No direct relationships yet.</p>'}
      </section>`;
  }

  function renderContentList() {
    const query = (document.querySelector(".content-search")?.value || "").trim().toLowerCase();
    const groups = [
      ["centre", data.centre ? [data.centre] : []],
      ["territories", data.territories],
      ["concepts", data.concepts],
      ["thresholds", data.thresholds],
      ["movements", data.movements],
      ["questions", data.questions],
      ["fellows", data.fellows],
      ["lenses", data.lenses],
      ["copy", [data.copy]]
    ];
    const container = document.querySelector(".content-list");
    container.innerHTML = groups.map(([collection, items]) => {
      const matches = items.filter(item => !query || JSON.stringify(item).toLowerCase().includes(query));
      if (!matches.length) return "";
      return `<section class="content-group"><h3>${escapeHtml(groupTitle(collection))}<span>${matches.length}</span></h3>${matches.map(item => `<button type="button" class="content-list-item" data-content-collection="${collection}" data-content-id="${escapeAttr(item.id || "map-copy")}"><strong>${escapeHtml(displayTitle(item) || collectionLabels[collection])}</strong><small>${escapeHtml(contentPreview(item))}</small></button>`).join("")}</section>`;
    }).join("") || '<p class="empty-note">No content matches that search.</p>';
    container.querySelectorAll("[data-content-collection]").forEach(button => button.addEventListener("click", () => openEditor(button.dataset.contentCollection, button.dataset.contentId)));
  }

  function groupTitle(collection) {
    const titles = { centre: "Centre", territories: "Territories", concepts: "Concepts and practices", thresholds: "Annotations", movements: "Movements", questions: "Questions", fellows: "Fellows", lenses: "Lens labels", copy: "Interface and public copy" };
    return titles[collection] || humanize(collection);
  }

  function contentPreview(item) {
    return richTextPlain(item.subtitle || item.shortDescription || item.description || item.proposition || item.text || item.rootNote || item.pageTitle || item.type || "");
  }

  function renderRelationshipManager() {
    const form = document.querySelector(".relationship-add-form");
    const source = form.elements.source;
    const target = form.elements.target;
    const previousSource = source.value;
    const previousTarget = target.value;
    source.innerHTML = nodeOptions(previousSource, form.elements.sourceSearch.value);
    target.innerHTML = nodeOptions(previousTarget, form.elements.targetSearch.value);
    const datalist = document.querySelector("#relationship-types");
    datalist.innerHTML = data.relationshipTypes.map(type => `<option value="${escapeAttr(type)}"></option>`).join("");

    const byId = itemMap();
    const list = document.querySelector(".relationship-list");
    list.innerHTML = `<h3>All relationships <span>${data.relationships.length}</span></h3>${data.relationships.map(relationship => `<div class="relationship-row"><button type="button" data-edit-relationship="${escapeAttr(relationship.id)}"><strong>${escapeHtml(displayTitle(byId.get(relationship.source)) || relationship.source)}</strong><span>${escapeHtml(relationship.type)}</span><strong>${escapeHtml(displayTitle(byId.get(relationship.target)) || relationship.target)}</strong></button><button type="button" data-remove-relationship="${escapeAttr(relationship.id)}" aria-label="Remove relationship">×</button></div>`).join("") || '<p class="empty-note">No relationships yet.</p>'}`;
    list.querySelectorAll("[data-edit-relationship]").forEach(button => button.addEventListener("click", () => openEditor("relationships", button.dataset.editRelationship)));
    list.querySelectorAll("[data-remove-relationship]").forEach(button => button.addEventListener("click", () => removeRelationship(button.dataset.removeRelationship)));
  }

  function nodeOptions(selected, query = "") {
    return relationshipNodeOptions(selected, query);
  }

  function relationshipNodeOptions(selected, query) {
    const nodes = [...(data.centre ? [data.centre] : []), ...data.territories, ...data.concepts, ...data.thresholds, ...data.movements, ...data.questions, ...data.fellows];
    const filter = String(query || "").trim().toLocaleLowerCase();
    return nodes
      .map(item => ({ item, label: displayTitle(item) || item.id }))
      .filter(entry => !filter || entry.label.toLocaleLowerCase().includes(filter) || entry.item.id === selected)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))
      .map(entry => {
        const selectedOption = entry.item.id === selected;
        const hiddenSelected = Boolean(filter && selectedOption && !entry.label.toLocaleLowerCase().includes(filter));
        return `<option value="${escapeAttr(entry.item.id)}"${selectedOption ? " selected" : ""}${hiddenSelected ? " hidden" : ""}>${escapeHtml(entry.label)}</option>`;
      }).join("");
  }

  function updateRelationshipNodeOptions(side) {
    const form = document.querySelector(".relationship-add-form");
    const select = form.elements[side];
    const search = form.elements[`${side}Search`];
    const selected = select.value;
    select.innerHTML = relationshipNodeOptions(selected, search.value);
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }

  function relationshipTypeOptions(selected) {
    const types = [...new Set([...data.relationshipTypes, selected].filter(Boolean))];
    return types.map(type => `<option value="${escapeAttr(type)}"${type === selected ? " selected" : ""}>${escapeHtml(type)}</option>`).join("");
  }

  function addRelationshipFromForm(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const source = values.get("source");
    const target = values.get("target");
    const type = String(values.get("type") || "resonance").trim();
    if (!source || !target || source === target) {
      setStatus("Choose two different items.", true);
      return;
    }
    data.relationships.push({ id: uniqueId("relationship", data.relationships, data.relationships.length + 1), source, target, type, description: "", references: "", attribution: "", sourceText: "" });
    if (type && !data.relationshipTypes.includes(type)) data.relationshipTypes.push(type);
    pushHistory();
    renderAll(false);
    setStatus("Relationship added.");
  }

  function removeRelationship(id) {
    data.relationships = data.relationships.filter(relationship => relationship.id !== id);
    if (state.editorRef?.collection === "relationships" && state.editorRef.id === id) closeItemEditor();
    pushHistory();
    renderAll();
    setStatus("Relationship removed.");
  }

  function createItem(kind) {
    const anchor = fieldAnchor();
    if (kind === "concept") {
      const id = uniqueId("new-concept", data.concepts, data.concepts.length + 1);
      data.concepts.push({ id, label: "New concept", subtitle: "", type: "concept", territories: [], shortDescription: "", description: "", longDescription: "", references: "", question: "", keywords: [], terms: [], tags: [], attribution: "", sourceText: "", related: [], x: anchor.x + 120, y: anchor.y + 80, weight: 1, priority: 2, manualPosition: true });
      pushHistory();
      renderAll(false);
      openEditor("concepts", id);
    } else if (kind === "question") {
      const id = uniqueId("new-question", data.questions, data.questions.length + 1);
      data.questions.push({ id, label: "", text: "New question?", subtitle: "", shortDescription: "", description: "", longDescription: "", references: "", keywords: [], terms: [], tags: [], attribution: "", sourceText: "", territories: [], related: [], x: anchor.x + 150, y: anchor.y - 80, weight: 1, manualPosition: true });
      pushHistory();
      renderAll(false);
      openEditor("questions", id);
    } else if (kind === "fellow") {
      const id = uniqueId("new-fellow", data.fellows, data.fellows.length + 1);
      data.fellows.push({
        id, name: "New Fellow", subtitle: "", shortDescription: "", description: "", longDescription: "", references: "",
        questions: [], offers: [], needs: [], notes: "", keywords: [], terms: [], tags: [], attribution: "", sourceText: "",
        territories: [], waysOfKnowing: [], waysOfActing: [], movements: [], x: anchor.x + 90, y: anchor.y + 125,
        weight: 1, manualPosition: true
      });
      pushHistory();
      renderAll(false);
      openEditor("fellows", id);
    } else {
      return;
    }
    setStatus(`${humanize(kind)} added.`);
  }

  function fieldAnchor() {
    return data.territories.find(item => item.role === "centre") || data.centre || { x: data.canvas.width / 2, y: data.canvas.height / 2 };
  }

  function removeItem(collection, id) {
    if (collection === "concepts") {
      const item = getItem(collection, id);
      if (!item || !window.confirm(`Delete concept “${displayTitle(item) || id}”? This will also remove its relationships.`)) return;
    }
    data[collection] = data[collection].filter(item => item.id !== id);
    removeReferences(data, new Set([id]));
    if (state.selected?.id === id) closeInspector();
    closeItemEditor();
    pushHistory();
    renderAll(false);
    setStatus(`${collectionLabels[collection]} removed.`);
  }

  function runEditAction(action) {
    if (action === "undo") undo();
    else if (action === "redo") redo();
    else if (action === "export") exportJson();
    else if (action === "reset") resetOriginal();
  }

  function pushHistory(options = {}) {
    const current = snapshot();
    if (history[historyIndex] === current) return;
    history.splice(historyIndex + 1);
    history.push(current);
    historyIndex = history.length - 1;
    updateHistoryButtons();
    if (options.autosave !== false) markUnsaved();
  }

  function scheduleHistory() {
    window.clearTimeout(scheduleHistory.timer);
    // The live input path has already scheduled persistence. Recording the
    // undo checkpoint must not postpone that pending save.
    scheduleHistory.timer = window.setTimeout(() => pushHistory({ autosave: false }), 380);
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreSnapshot(history[historyIndex]);
    setStatus("Undid last change.");
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    restoreSnapshot(history[historyIndex]);
    setStatus("Redid change.");
  }

  function restoreSnapshot(value) {
    data = JSON.parse(value);
    normaliseData(data);
    renderAll();
    scheduleAutoSave();
  }

  function updateHistoryButtons() {
    document.querySelector('[data-edit-action="undo"]').disabled = historyIndex <= 0;
    document.querySelector('[data-edit-action="redo"]').disabled = historyIndex >= history.length - 1;
  }

  function persistNow() {
    window.clearTimeout(scheduleAutoSave.timer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: DATA_VERSION, data }));
      state.savedSnapshot = snapshot();
      state.saveState = "saved";
      updateEditStatus();
    } catch (error) {
      state.saveState = "error";
      updateEditStatus();
    }
  }

  function scheduleAutoSave() {
    state.saveState = "saving";
    updateEditStatus();
    window.clearTimeout(scheduleAutoSave.timer);
    scheduleAutoSave.timer = window.setTimeout(persistNow, 520);
  }

  function flushAutoSave() {
    if (snapshot() !== state.savedSnapshot) persistNow();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "moth-field-data.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("JSON exported.");
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported.canvas || !Array.isArray(imported.concepts) || !Array.isArray(imported.territories)) throw new Error("Invalid map data");
        data = imported;
        normaliseData(data);
        pushHistory();
        renderAll();
        setStatus("JSON imported.");
      } catch (error) {
        setStatus("That file is not valid MOTH Field JSON.", true);
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  function resetOriginal() {
    if (!window.confirm("Reset all map content and positions to the original data?")) return;
    window.clearTimeout(scheduleAutoSave.timer);
    data = clone(ORIGINAL);
    normaliseData(data);
    pushHistory({ autosave: false });
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { /* Original data remains in memory. */ }
    state.savedSnapshot = snapshot();
    state.saveState = "saved";
    renderAll();
    setStatus("Reset to original map.");
  }

  function markUnsaved() {
    scheduleAutoSave();
  }

  function updateEditStatus() {
    const status = document.querySelector(".edit-status");
    status.dataset.unsaved = String(state.saveState !== "saved");
    if (status.dataset.message) return;
    if (state.saveState === "saving") status.textContent = "Saving…";
    else if (state.saveState === "error") status.textContent = "Save failed";
    else status.textContent = "Saved";
  }

  function setStatus(message, error = false) {
    const status = document.querySelector(".edit-status");
    status.textContent = message;
    status.dataset.message = "true";
    status.classList.toggle("is-error", error);
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
      status.dataset.message = "";
      status.classList.remove("is-error");
      updateEditStatus();
    }, 2600);
  }

  function displayTitle(item) {
    if (!item) return "";
    if (item.from || item.to) return `${item.from || ""} ${data.copy.sourceArrow || "→"} ${item.to || ""}`.trim();
    return item.label || item.name || item.text || item.pageTitle || "";
  }

  function humanize(value) {
    return String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, character => character.toUpperCase());
  }

  function richTextHtml(value) {
    const source = String(value ?? "").trim();
    if (!source) return "";
    const containsSupportedMarkup = /<\/?(?:p|br|strong|b|em|i|u|ul|ol|li|a)\b/i.test(source);
    return containsSupportedMarkup ? sanitiseRichText(source) : plainTextToRichHtml(source);
  }

  function sanitiseRichText(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value ?? "");
    const container = document.createElement("div");
    [...template.content.childNodes].forEach(node => appendSafeRichNode(node, container));
    autoLinkTextNodes(container);
    return container.innerHTML;
  }

  function appendSafeRichNode(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent || ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const sourceTag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "embed", "svg", "math", "template"].includes(sourceTag)) return;
    const aliases = { b: "strong", i: "em", div: "p", h1: "p", h2: "p", h3: "p", h4: "p", h5: "p", h6: "p" };
    const tag = aliases[sourceTag] || sourceTag;
    const allowed = new Set(["p", "br", "strong", "em", "u", "ul", "ol", "li", "a"]);
    if (!allowed.has(tag)) {
      [...node.childNodes].forEach(child => appendSafeRichNode(child, parent));
      return;
    }
    if (tag === "a" && !safeLink(node.getAttribute("href"))) {
      [...node.childNodes].forEach(child => appendSafeRichNode(child, parent));
      return;
    }
    const clean = document.createElement(tag);
    if (tag === "a") {
      clean.setAttribute("href", node.getAttribute("href").trim());
      clean.setAttribute("target", "_blank");
      clean.setAttribute("rel", "noopener noreferrer");
    }
    if (tag !== "br") [...node.childNodes].forEach(child => appendSafeRichNode(child, clean));
    parent.appendChild(clean);
  }

  function plainTextToRichHtml(value) {
    const container = document.createElement("div");
    const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
    let paragraph = [];
    let list = null;
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const element = document.createElement("p");
      paragraph.forEach((line, index) => {
        if (index) element.appendChild(document.createElement("br"));
        appendLinkedText(element, line);
      });
      container.appendChild(element);
      paragraph = [];
    };
    const closeList = () => { list = null; };
    lines.forEach(line => {
      const bullet = line.match(/^\s*(?:[-*•])\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        if (!list) {
          list = document.createElement("ul");
          container.appendChild(list);
        }
        const item = document.createElement("li");
        appendLinkedText(item, bullet[1]);
        list.appendChild(item);
      } else if (!line.trim()) {
        flushParagraph();
        closeList();
      } else {
        closeList();
        paragraph.push(line);
      }
    });
    flushParagraph();
    return container.innerHTML;
  }

  function autoLinkTextNodes(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (node.parentElement?.closest("a")) return;
      const replacement = document.createDocumentFragment();
      if (!appendLinkedText(replacement, node.textContent || "")) return;
      node.replaceWith(replacement);
    });
  }

  function appendLinkedText(parent, value) {
    const text = String(value ?? "");
    const pattern = /https?:\/\/[^\s<>]+/gi;
    let cursor = 0;
    let found = false;
    for (const match of text.matchAll(pattern)) {
      found = true;
      const matched = match[0];
      const href = matched.replace(/[),.;:!?]+$/, "");
      const trailing = matched.slice(href.length);
      parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      if (safeLink(href)) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = href;
        parent.appendChild(link);
      } else parent.appendChild(document.createTextNode(href));
      if (trailing) parent.appendChild(document.createTextNode(trailing));
      cursor = match.index + matched.length;
    }
    if (!found) {
      parent.appendChild(document.createTextNode(text));
      return false;
    }
    parent.appendChild(document.createTextNode(text.slice(cursor)));
    return true;
  }

  function safeLink(value) {
    return /^https?:\/\/[^\s]+$/i.test(String(value || "").trim());
  }

  function richTextPlain(value) {
    const container = document.createElement("div");
    container.innerHTML = richTextHtml(value);
    return container.textContent || "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
