/* ============================================================================
 * Expense Deductibility Checker
 * ============================================================================
 *
 * MAINTENANCE NOTES — what you might want to edit
 * -----------------------------------------------
 *
 *  1. The data:
 *       Edit `Deductibility.xlsx`. Only the "Deductibility" sheet is read
 *       (one row per expense type, three columns). Column headers must match
 *       CONFIG.columns exactly. If a header is renamed in Excel, update
 *       CONFIG.columns in this file to match. If the sheet is renamed,
 *       update SHEET_NAME in convert.py.
 *
 *  2. The example chips on first load:
 *       Edit CONFIG.examples below. Each entry must match a real value in the
 *       "Expense Type" column. Any example that no longer matches a row is
 *       silently dropped — the page won't break.
 *
 *  3. The disclaimer:
 *       Edit it directly in `index.html` (the .disclaimer paragraph).
 *
 * Everything else (search, the browse dropdown, deep links, last-updated,
 * ordered-list rendering of `(i)/(ii)` items) works generically off the data
 * and shouldn't need touching.
 * ========================================================================= */

(function () {
  "use strict";

  // ----- Config (edit-friendly) ---------------------------------------------

  var OTHERS_OPTION_VALUE = "Others";
  var OTHERS_OPTION_LABEL = "Others / Expenses not in the list";

  var CONFIG = {
    dataUrl: "data.json",
    columns: {
      name:      "Expense Type",
      treatment: "Tax Treatment",
      irasLink:  "IRAS Website",
    },
    placeholderValue: "Please select", // skipped if it appears in any cell
    maxSearchResults: 12,
    examples: [
      "Motor vehicle expenses",
      "Rental of business premises",
      "Fines/Penalties",
    ],
    fallbackSearchEntry: OTHERS_OPTION_VALUE,
    othersLabel: OTHERS_OPTION_LABEL,
  };

  var OTHERS_CONDITIONS = [
    "The expenses are solely incurred in the production of income.",
    "The expenses must be incurred. It is considered incurred when the legal liability to pay arises, regardless of whether the actual payment has been made.",
    "The expenses are revenue in nature, and not capital expenses. Revenue expenses are generally costs incurred in the day-to-day operations of a business to generate revenue (such as salaries, rent, and utilities), while capital expenses are investments in the business that are expected to provide long-term benefits (such as acquisition of fixed assets).",
    "The expenses are not prohibited from deduction under the Income Tax Act 1947.",
  ];

  // ----- DOM ----------------------------------------------------------------

  var dom = {
    searchInput: document.getElementById("search"),
    clearSearchBtn: document.getElementById("clearSearch"),
    searchResults: document.getElementById("searchResults"),
    categorySelect: document.getElementById("category"),
    resultEl: document.getElementById("result"),
    resetBtn: document.getElementById("resetBtn"),
    errorEl: document.getElementById("error"),
    lastUpdatedEl: document.getElementById("lastUpdated"),
  };

  // ----- State --------------------------------------------------------------

  var entriesByName = new Map();    // Map<expenseType, {name, treatment, irasLink}>
  var allEntries = [];              // same entries, sorted by name, for search
  var currentSearchResults = [];    // results currently rendered in the dropdown
  var activeSearchIndex = -1;       // keyboard cursor in the search results
  var othersAnswers = [];            // null | true | false per condition

  // ----- Tiny utilities -----------------------------------------------------

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function showError(msg) {
    dom.errorEl.textContent = msg;
    dom.errorEl.hidden = false;
  }
  function clearError() {
    dom.errorEl.hidden = true;
    dom.errorEl.textContent = "";
  }

  function isUsableValue(v) {
    if (v === null || v === undefined) return false;
    var s = String(v).trim();
    return s !== "" && s !== CONFIG.placeholderValue;
  }

  // ----- Deductibility text → DOM (paragraphs + (i)/(ii) lists) -------------

  var LIST_ITEM_RE = /^\(([ivx]+|\d+)\)\s+(.+)$/i;
  var BULLET_RE = /^[-•]\s+(.+)$/;

  function parseDeductibilityFragments(text) {
    var lines = String(text).split(/\r?\n/).map(function (s) { return s.trim(); });
    var fragments = [];
    var paraBuf = [];
    var listBuf = null;

    function flushPara() {
      if (paraBuf.length) {
        fragments.push({ type: "p", lines: paraBuf });
        paraBuf = [];
      }
    }
    function flushList() {
      if (listBuf && listBuf.items.length) fragments.push(listBuf);
      listBuf = null;
    }

    lines.forEach(function (line) {
      if (line === "") {
        flushPara();
        flushList();
        return;
      }
      var m = line.match(LIST_ITEM_RE);
      var b = line.match(BULLET_RE);
      if (m) {
        flushPara();
        if (!listBuf || listBuf.type !== "ol") { flushList(); listBuf = { type: "ol", items: [] }; }
        listBuf.items.push(m[2]);
      } else if (b) {
        flushPara();
        if (!listBuf || listBuf.type !== "ul") { flushList(); listBuf = { type: "ul", items: [] }; }
        listBuf.items.push(b[1]);
      } else {
        flushList();
        paraBuf.push(line);
      }
    });
    flushPara();
    flushList();
    return fragments;
  }

  function renderDeductibilityInto(container, text) {
    parseDeductibilityFragments(text).forEach(function (frag) {
      if (frag.type === "p") {
        var p = document.createElement("p");
        frag.lines.forEach(function (line, i) {
          if (i > 0) p.appendChild(document.createElement("br"));
          p.appendChild(document.createTextNode(line));
        });
        container.appendChild(p);
      } else if (frag.type === "ol") {
        var ol = document.createElement("ol");
        frag.items.forEach(function (item) {
          var li = document.createElement("li");
          li.textContent = item;
          ol.appendChild(li);
        });
        container.appendChild(ol);
      } else if (frag.type === "ul") {
        var ul = document.createElement("ul");
        frag.items.forEach(function (item) {
          var li = document.createElement("li");
          li.textContent = item;
          ul.appendChild(li);
        });
        container.appendChild(ul);
      }
    });
  }

  // ----- Result panel -------------------------------------------------------

  function renderEmptyState() {
    clearChildren(dom.resultEl);
    var wrap = document.createElement("div");
    wrap.className = "empty-state";

    var examples = CONFIG.examples.filter(function (name) {
      return entriesByName.has(name);
    });

    var p = document.createElement("p");
    p.className = "placeholder";
    p.textContent = examples.length
      ? "Try one of these to get started:"
      : "Search above or browse the expense types to see deductibility.";
    wrap.appendChild(p);

    if (examples.length) {
      var chips = document.createElement("div");
      chips.className = "example-chips";
      examples.forEach(function (name) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = name;
        btn.addEventListener("click", function () {
          applySelection(name);
        });
        chips.appendChild(btn);
      });
      wrap.appendChild(chips);
    }

    dom.resultEl.appendChild(wrap);
    dom.resetBtn.hidden = true;
  }

  function renderResult(entry) {
    clearChildren(dom.resultEl);

    var name = document.createElement("p");
    name.className = "expense-name";
    name.textContent = entry.name;
    dom.resultEl.appendChild(name);

    var body = document.createElement("div");
    body.className = "deductibility";
    renderDeductibilityInto(body, entry.treatment);
    dom.resultEl.appendChild(body);

    var irasLink = entry.irasLink;
    if (irasLink) {
      var linkP = document.createElement("p");
      linkP.className = "iras-link";
      var a = document.createElement("a");
      a.href = irasLink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "More details on the IRAS website ";
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "13");
      svg.setAttribute("height", "13");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      // Feather Icons "external-link" (MIT licence)
      var path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path1.setAttribute("d", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6");
      var path2 = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      path2.setAttribute("points", "15 3 21 3 21 9");
      var path3 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      path3.setAttribute("x1", "10"); path3.setAttribute("y1", "14");
      path3.setAttribute("x2", "21"); path3.setAttribute("y2", "3");
      svg.appendChild(path1); svg.appendChild(path2); svg.appendChild(path3);
      a.appendChild(svg);
      linkP.appendChild(a);
      dom.resultEl.appendChild(linkP);
    }

    dom.resetBtn.hidden = false;
  }

  // ----- Others checklist ---------------------------------------------------

  function renderOthersChecklist() {
    clearChildren(dom.resultEl);
    othersAnswers = OTHERS_CONDITIONS.map(function () { return null; });

    var crumb = document.createElement("p");
    crumb.className = "breadcrumb";
    crumb.textContent = CONFIG.othersLabel;
    dom.resultEl.appendChild(crumb);

    var heading = document.createElement("p");
    heading.className = "expense-name";
    heading.textContent = "Is this expense deductible?";
    dom.resultEl.appendChild(heading);

    var intro = document.createElement("p");
    intro.className = "checklist-intro";
    intro.textContent = "Go through each condition below. All must be met for the expense to be deductible.";
    dom.resultEl.appendChild(intro);

    var checklist = document.createElement("div");
    checklist.className = "checklist";
    checklist.id = "othersChecklist";

    OTHERS_CONDITIONS.forEach(function (condition, idx) {
      var item = document.createElement("div");
      item.className = "checklist-item";
      item.id = "checklist-item-" + idx;

      var text = document.createElement("p");
      text.className = "checklist-text";
      text.textContent = condition;
      item.appendChild(text);

      var btns = document.createElement("div");
      btns.className = "checklist-btns";

      ["Yes", "No"].forEach(function (label, i) {
        var isNo = i === 1;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "checklist-btn checklist-btn-" + (isNo ? "no" : "yes");
        btn.textContent = label;
        btn.addEventListener("click", function () { setOthersAnswer(idx, !isNo); });
        btns.appendChild(btn);
      });

      item.appendChild(btns);
      checklist.appendChild(item);
    });

    dom.resultEl.appendChild(checklist);

    var resultCard = document.createElement("div");
    resultCard.className = "checklist-result";
    resultCard.id = "othersResult";
    resultCard.hidden = true;
    dom.resultEl.appendChild(resultCard);

    dom.resetBtn.hidden = false;
  }

  function setOthersAnswer(idx, answer) {
    othersAnswers[idx] = answer;

    var item = document.getElementById("checklist-item-" + idx);
    if (!item) return;

    // Use explicit add/remove instead of classList.toggle(name, force).
    // Edge Legacy (EdgeHTML) shipped a bug where the second argument was
    // ignored, causing the class to flip on every click and the visual
    // state never to settle. Explicit add/remove is bug-free everywhere.
    if (answer === true) {
      item.classList.add("answered-yes");
      item.classList.remove("answered-no");
    } else if (answer === false) {
      item.classList.add("answered-no");
      item.classList.remove("answered-yes");
    }

    var btns = item.querySelectorAll(".checklist-btn");
    if (btns.length >= 2) {
      if (answer === true) {
        btns[0].classList.add("active");
        btns[1].classList.remove("active");
      } else if (answer === false) {
        btns[0].classList.remove("active");
        btns[1].classList.add("active");
      }
    }

    if (othersAnswers.every(function (a) { return a !== null; })) {
      renderOthersResult();
    }
  }

  function renderOthersResult() {
    var resultCard = document.getElementById("othersResult");
    if (!resultCard) return;
    var firstReveal = resultCard.hidden;
    clearChildren(resultCard);

    var allYes = othersAnswers.every(function (a) { return a === true; });
    resultCard.className = "checklist-result " + (allYes ? "checklist-result-yes" : "checklist-result-no");
    resultCard.hidden = false;

    var title = document.createElement("p");
    title.className = "checklist-result-title";
    title.textContent = allYes ? "Deductible" : "Not deductible";
    resultCard.appendChild(title);

    var body = document.createElement("p");
    body.className = "checklist-result-body";
    body.textContent = allYes
      ? "This expense is likely deductible. It satisfies all the conditions required for business expenses that are 'wholly and exclusively incurred in the production of income'."
      : "This expense is not deductible. Business expenses are deductible only when they are 'wholly and exclusively incurred in the production of income', meaning every condition must be met. As not all conditions are satisfied, this expense cannot be deducted.";
    resultCard.appendChild(body);

    // Only auto-scroll the first time the card appears, so toggling answers
    // afterwards (Yes↔No to compare) doesn't yank the page.
    if (firstReveal) {
      resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // ----- Dropdowns ----------------------------------------------------------

  function populateExpenseTypes() {
    clearChildren(dom.categorySelect);

    var placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "Select an expense type";
    dom.categorySelect.appendChild(placeholderOpt);

    allEntries.forEach(function (entry) {
      if (entry.name === OTHERS_OPTION_VALUE) return; // appended explicitly below
      var opt = document.createElement("option");
      opt.value = entry.name;
      opt.textContent = entry.name;
      dom.categorySelect.appendChild(opt);
    });

    var othersOpt = document.createElement("option");
    othersOpt.value = OTHERS_OPTION_VALUE;
    othersOpt.textContent = CONFIG.othersLabel;
    dom.categorySelect.appendChild(othersOpt);

    dom.categorySelect.disabled = false;
  }

  // ----- Selection orchestration --------------------------------------------

  function applySelection(name) {
    if (name === OTHERS_OPTION_VALUE || name === CONFIG.othersLabel) {
      dom.categorySelect.value = OTHERS_OPTION_VALUE;
      renderOthersChecklist();
      updateHash(OTHERS_OPTION_VALUE);
      return;
    }

    var entry = entriesByName.get(name);
    if (!entry && name === CONFIG.fallbackSearchEntry) {
      entry = { name: name, treatment: "", irasLink: "" };
    }
    if (!entry) {
      renderEmptyState();
      return;
    }

    dom.categorySelect.value = name;
    renderResult(entry);
    updateHash(name);
  }

  function resetAll() {
    dom.categorySelect.value = "";
    dom.searchInput.value = "";
    hideSearchResults();
    dom.clearSearchBtn.hidden = true;
    renderEmptyState();
    updateHash("");
  }

  // ----- Search -------------------------------------------------------------

  function searchEntries(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    var scored = [];
    allEntries.forEach(function (e) {
      var nameIdx = e.name.toLowerCase().indexOf(q);
      var bodyIdx = e.treatment.toLowerCase().indexOf(q);
      var score = 0;
      // Use a large base for name matches so the position penalty never
      // pushes a real match below zero (names can be ~100 chars).
      if (nameIdx !== -1) score += Math.max(0, 1000 - nameIdx);
      if (bodyIdx !== -1) score += 5;
      if (score > 0) scored.push({ entry: e, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, CONFIG.maxSearchResults).map(function (s) { return s.entry; });
  }

  function highlight(text, query) {
    var frag = document.createDocumentFragment();
    if (!query) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    var re = new RegExp(escapeRegExp(query), "ig");
    var lastIndex = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      }
      var mark = document.createElement("mark");
      mark.textContent = m[0];
      frag.appendChild(mark);
      lastIndex = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    return frag;
  }

  function showSearchResults(results, query) {
    clearChildren(dom.searchResults);
    currentSearchResults = results;
    activeSearchIndex = -1;
    dom.searchInput.setAttribute("aria-expanded", "true");
    dom.searchInput.removeAttribute("aria-activedescendant");

    if (!results.length) {
      var li = document.createElement("li");
      li.className = "result-empty";
      li.textContent = "No matches for “" + query + "”";
      dom.searchResults.appendChild(li);
      dom.searchResults.hidden = false;
      return;
    }

    results.forEach(function (e, idx) {
      var li = document.createElement("li");
      li.id = "search-result-" + idx;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");

      var nameSpan = document.createElement("span");
      nameSpan.className = "result-name";
      nameSpan.appendChild(highlight(e.name, query));
      li.appendChild(nameSpan);

      // mousedown fires before blur, so the result stays available for click.
      li.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
        commitSearchSelection(e);
      });
      dom.searchResults.appendChild(li);
    });

    dom.searchResults.hidden = false;
  }

  function hideSearchResults() {
    dom.searchResults.hidden = true;
    clearChildren(dom.searchResults);
    currentSearchResults = [];
    activeSearchIndex = -1;
    dom.searchInput.setAttribute("aria-expanded", "false");
    dom.searchInput.removeAttribute("aria-activedescendant");
  }

  function setActiveSearchIndex(newIdx) {
    var items = dom.searchResults.querySelectorAll("li[role='option']");
    if (!items.length) return;
    if (newIdx < 0) newIdx = items.length - 1;
    if (newIdx >= items.length) newIdx = 0;
    items.forEach(function (it, i) {
      var isActive = i === newIdx;
      it.classList.toggle("active", isActive);
      it.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    items[newIdx].scrollIntoView({ block: "nearest" });
    dom.searchInput.setAttribute("aria-activedescendant", items[newIdx].id);
    activeSearchIndex = newIdx;
  }

  function commitSearchSelection(entry) {
    applySelection(entry.name);
    dom.searchInput.value = "";
    dom.clearSearchBtn.hidden = true;
    hideSearchResults();
    dom.searchInput.blur();
  }

  // ----- Hash routing -------------------------------------------------------

  function updateHash(name) {
    var newHash = name ? "#exp=" + encodeURIComponent(name) : "";
    if (newHash !== location.hash) {
      history.replaceState(null, "", location.pathname + location.search + newHash);
    }
  }

  function readHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return null;
    var out = {};
    h.split("&").forEach(function (kv) {
      var pair = kv.split("=");
      if (pair.length !== 2) return;
      try { out[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]); }
      catch (e) { /* ignore malformed pair */ }
    });
    return out;
  }

  function applyFromHash() {
    var h = readHash();
    if (!h || !h.exp) {
      // Hash was cleared (e.g. user manually edited URL or browser
      // navigated). Reset the visible state, but only after data has
      // loaded — otherwise the initial empty render in loadData runs.
      if (entriesByName.size > 0) {
        dom.categorySelect.value = "";
        dom.searchInput.value = "";
        dom.clearSearchBtn.hidden = true;
        hideSearchResults();
        renderEmptyState();
      }
      return;
    }
    if (h.exp === OTHERS_OPTION_VALUE || h.exp === CONFIG.othersLabel) { applySelection(OTHERS_OPTION_VALUE); return; }
    if (!entriesByName.has(h.exp)) return;
    applySelection(h.exp);
  }

  // ----- Data load + validation ---------------------------------------------

  function validateColumnsPresent(rows) {
    if (!rows.length) return;
    var sample = rows[0];
    var expected = [CONFIG.columns.name, CONFIG.columns.treatment];
    var missing = expected.filter(function (col) {
      return !Object.prototype.hasOwnProperty.call(sample, col);
    });
    if (missing.length) {
      var found = Object.keys(sample).filter(function (k) { return k.indexOf('__EMPTY') !== 0; });
      throw new Error(
        'Column(s) "' + missing.join('", "') + '" not found in ' + CONFIG.dataUrl + '. ' +
        'Found: "' + found.join('", "') + '". Update CONFIG.columns in app.js to match the Excel headers.'
      );
    }
  }

  function buildDataFromRows(rows) {
    var byName = new Map();
    rows.forEach(function (row) {
      var name      = row[CONFIG.columns.name];
      var treatment = row[CONFIG.columns.treatment];
      if (!isUsableValue(name) || !isUsableValue(treatment)) return;
      var rawLink = row[CONFIG.columns.irasLink];
      var entry = {
        name: String(name).trim(),
        treatment: String(treatment).trim(),
        irasLink: (rawLink && String(rawLink).trim()) || "",
      };
      if (!byName.has(entry.name)) byName.set(entry.name, entry);
    });
    var flat = Array.from(byName.values()).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    return { byName: byName, flat: flat };
  }

  function setLastUpdated(headerValue) {
    if (!headerValue) { dom.lastUpdatedEl.textContent = ""; return; }
    var d = new Date(headerValue);
    if (isNaN(d.getTime())) { dom.lastUpdatedEl.textContent = ""; return; }
    var formatted = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    dom.lastUpdatedEl.textContent = "Last Updated: " + formatted;
  }

  function failLoad(err) {
    console.error("[deductibility] load failed:", err);
    var msg = (err && (err.message || (err.toString && err.toString()))) || "Unknown error";
    showError("Failed to load expense data. " + msg);
    clearChildren(dom.categorySelect);
    var opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Unavailable";
    dom.categorySelect.appendChild(opt);
    dom.categorySelect.disabled = true;
    dom.resultEl.setAttribute("aria-busy", "false");
    clearChildren(dom.resultEl);
  }

  function loadData() {
    if (location.protocol === "file:") {
      showError(
        "This page must be served over http(s), not opened directly via file://. " +
        "Run a local server (e.g. `python3 -m http.server 8765` from the project folder) " +
        "and open http://localhost:8765/."
      );
      return;
    }

    var lastModified = null;

    fetch(CONFIG.dataUrl, { cache: "no-cache" })
      .then(function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status + " fetching " + CONFIG.dataUrl);
        lastModified = resp.headers.get("Last-Modified");
        return resp.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error("Empty or invalid data in " + CONFIG.dataUrl);
        }
        validateColumnsPresent(rows);
        var built = buildDataFromRows(rows);
        if (built.byName.size === 0) {
          throw new Error("No usable rows found in " + CONFIG.dataUrl + ". " +
            "Check that rows have a non-empty Expense Type and Tax Treatment.");
        }
        entriesByName = built.byName;
        allEntries = built.flat.concat([{ name: OTHERS_OPTION_VALUE, treatment: "", irasLink: "" }]);

        populateExpenseTypes();
        dom.searchInput.disabled = false;
        dom.searchInput.placeholder = "Search…";

        renderEmptyState();
        dom.resultEl.setAttribute("aria-busy", "false");
        setLastUpdated(lastModified);
        clearError();

        applyFromHash();
      })
      .catch(failLoad);
  }

  // ----- Event wiring -------------------------------------------------------

  function onCategoryChange() {
    var name = dom.categorySelect.value;
    if (!name) {
      renderEmptyState();
      updateHash("");
      return;
    }
    applySelection(name);
  }

  function onSearchInput() {
    var q = dom.searchInput.value || "";
    dom.clearSearchBtn.hidden = q.length === 0;
    if (!q.trim()) { hideSearchResults(); return; }

    var results = searchEntries(q);
    if (!results.length) {
      dom.clearSearchBtn.hidden = false;
      hideSearchResults();
      applySelection(CONFIG.fallbackSearchEntry || OTHERS_OPTION_VALUE);
      return;
    }

    showSearchResults(results, q.trim());
  }

  function onSearchFocus() {
    var q = dom.searchInput.value || "";
    if (!q.trim()) return;

    var results = searchEntries(q);
    if (!results.length) {
      dom.clearSearchBtn.hidden = false;
      hideSearchResults();
      applySelection(CONFIG.fallbackSearchEntry || OTHERS_OPTION_VALUE);
      return;
    }
    showSearchResults(results, q.trim());
  }

  function onSearchBlur() {
    // Delay so a click on a result item can register before we hide.
    setTimeout(hideSearchResults, 120);
  }

  function onSearchKeydown(ev) {
    if (dom.searchResults.hidden) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault(); setActiveSearchIndex(activeSearchIndex + 1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault(); setActiveSearchIndex(activeSearchIndex - 1);
    } else if (ev.key === "Enter") {
      var pickIdx = activeSearchIndex >= 0 ? activeSearchIndex : 0;
      var entry = currentSearchResults[pickIdx];
      if (entry) { ev.preventDefault(); commitSearchSelection(entry); }
    } else if (ev.key === "Escape") {
      hideSearchResults();
      dom.searchInput.blur();
    }
  }

  function onClearSearchClick() {
    dom.searchInput.value = "";
    dom.clearSearchBtn.hidden = true;
    hideSearchResults();
    dom.searchInput.focus();
  }

  function init() {
    dom.categorySelect.addEventListener("change", onCategoryChange);
    dom.searchInput.addEventListener("input", onSearchInput);
    dom.searchInput.addEventListener("paste", onSearchInput);
    dom.searchInput.addEventListener("focus", onSearchFocus);
    dom.searchInput.addEventListener("blur", onSearchBlur);
    dom.searchInput.addEventListener("keydown", onSearchKeydown);
    dom.clearSearchBtn.addEventListener("click", onClearSearchClick);
    dom.resetBtn.addEventListener("click", resetAll);
    window.addEventListener("hashchange", applyFromHash);
    loadData();
  }

  init();
})();
