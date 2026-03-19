/* ============================================================
   CMS AI Helper — Chat Widget for LDAH Page Editor
   Provides context-aware help via local Q&A cache + Cloud API
   ============================================================ */

(function () {
  "use strict";

  /* ---- Configuration ---- */
  var CLOUD_FUNCTION_URL = "CLOUD_FUNCTION_URL"; // Replace after deploy
  var MAX_HISTORY = 10;
  var MAX_HISTORY_CHARS = 1000;

  /* ---- Local Q&A Cache ---- */
  var qaCache = [
    {
      patterns: ["edit", "text", "change text", "modify text", "update text"],
      answer:
        "To edit text: click on the text you want to change. The editor panel will open on the right. Make your edits in the panel, then click Save to publish."
    },
    {
      patterns: ["photo", "image", "picture", "upload photo", "change photo", "replace photo"],
      answer:
        "To change a photo: click on the image you want to replace. In the editor panel you can choose a file from your computer or paste an image URL, then click Save."
    },
    {
      patterns: ["save", "publish", "what does save do"],
      answer:
        "Clicking Save publishes your changes to the live website immediately. Visitors will see the update right away."
    },
    {
      patterns: ["cancel", "discard", "what does cancel do"],
      answer:
        "Cancel discards any changes you made since opening the editor panel. The content reverts to what it was before you started editing."
    },
    {
      patterns: ["island", "pacific", "pacific island", "island info"],
      answer:
        "To edit Pacific island information: click on the island name in the left sidebar. Its details will load in the editor panel where you can update text, photos, and contacts."
    },
    {
      patterns: ["contact", "contact info", "phone", "email", "address"],
      answer:
        "To change contact information: navigate to the Contact page using the sidebar, then click the field you want to update (phone, email, or address)."
    },
    {
      patterns: ["hero", "hero photo", "banner", "main photo", "top photo"],
      answer:
        "To change the hero (banner) photo: click directly on the large photo in the hero section at the top of the page. The editor panel will let you upload a replacement."
    },
    {
      patterns: ["file size", "max size", "upload limit", "how big", "5mb"],
      answer:
        "The maximum file size for uploads is 5 MB. Images are auto-compressed when possible, but try to keep originals under that limit for best results."
    },
    {
      patterns: ["bold", "make bold", "bold text"],
      answer:
        "To make text bold: highlight the text you want, then click the B button in the formatting toolbar."
    },
    {
      patterns: ["color", "text color", "change color", "font color"],
      answer:
        "To change text color: highlight the text, then click one of the color dots in the formatting toolbar to apply that color."
    },
    {
      patterns: ["font size", "size", "text size", "bigger", "smaller"],
      answer:
        "To change font size: highlight the text, then use the Size dropdown in the formatting toolbar to pick a new size."
    },
    {
      patterns: ["event", "events", "calendar", "manage events"],
      answer:
        "Events are managed in the main CMS (cms.html), not the Page Editor. Open the CMS to add, edit, or remove events."
    },
    {
      patterns: ["format", "toolbar", "formatting", "italic", "underline", "heading", "paragraph", "line break"],
      answer:
        "Use the formatting toolbar above the text area. Available tools: Bold (B), Italic (I), Underline (U), Heading, Paragraph, and Line Break. Highlight text first, then click the button."
    },
    {
      patterns: ["help", "support", "contact help", "who to call", "daniel", "dp consulting"],
      answer:
        "For additional help, contact Daniel at DP Consulting. He can assist with anything beyond what this helper covers."
    },
    {
      patterns: ["undo", "revert", "go back", "undo changes", "mistake"],
      answer:
        "To undo changes: click Cancel before saving to discard edits. If you already saved, re-open the field and edit it again to correct it."
    }
  ];

  /* ---- State ---- */
  var chatHistory = []; // { role: "user"|"bot", text: "" }
  var panelOpen = false;
  var infoBubblesInitialized = false;

  /* ===========================================================
     DOM Construction — builds all widget HTML dynamically
     =========================================================== */

  /** Create the floating help button */
  function createHelpButton() {
    var btn = document.createElement("button");
    btn.className = "cms-help-btn";
    btn.setAttribute("aria-label", "Open help chat");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92' +
      "C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 " +
      '.9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>' +
      "</svg>";
    btn.addEventListener("click", togglePanel);
    return btn;
  }

  /** Create the chat panel */
  function createChatPanel() {
    var panel = document.createElement("div");
    panel.className = "cms-chat-panel";
    panel.id = "cmsHelperPanel";

    // Header
    var header = document.createElement("div");
    header.className = "cms-chat-header";

    var title = document.createElement("span");
    title.className = "cms-chat-header-title";
    title.textContent = "LDAH Page Editor Help";

    var closeBtn = document.createElement("button");
    closeBtn.className = "cms-chat-close";
    closeBtn.setAttribute("aria-label", "Close help chat");
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", togglePanel);

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Quick actions
    var quickWrap = document.createElement("div");
    quickWrap.className = "cms-quick-actions";

    var quickItems = [
      "How to edit text",
      "How to change a photo",
      "Edit island contacts",
      "Formatting tips"
    ];

    for (var q = 0; q < quickItems.length; q++) {
      var qb = document.createElement("button");
      qb.className = "cms-quick-btn";
      qb.textContent = quickItems[q];
      qb.addEventListener("click", (function (text) {
        return function () { sendMessage(text); };
      })(quickItems[q]));
      quickWrap.appendChild(qb);
    }

    // Messages area
    var messages = document.createElement("div");
    messages.className = "cms-chat-messages";
    messages.id = "cmsChatMessages";

    // Input area
    var inputWrap = document.createElement("div");
    inputWrap.className = "cms-chat-input-wrap";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "cms-chat-input";
    input.id = "cmsChatInput";
    input.placeholder = "Ask a question...";
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.keyCode === 13) {
        sendMessage(input.value);
      }
    });

    var sendBtn = document.createElement("button");
    sendBtn.className = "cms-chat-send";
    sendBtn.setAttribute("aria-label", "Send message");
    // Paper plane icon
    sendBtn.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>' +
      "</svg>";
    sendBtn.addEventListener("click", function () {
      sendMessage(input.value);
    });

    inputWrap.appendChild(input);
    inputWrap.appendChild(sendBtn);

    // Assemble panel
    panel.appendChild(header);
    panel.appendChild(quickWrap);
    panel.appendChild(messages);
    panel.appendChild(inputWrap);

    return panel;
  }

  /* ===========================================================
     Chat Logic
     =========================================================== */

  /** Toggle the chat panel open/closed */
  function togglePanel() {
    var panel = document.getElementById("cmsHelperPanel");
    if (!panel) return;

    panelOpen = !panelOpen;

    if (panelOpen) {
      panel.classList.add("open");
      // Show greeting if first open
      if (chatHistory.length === 0) {
        appendBotMessage("Hi! I'm your Page Editor helper. What would you like to know?");
      }
      // Focus the input
      var input = document.getElementById("cmsChatInput");
      if (input) setTimeout(function () { input.focus(); }, 200);
    } else {
      panel.classList.remove("open");
    }
  }

  /** Open the panel programmatically (used by info bubbles) */
  function openPanel() {
    if (!panelOpen) togglePanel();
  }

  /** Send a message (from input or quick action) */
  function sendMessage(text) {
    if (!text || !text.trim()) return;

    var input = document.getElementById("cmsChatInput");
    if (input) input.value = "";

    var trimmed = text.trim();
    appendUserMessage(trimmed);

    // Check local cache first
    var localAnswer = matchLocalCache(trimmed);
    if (localAnswer) {
      appendBotMessage(localAnswer);
      return;
    }

    // Otherwise call the API
    callAPI(trimmed);
  }

  /** Try to match user input against the local Q&A cache */
  function matchLocalCache(input) {
    var lower = input.toLowerCase();

    var bestMatch = null;
    var bestScore = 0;

    for (var i = 0; i < qaCache.length; i++) {
      var entry = qaCache[i];
      var score = 0;

      for (var p = 0; p < entry.patterns.length; p++) {
        var pattern = entry.patterns[p];
        // Check if the full pattern phrase appears in the input
        if (lower.indexOf(pattern) !== -1) {
          // Longer pattern matches are worth more
          score += pattern.length;
        } else {
          // Check individual words in the pattern
          var words = pattern.split(" ");
          for (var w = 0; w < words.length; w++) {
            if (lower.indexOf(words[w]) !== -1) {
              score += 1;
            }
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    // Require a minimum relevance threshold
    if (bestScore >= 3 && bestMatch) {
      return bestMatch.answer;
    }

    return null;
  }

  /** Detect the current page from the sidebar */
  function getCurrentPageContext() {
    var activeBtn = document.querySelector(".side-btn.active");
    if (activeBtn) {
      return activeBtn.textContent.trim();
    }
    return "unknown page";
  }

  /** Build truncated history for API request */
  function buildHistoryPayload() {
    var recent = chatHistory.slice(-MAX_HISTORY);
    var result = [];
    for (var i = 0; i < recent.length; i++) {
      result.push({
        role: recent[i].role === "bot" ? "assistant" : "user",
        content: String(recent[i].text).slice(0, MAX_HISTORY_CHARS)
      });
    }
    return result;
  }

  /** Call the Cloud Function API */
  function callAPI(userMessage) {
    showTypingIndicator();

    var payload = {
      message: userMessage,
      pageContext: getCurrentPageContext(),
      history: buildHistoryPayload()
    };

    var xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUD_FUNCTION_URL, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.timeout = 15000;

    xhr.onload = function () {
      hideTypingIndicator();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText);
          var reply = data.reply || data.message || data.response || "I received your question but got an empty response. Please try again.";
          appendBotMessage(reply);
        } catch (e) {
          appendBotMessage("Sorry, I got an unexpected response. Try again or contact Daniel at DP Consulting.");
        }
      } else {
        appendBotMessage("Sorry, I couldn't connect. Try again or contact Daniel at DP Consulting.");
      }
    };

    xhr.onerror = function () {
      hideTypingIndicator();
      appendBotMessage("Sorry, I couldn't connect. Try again or contact Daniel at DP Consulting.");
    };

    xhr.ontimeout = function () {
      hideTypingIndicator();
      appendBotMessage("The request timed out. Please try again or contact Daniel at DP Consulting.");
    };

    try {
      xhr.send(JSON.stringify(payload));
    } catch (e) {
      hideTypingIndicator();
      appendBotMessage("Sorry, I couldn't connect. Try again or contact Daniel at DP Consulting.");
    }
  }

  /* ===========================================================
     Message Rendering
     =========================================================== */

  /** Append a bot message bubble */
  function appendBotMessage(text) {
    chatHistory.push({ role: "bot", text: text });
    var container = document.getElementById("cmsChatMessages");
    if (!container) return;

    var msg = document.createElement("div");
    msg.className = "cms-msg bot";
    msg.textContent = text;
    container.appendChild(msg);
    scrollToBottom(container);
  }

  /** Append a user message bubble */
  function appendUserMessage(text) {
    chatHistory.push({ role: "user", text: text });
    var container = document.getElementById("cmsChatMessages");
    if (!container) return;

    var msg = document.createElement("div");
    msg.className = "cms-msg user";
    msg.textContent = text;
    container.appendChild(msg);
    scrollToBottom(container);
  }

  /** Show the typing indicator (3 bouncing dots) */
  function showTypingIndicator() {
    var container = document.getElementById("cmsChatMessages");
    if (!container) return;

    // Remove existing indicator if any
    hideTypingIndicator();

    var typing = document.createElement("div");
    typing.className = "cms-typing";
    typing.id = "cmsTypingIndicator";

    for (var d = 0; d < 3; d++) {
      var dot = document.createElement("span");
      dot.className = "cms-typing-dot";
      typing.appendChild(dot);
    }

    container.appendChild(typing);
    scrollToBottom(container);
  }

  /** Remove the typing indicator */
  function hideTypingIndicator() {
    var indicator = document.getElementById("cmsTypingIndicator");
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }

  /** Scroll messages container to the bottom */
  function scrollToBottom(container) {
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  /* ===========================================================
     Info Bubble System
     =========================================================== */

  var activePopover = null;

  /**
   * Add an (i) info bubble next to a DOM element.
   * @param {HTMLElement} element - The element to attach the bubble to
   * @param {string} helpText  - The help text shown in the popover
   */
  function addInfoBubble(element, helpText) {
    if (!element) return;

    // Don't add duplicate bubbles
    if (element.nextElementSibling && element.nextElementSibling.classList &&
        element.nextElementSibling.classList.contains("cms-info-bubble")) {
      return;
    }

    var bubble = document.createElement("span");
    bubble.className = "cms-info-bubble";
    bubble.textContent = "i";
    bubble.setAttribute("aria-label", "More info");

    bubble.addEventListener("click", function (e) {
      e.stopPropagation();
      showInfoPopover(bubble, helpText);
    });

    // Insert after the element
    if (element.nextSibling) {
      element.parentNode.insertBefore(bubble, element.nextSibling);
    } else {
      element.parentNode.appendChild(bubble);
    }
  }

  /** Show a popover near the given bubble */
  function showInfoPopover(bubble, helpText) {
    // Close any existing popover
    closeActivePopover();

    var popover = document.createElement("div");
    popover.className = "cms-info-popover";

    var textEl = document.createElement("p");
    textEl.className = "cms-info-popover-text";
    textEl.textContent = helpText;

    var link = document.createElement("a");
    link.className = "cms-info-popover-link";
    link.textContent = "Still need help? Ask our assistant";
    link.href = "#";
    link.addEventListener("click", function (e) {
      e.preventDefault();
      closeActivePopover();
      openPanel();
      // Pre-fill the question in the chat input
      var input = document.getElementById("cmsChatInput");
      if (input) {
        input.value = helpText.substring(0, 60);
        input.focus();
      }
    });

    popover.appendChild(textEl);
    popover.appendChild(link);

    // Position above the bubble
    var rect = bubble.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.left = Math.max(10, rect.left - 10) + "px";
    popover.style.top = (rect.top - 10) + "px";
    popover.style.transform = "translateY(-100%)";

    document.body.appendChild(popover);
    activePopover = popover;

    // Close on outside click (deferred to avoid immediate close)
    setTimeout(function () {
      document.addEventListener("click", outsideClickHandler);
    }, 50);
  }

  /** Close the active popover */
  function closeActivePopover() {
    if (activePopover && activePopover.parentNode) {
      activePopover.parentNode.removeChild(activePopover);
    }
    activePopover = null;
    document.removeEventListener("click", outsideClickHandler);
  }

  /** Handler to close popover when clicking outside */
  function outsideClickHandler(e) {
    if (activePopover && !activePopover.contains(e.target)) {
      closeActivePopover();
    }
  }

  /**
   * Initialize info bubbles on key editor panel elements.
   * Called when the editor panel becomes visible.
   */
  function initInfoBubbles() {
    if (infoBubblesInitialized) return;

    // Formatting guide title
    var fmtTitle = document.querySelector(".fmt-cheatsheet-title");
    if (fmtTitle) {
      addInfoBubble(fmtTitle,
        "Use Bold, Italic, Underline, Heading, Paragraph, and Line Break to format your text. Highlight text first, then click a button.");
    }

    // Photo edit section — add bubble to the "Current image:" label
    var photoSection = document.getElementById("photoEditSection");
    if (photoSection) {
      var photoLabel = photoSection.querySelector("p");
      if (photoLabel) {
        addInfoBubble(photoLabel,
          "Upload a new photo from your computer (max 5 MB, auto-compressed) or paste an image URL. Click Save when done.");
      }
    }

    // Save button
    var saveBtn = document.querySelector(".btn-save");
    if (saveBtn) {
      addInfoBubble(saveBtn,
        "Save publishes your changes to the live website immediately. Visitors will see the update right away.");
    }

    // Cancel button
    var cancelBtn = document.querySelector(".btn-cancel");
    if (cancelBtn) {
      addInfoBubble(cancelBtn,
        "Cancel discards your changes. The content reverts to what it was before you started editing.");
    }

    infoBubblesInitialized = true;
  }

  /* ===========================================================
     Auto-initialization
     =========================================================== */

  function init() {
    // Create and append the widget elements
    var helpBtn = createHelpButton();
    var chatPanel = createChatPanel();

    document.body.appendChild(helpBtn);
    document.body.appendChild(chatPanel);

    // Watch for the editor panel to appear, then init info bubbles.
    // Use MutationObserver to detect when the editor panel becomes visible.
    if (typeof MutationObserver !== "undefined") {
      var observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var mutation = mutations[m];

          // Check added nodes for editor panel
          if (mutation.addedNodes && mutation.addedNodes.length) {
            for (var n = 0; n < mutation.addedNodes.length; n++) {
              var node = mutation.addedNodes[n];
              if (node.nodeType === 1 && (
                node.classList.contains("panel") ||
                node.id === "panel" ||
                node.id === "form"
              )) {
                // Delay slightly so inner elements render
                setTimeout(initInfoBubbles, 300);
              }
            }
          }

          // Check attribute changes (e.g., display or class toggle)
          if (mutation.type === "attributes" && mutation.target.nodeType === 1) {
            var target = mutation.target;
            if (target.classList.contains("panel") ||
                target.id === "panel" ||
                target.id === "form") {
              var style = window.getComputedStyle(target);
              if (style.display !== "none" && style.visibility !== "hidden") {
                setTimeout(initInfoBubbles, 300);
              }
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"]
      });
    }

    // Also try to init info bubbles after a delay (panel may already exist in DOM)
    setTimeout(initInfoBubbles, 2000);
  }

  /* ---- Expose global functions for external use ---- */
  window.cmsHelper = {
    addInfoBubble: addInfoBubble,
    initInfoBubbles: initInfoBubbles,
    openChat: openPanel,
    sendMessage: sendMessage
  };

  /* ---- Start when DOM is ready ---- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
