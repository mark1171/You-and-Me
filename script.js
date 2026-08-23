window.addEventListener("load", () => {
  document.body.classList.add("loaded");
});

/* Upload a file straight to Cloudinary from the browser (no backend
   needed) using an unsigned upload preset. Pass a publicId to control
   the stored filename (used for the manifest + fixed gallery slots);
   leave it out to let Cloudinary generate a unique one. */
function uploadToCloudinary(file, publicId) {
  const cloudName = window.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || cloudName.startsWith("PASTE_")) {
    return Promise.reject(new Error("Cloudinary isn't configured yet — check cloudinary-config.js"));
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  if (publicId) formData.append("public_id", publicId);

  return fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  }).then((res) => {
    if (!res.ok) throw new Error("Cloudinary upload failed");
    return res.json();
  }).then((data) => data.secure_url);
}

/* Ask Cloudinary to deliver a resized, auto-optimized version of an
   image instead of the full original — faster loading, same URL host. */
function optimizedUrl(url, width = 500) {
  if (!url || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/w_${width},q_auto,f_auto/`);
}

/* The shared list of photos + captions lives in a small JSON "bin" on
   jsonbin.io — a free service made for exactly this. Cloudinary still
   stores the actual photos; this just tracks which ones exist and in
   what order, and (unlike a raw Cloudinary file) can actually be
   updated after the first save. binId picks which bin (memories vs
   gallery); each save replaces that bin's whole contents. */
function saveManifest(binId, data) {
  const apiKey = window.JSONBIN_API_KEY;
  return fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": apiKey,
    },
    body: JSON.stringify(data),
  }).then((res) => {
    if (!res.ok) throw new Error("Couldn't save the photo list");
    return res.json();
  });
}

function loadManifest(binId, fallback) {
  const apiKey = window.JSONBIN_API_KEY;
  const wantsArray = Array.isArray(fallback);
  return fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    headers: { "X-Master-Key": apiKey },
    cache: "no-store",
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      if (!json || json.record === undefined) return fallback;
      const record = json.record;
      // Guard against a bin holding the wrong shape of data (e.g. still
      // has its initial placeholder content) so a stray value can never
      // crash .forEach()/spread elsewhere in the app.
      const isRightShape = wantsArray
        ? Array.isArray(record)
        : record !== null && typeof record === "object" && !Array.isArray(record);
      return isRightShape ? record : fallback;
    })
    .catch(() => fallback);
}

/* Highlight current page in nav */
document.addEventListener("DOMContentLoaded", () => {
  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach((link) => {
    if (link.getAttribute("href") === path) link.classList.add("active");
  });
});

/* Mobile nav toggle */
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");
  if (!toggle || !links) return;

  const closeMenu = () => {
    toggle.classList.remove("open");
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const isOpen = links.classList.toggle("open");
    toggle.classList.toggle("open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  links.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 720) closeMenu();
  });
});

/* Ambient blue/violet particle field (index page) */
document.addEventListener("DOMContentLoaded", () => {
  const field = document.getElementById("particle-field");
  if (!field) return;
  const colors = ["#4f7cff", "#8b5cf6", "#6d28d9"];
  const count = 34;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    const size = Math.random() * 4 + 2;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = `${Math.random() * 10 + 8}s`;
    p.style.animationDelay = `${Math.random() * 6}s`;
    p.style.animationDirection = Math.random() > 0.5 ? "alternate" : "alternate-reverse";
    field.appendChild(p);
  }
});

/* Memories page: upload photos to Cloudinary, keep the list of them
   (with captions + who they're of) in a small JSON manifest on
   jsonbin.io — so the whole thing works with just two free services,
   synced everywhere. A sidebar of filter buttons (All/Mark/Monica/Us)
   narrows which photos are shown. */
document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("memories-grid");
  if (!grid) return;

  const addBtn = document.getElementById("add-memory-btn");
  const fileInput = document.getElementById("memory-file-input");
  const filterBtns = document.querySelectorAll(".filter-btn[data-filter]");
  const sortBtns = document.querySelectorAll(".sort-btn[data-sort]");
  const MANIFEST_ID = window.JSONBIN_MEMORIES_ID;
  const CATEGORIES = ["mark", "monica", "us"];

  const grads = [
    "linear-gradient(155deg, #4f7cff, #8b5cf6)",
    "linear-gradient(155deg, #8b5cf6, #c4b5fd)",
    "linear-gradient(155deg, #3a5fe0, #7c4fd4)",
  ];

  let allMemories = [];
  let activeFilter = "all";
  let sortOrder = "newest";
  let editingSrc = null;

  const modal = document.getElementById("memory-modal");
  const modalBackdrop = document.getElementById("memory-modal-backdrop");
  const modalPhoto = document.getElementById("memory-modal-photo");
  const modalCaption = document.getElementById("memory-modal-caption");
  const modalDate = document.getElementById("memory-modal-date");
  const modalSave = document.getElementById("memory-modal-save");
  const modalCancel = document.getElementById("memory-modal-cancel");

  const formatDate = (isoDate) => {
    if (!isoDate) return "";
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const modalContent = modal?.querySelector(".memory-modal-content");

  // Custom delete-confirm dialog — used instead of window.confirm(),
  // which can get silently blocked inside in-app browsers (Facebook/
  // Instagram/Messenger link previews) and never show anything.
  const confirmModal = document.getElementById("delete-confirm-modal");
  const confirmBackdrop = document.getElementById("delete-confirm-backdrop");
  const confirmYes = document.getElementById("delete-confirm-yes");
  const confirmNo = document.getElementById("delete-confirm-no");
  let confirmResolve = null;

  const askDeleteConfirm = () => {
    if (!confirmModal) return Promise.resolve(true);
    confirmModal.hidden = false;
    document.body.style.overflow = "hidden";
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  };

  const closeDeleteConfirm = (result) => {
    if (!confirmModal) return;
    confirmModal.hidden = true;
    document.body.style.overflow = "";
    if (confirmResolve) {
      confirmResolve(result);
      confirmResolve = null;
    }
  };

  confirmYes?.addEventListener("click", () => closeDeleteConfirm(true));
  confirmNo?.addEventListener("click", () => closeDeleteConfirm(false));
  confirmBackdrop?.addEventListener("click", () => closeDeleteConfirm(false));

  const openModal = (memory, sourceEl) => {
    if (!modal) return;
    editingSrc = memory.src;
    modalPhoto.style.backgroundImage = `url(${optimizedUrl(memory.src, 700)})`;
    modalCaption.value = memory.caption || "";
    modalDate.value = memory.date || "";
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    // Animate the modal growing out from the exact photo that was
    // tapped, instead of just appearing in the middle of the screen —
    // makes it feel like the photo itself is expanding into the popup.
    // Plays on every device now (phone, tablet, laptop, desktop).
    if (sourceEl && modalContent) {
      const from = sourceEl.getBoundingClientRect();
      const to = modalContent.getBoundingClientRect();
      const scaleX = from.width / to.width;
      const scaleY = from.height / to.height;
      const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
      const dy = (from.top + from.height / 2) - (to.top + to.height / 2);

      modalContent.style.transition = "none";
      modalContent.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
      modalContent.style.opacity = "0.5";

      // Force the browser to paint the starting position before we
      // switch the transition back on, or it'll skip straight to the
      // end state with no animation at all.
      requestAnimationFrame(() => {
        modalContent.style.transition = "transform 0.38s cubic-bezier(.22,.9,.25,1), opacity 0.28s ease";
        modalContent.style.transform = "translate(0, 0) scale(1, 1)";
        modalContent.style.opacity = "1";
      });
    } else if (modalContent) {
      modalContent.style.transition = "";
      modalContent.style.transform = "";
      modalContent.style.opacity = "";
    }
  };

  const closeModal = () => {
    if (!modal) return;
    modal.hidden = true;
    editingSrc = null;
    document.body.style.overflow = "";
  };

  modalBackdrop?.addEventListener("click", closeModal);
  modalCancel?.addEventListener("click", closeModal);

  modalSave?.addEventListener("click", () => {
    if (!editingSrc) return;

    modalSave.disabled = true;
    modalSave.textContent = "Saving…";

    loadManifest(MANIFEST_ID, []).then((current) => {
      const updated = current.map((m) =>
        m.src === editingSrc
          ? { ...m, caption: modalCaption.value.trim(), date: modalDate.value }
          : m
      );
      return saveManifest(MANIFEST_ID, updated).then(() => {
        allMemories = updated;
        render();
        closeModal();
      });
    })
      .catch(() => alert("Couldn't save those changes — check your connection and try again."))
      .finally(() => {
        modalSave.disabled = false;
        modalSave.textContent = "Save";
      });
  });

  const askCategory = () => {
    const raw = (window.prompt("Whose memory is this — mark, monica, or us?", "us") || "us")
      .trim()
      .toLowerCase();
    return CATEGORIES.includes(raw) ? raw : "us";
  };

  const render = () => {
    grid.querySelectorAll(".memory-card:not(.memory-add)").forEach((el) => el.remove());

    const filtered = activeFilter === "all"
      ? allMemories
      : allMemories.filter((m) => m.category === activeFilter);

    // Sort by the date typed into each photo's edit modal. Photos with
    // no date set always sink to the end, in either sort direction,
    // instead of jumping around unpredictably.
    const dateValue = (m) => {
      if (!m.date) return null;
      const t = new Date(`${m.date}T00:00:00`).getTime();
      return Number.isNaN(t) ? null : t;
    };

    const visible = [...filtered].sort((a, b) => {
      const aTime = dateValue(a);
      const bTime = dateValue(b);
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
    });

    visible.forEach((memory, i) => {
      const card = document.createElement("div");
      card.className = "memory-card has-photo";
      card.style.backgroundImage = `url(${optimizedUrl(memory.src, 400)})`;
      card.style.setProperty("--grad", grads[i % grads.length]);
      card.style.animationDelay = `${i * 0.06}s`;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", "Edit this memory");

      const label = document.createElement("span");
      label.textContent = memory.caption || `Memory ${String(i + 1).padStart(2, "0")}`;
      card.appendChild(label);

      const dateText = formatDate(memory.date);
      if (dateText) {
        const dateSpan = document.createElement("span");
        dateSpan.className = "memory-date";
        dateSpan.textContent = dateText;
        card.appendChild(dateSpan);
      }

      const del = document.createElement("button");
      del.type = "button";
      del.className = "memory-delete";
      del.setAttribute("aria-label", "Remove this memory");
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        askDeleteConfirm().then((confirmed) => {
          if (!confirmed) return;

          loadManifest(MANIFEST_ID, []).then((current) => {
            const updated = current.filter((m) => m.src !== memory.src);
            saveManifest(MANIFEST_ID, updated)
              .then(() => {
                allMemories = updated;
                render();
              })
              .catch(() => alert("Couldn't remove that memory — check your connection and try again."));
          });
        });
      });
      card.appendChild(del);

      card.addEventListener("click", () => openModal(memory, card));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openModal(memory, card);
        }
      });

      card.addEventListener("animationend", () => {
        card.style.animation = "none";
      }, { once: true });

      grid.insertBefore(card, addBtn);
    });
  };

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      filterBtns.forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      render();
    });
  });

  sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      sortOrder = btn.dataset.sort;
      sortBtns.forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  });

  addBtn?.addEventListener("click", () => fileInput.click());

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    uploadToCloudinary(file)
      .then((url) => {
        const caption = window.prompt("Add a short caption for this memory (optional):", "") || "";
        const category = askCategory();
        return loadManifest(MANIFEST_ID, []).then((current) => {
          const updated = [...current, { src: url, caption, category }];
          return saveManifest(MANIFEST_ID, updated).then(() => {
            allMemories = updated;
            render();
          });
        });
      })
      .then(() => {
        fileInput.value = "";
      })
      .catch((err) => {
        console.error(err);
        alert("Sorry, that photo couldn't be saved. Please check your connection and try again.");
        fileInput.value = "";
      });
  });

  loadManifest(MANIFEST_ID, []).then((memories) => {
    allMemories = memories;
    render();
  });
});

/* 3D rotating carousel (gallery page) — continuous auto-rotate,
   hover zoom, Cloudinary-only photo storage (manifest + fixed-slot
   uploads), adjustable slide count, synced across devices */
document.addEventListener("DOMContentLoaded", () => {
  const container = document.querySelector(".carousel-container");
  if (!container) return;

  const MANIFEST_ID = window.JSONBIN_GALLERY_ID;
  const fileInput = document.getElementById("carousel-file-input");
  const countInput = document.getElementById("carousel-count");
  const countApplyBtn = document.getElementById("carousel-count-apply");

  const grads = [
    "linear-gradient(160deg, #4f7cff, #8b5cf6)",
    "linear-gradient(160deg, #8b5cf6, #c4b5fd)",
    "linear-gradient(160deg, #3a5fe0, #7c4fd4)",
    "linear-gradient(160deg, #6d8bff, #a78bfa)",
    "linear-gradient(160deg, #5a6fe8, #9061f9)",
  ];

  let items = [];
  let total = 0;
  let rotation = 0;
  let isPaused = false;
  let editIndex = null;
  let currentPhotos = {};

  const applyPhoto = (item, src) => {
    item.style.backgroundImage = `url(${optimizedUrl(src, 500)})`;
    item.classList.add("has-photo");
  };

  const clearPhoto = (item) => {
    item.style.backgroundImage = "";
    item.classList.remove("has-photo");
  };

  const applyRotation = () => {
    container.style.transform = `rotateY(${rotation}deg)`;
  };

  /* space items evenly around a circle sized to fit the item width */
  const layoutItems = () => {
    const itemWidth = 220;
    const minRadius = Math.round((itemWidth / 2) / Math.tan(Math.PI / total));
    const radius = Math.min(500, Math.max(180, Math.round(minRadius * 2)));
    items.forEach((item, i) => {
      const angle = (360 / total) * i;
      item.style.setProperty("--base-transform", `rotateY(${angle}deg) translateZ(${radius}px)`);
    });
  };

  /* rebuild the carousel with a given number of slots, applying any
     photos already saved in the manifest */
  const buildItems = (count) => {
    container.innerHTML = "";
    items = [];

    for (let i = 0; i < count; i++) {
      const item = document.createElement("div");
      item.className = "carousel-item";
      item.style.setProperty("--grad", grads[i % grads.length]);

      const label = document.createElement("span");
      label.className = "item-label";
      label.textContent = `Clip ${String(i + 1).padStart(2, "0")}`;
      item.appendChild(label);

      const hint = document.createElement("span");
      hint.className = "item-edit-hint";
      hint.textContent = "Click to add photo";
      item.appendChild(hint);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "item-remove";
      removeBtn.setAttribute("aria-label", "Remove photo");
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        loadManifest(MANIFEST_ID, {}).then((current) => {
          const updated = { ...current };
          delete updated[i];
          saveManifest(MANIFEST_ID, updated)
            .then(() => {
              currentPhotos = updated;
              clearPhoto(item);
            })
            .catch(() => alert("Couldn't remove that photo — check your connection and try again."));
        });
      });
      item.appendChild(removeBtn);

      item.addEventListener("click", () => {
        editIndex = i;
        fileInput?.click();
      });

      if (currentPhotos[i]) applyPhoto(item, currentPhotos[i]);

      container.appendChild(item);
      items.push(item);
    }

    total = count;
    layoutItems();
    applyRotation();
  };

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file || editIndex === null) return;

    uploadToCloudinary(file, `you-and-me-gallery-slot-${editIndex}-${Date.now()}`)
      .then((url) => {
        return loadManifest(MANIFEST_ID, {}).then((current) => {
          const updated = { ...current, [editIndex]: url };
          return saveManifest(MANIFEST_ID, updated).then(() => {
            currentPhotos = updated;
            applyPhoto(items[editIndex], url);
          });
        });
      })
      .then(() => {
        fileInput.value = "";
        editIndex = null;
      })
      .catch((err) => {
        console.error(err);
        alert("Sorry, that photo couldn't be saved. Please check your connection and try again.");
        fileInput.value = "";
        editIndex = null;
      });
  });

  container.style.transition = "none";

  const tick = () => {
    if (!isPaused) {
      rotation -= 0.17; // degrees per frame — tweak for faster/slower spin
      applyRotation();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  document.getElementById("next-btn")?.addEventListener("click", () => {
    rotation -= 360 / total;
    applyRotation();
  });

  document.getElementById("prev-btn")?.addEventListener("click", () => {
    rotation += 360 / total;
    applyRotation();
  });

  container.addEventListener("mouseenter", () => { isPaused = true; });
  container.addEventListener("mouseleave", () => { isPaused = false; });

  countApplyBtn?.addEventListener("click", () => {
    let count = parseInt(countInput.value, 10);
    if (Number.isNaN(count)) return;
    count = Math.min(12, Math.max(2, count));
    countInput.value = count;
    buildItems(count);

    // Save the chosen slot count alongside the photos (as a special
    // "_count" key) so it's remembered — and synced across devices —
    // instead of resetting to the default on every reload.
    const updated = { ...currentPhotos, _count: count };
    saveManifest(MANIFEST_ID, updated)
      .then(() => { currentPhotos = updated; })
      .catch(() => alert("Couldn't save the photo count — check your connection and try again."));
  });

  loadManifest(MANIFEST_ID, {}).then((photos) => {
    currentPhotos = photos;

    const savedCount = Number.isInteger(photos._count) ? photos._count : null;
    const initialCount = savedCount
      ? Math.min(12, Math.max(2, savedCount))
      : (countInput ? Math.min(12, Math.max(2, parseInt(countInput.value, 10) || 5)) : 5);

    if (countInput) countInput.value = initialCount;
    buildItems(initialCount);
  });
});

/* Our Story page — "Edit our story" turns each chapter's paragraph
   into a textarea; "Save story" writes the text to a small JSON
   manifest on jsonbin.io so it shows up the same on every device. */
document.addEventListener("DOMContentLoaded", () => {
  const timeline = document.getElementById("story-timeline");
  if (!timeline) return;

  const editBtn = document.getElementById("edit-story-btn");
  const actions = document.getElementById("story-actions");
  const saveBtn = document.getElementById("save-story-btn");
  const cancelBtn = document.getElementById("cancel-story-btn");
  const MANIFEST_ID = window.JSONBIN_STORY_ID;

  const chapters = Array.from(timeline.querySelectorAll(".timeline-item"));
  let originalTexts = {};
  let editing = false;

  const applyStory = (story) => {
    chapters.forEach((item) => {
      const key = item.dataset.chapter;
      const p = item.querySelector(".story-text");
      if (story[key]) p.textContent = story[key];
    });
  };

  const enterEditMode = () => {
    editing = true;
    editBtn.textContent = "Editing…";
    editBtn.disabled = true;
    actions.hidden = false;

    chapters.forEach((item) => {
      const p = item.querySelector(".story-text");
      originalTexts[item.dataset.chapter] = p.textContent;

      const textarea = document.createElement("textarea");
      textarea.className = "story-textarea";
      textarea.value = p.textContent.trim();
      textarea.rows = 4;
      p.replaceWith(textarea);
    });
  };

  const exitEditMode = (restore) => {
    editing = false;
    editBtn.textContent = "Edit our story";
    editBtn.disabled = false;
    actions.hidden = true;

    chapters.forEach((item) => {
      const textarea = item.querySelector(".story-textarea");
      if (!textarea) return;
      const p = document.createElement("p");
      p.className = "story-text";
      p.textContent = restore ? originalTexts[item.dataset.chapter] : textarea.value.trim();
      textarea.replaceWith(p);
    });
  };

  editBtn?.addEventListener("click", () => {
    if (!editing) enterEditMode();
  });

  cancelBtn?.addEventListener("click", () => exitEditMode(true));

  saveBtn?.addEventListener("click", () => {
    const story = {};
    chapters.forEach((item) => {
      const textarea = item.querySelector(".story-textarea");
      story[item.dataset.chapter] = (textarea?.value || "").trim();
    });

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    saveManifest(MANIFEST_ID, story)
      .then(() => exitEditMode(false))
      .catch(() => alert("Couldn't save your story — check your connection and try again."))
      .finally(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save story";
      });
  });

  loadManifest(MANIFEST_ID, {}).then(applyStory);
});

/* Gallery page — background music, now a playlist instead of one song.
   Each upload goes to Cloudinary (audio goes through Cloudinary's
   "video" resource type) and the whole list of {id, url, name} is
   saved to a JSON manifest on jsonbin.io, so every saved song is still
   there — and playable — next time either of you opens the page. */
document.addEventListener("DOMContentLoaded", () => {
  const bar = document.getElementById("music-bar");
  if (!bar) return;

  const MANIFEST_ID = window.JSONBIN_MUSIC_ID;
  const triggerBtn = document.getElementById("music-trigger-btn");
  const nowPlaying = document.getElementById("now-playing");
  const playPauseBtn = document.getElementById("play-pause-btn");
  const trackNameEl = document.getElementById("track-name");
  const seek = document.getElementById("track-seek");
  const playlistEl = document.getElementById("playlist");
  const audio = document.getElementById("bg-audio");
  const fileInput = document.getElementById("music-file-input");

  const uploadAudioToCloudinary = (file) => {
    const cloudName = window.CLOUDINARY_CLOUD_NAME;
    const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName || cloudName.startsWith("PASTE_")) {
      return Promise.reject(new Error("Cloudinary isn't configured yet — check cloudinary-config.js"));
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", uploadPreset);

    return fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
      method: "POST",
      body: formData,
    }).then((res) => {
      if (!res.ok) throw new Error("Cloudinary upload failed");
      return res.json();
    }).then((data) => data.secure_url);
  };

  let tracks = [];
  let currentId = null;
  let isSeeking = false;

  const currentTrack = () => tracks.find((t) => t.id === currentId) || null;

  const renderPlaylist = () => {
    playlistEl.innerHTML = "";
    tracks.forEach((track) => {
      const item = document.createElement("div");
      item.className = `playlist-item${track.id === currentId ? " active" : ""}`;
      item.dataset.id = String(track.id);

      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "playlist-item-name";
      nameBtn.textContent = track.name || "Untitled song";
      nameBtn.addEventListener("click", () => playTrack(track.id));
      item.appendChild(nameBtn);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "music-remove";
      removeBtn.setAttribute("aria-label", `Remove ${track.name || "this song"}`);
      removeBtn.textContent = "\u00D7";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeTrack(track.id);
      });
      item.appendChild(removeBtn);

      playlistEl.appendChild(item);
    });
  };

  const showNowPlayingEmpty = () => {
    currentId = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    nowPlaying.hidden = true;
  };

  // autoplay:false is used when we're just picking which saved track
  // shows as "current" (e.g. after a delete) without forcing playback.
  const playTrack = (id, { autoplay = true } = {}) => {
    const track = tracks.find((t) => t.id === id);
    if (!track) return;

    currentId = id;
    audio.src = track.url;
    trackNameEl.textContent = track.name || "Untitled song";
    nowPlaying.hidden = false;
    seek.value = 0;
    playPauseBtn.textContent = "▶";
    playPauseBtn.setAttribute("aria-label", "Play");
    renderPlaylist();

    if (autoplay) {
      audio.play()
        .then(() => {
          playPauseBtn.textContent = "⏸";
          playPauseBtn.setAttribute("aria-label", "Pause");
        })
        .catch(() => { /* browser blocked autoplay — user can tap play */ });
    }
  };

  const removeTrack = (id) => {
    if (!window.confirm("Remove this song from the playlist?")) return;

    const wasCurrent = id === currentId;
    const updated = tracks.filter((t) => t.id !== id);

    saveManifest(MANIFEST_ID, updated)
      .then(() => {
        tracks = updated;
        if (wasCurrent) {
          if (tracks.length) playTrack(tracks[0].id, { autoplay: false });
          else showNowPlayingEmpty();
        }
        renderPlaylist();
      })
      .catch(() => alert("Couldn't remove that song — check your connection and try again."));
  };

  triggerBtn?.addEventListener("click", () => fileInput.click());

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const defaultName = file.name.replace(/\.[^/.]+$/, "");
    const name = window.prompt("What's this song called?", defaultName) || defaultName;

    triggerBtn.disabled = true;
    triggerBtn.textContent = "Uploading…";

    uploadAudioToCloudinary(file)
      .then((url) => {
        const track = { id: Date.now(), url, name };
        const updated = [...tracks, track];
        return saveManifest(MANIFEST_ID, updated).then(() => {
          tracks = updated;
          playTrack(track.id);
        });
      })
      .catch((err) => {
        console.error(err);
        alert("Sorry, that song couldn't be saved. Please check your connection and try again.");
      })
      .finally(() => {
        triggerBtn.disabled = false;
        triggerBtn.textContent = "+ Add music";
        fileInput.value = "";
      });
  });

  // Click the currently-playing track's name to rename it in place.
  trackNameEl?.addEventListener("click", () => {
    const track = currentTrack();
    if (!track) return;
    const newName = window.prompt("Rename this song:", track.name || "");
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) return;

    const updated = tracks.map((t) => (t.id === track.id ? { ...t, name: trimmed } : t));
    saveManifest(MANIFEST_ID, updated)
      .then(() => {
        tracks = updated;
        trackNameEl.textContent = trimmed;
        renderPlaylist();
      })
      .catch(() => alert("Couldn't rename the song — check your connection and try again."));
  });

  playPauseBtn?.addEventListener("click", () => {
    if (!currentId) return;
    if (audio.paused) {
      audio.play();
      playPauseBtn.textContent = "⏸";
      playPauseBtn.setAttribute("aria-label", "Pause");
    } else {
      audio.pause();
      playPauseBtn.textContent = "▶";
      playPauseBtn.setAttribute("aria-label", "Play");
    }
  });

  // Scrub bar: drag to jump anywhere in the song.
  audio.addEventListener("loadedmetadata", () => {
    seek.max = audio.duration || 0;
  });

  audio.addEventListener("timeupdate", () => {
    if (!isSeeking) seek.value = audio.currentTime;
  });

  seek?.addEventListener("input", () => {
    isSeeking = true;
    audio.currentTime = Number(seek.value);
  });

  seek?.addEventListener("change", () => {
    isSeeking = false;
  });

  const finishInit = () => {
    renderPlaylist();
    if (tracks.length) playTrack(tracks[0].id, { autoplay: false });
    else showNowPlayingEmpty();
  };

  loadManifest(MANIFEST_ID, []).then((saved) => {
    if (Array.isArray(saved) && saved.length) {
      tracks = saved;
      finishInit();
      return;
    }

    // Older versions of this page saved a single {url, name} object
    // instead of a list — migrate that into the new playlist format
    // instead of silently losing the song.
    loadManifest(MANIFEST_ID, {}).then((legacy) => {
      if (legacy && legacy.url) {
        tracks = [{ id: Date.now(), url: legacy.url, name: legacy.name || "Untitled song" }];
        saveManifest(MANIFEST_ID, tracks).catch(() => {});
      } else {
        tracks = [];
      }
      finishInit();
    });
  });
});

/* Message page: a growing list of letters, newest first. Stored in a
   jsonbin.io bin so every letter either of you adds shows up on any
   device. Newest letter gets the typewriter effect and is always
   visible; older ones are hidden behind a single toggle button. */
document.addEventListener("DOMContentLoaded", () => {
  const list = document.getElementById("letters-list");
  if (!list) return;

  const LETTERS_ID = window.JSONBIN_LETTERS_ID;
  const addBtn = document.getElementById("add-letter-btn");
  const form = document.getElementById("letter-form");
  const textarea = document.getElementById("letter-textarea");
  const saveBtn = document.getElementById("save-letter-btn");
  const cancelBtn = document.getElementById("cancel-letter-btn");

  const fallbackText = list.dataset.fallback || "";
  const fallbackDate = list.dataset.fallbackDate || "";

  const typeInto = (el, message) => {
    el.textContent = "";
    const caret = document.createElement("span");
    caret.className = "caret";
    let i = 0;
    const step = () => {
      if (i < message.length) {
        el.textContent = message.slice(0, i + 1);
        el.appendChild(caret);
        i++;
        setTimeout(step, 22);
      } else {
        caret.remove();
      }
    };
    step();
  };

  let currentLetters = [];

  const deleteLetter = (letter) => {
    const confirmed = window.confirm("Delete this letter? This can't be undone.");
    if (!confirmed) return;

    const updated = currentLetters.filter((l) => l !== letter);
    saveManifest(LETTERS_ID, updated)
      .then(() => {
        currentLetters = updated;
        render(currentLetters);
      })
      .catch(() => {
        alert("Couldn't remove that letter — check your connection and try again.");
      });
  };

  const render = (letters) => {
    list.innerHTML = "";

    if (letters.length === 0) {
      letters = [{ text: fallbackText, date: fallbackDate }];
    }

    // Newest first — the array is stored oldest-to-newest, so reverse it.
    const ordered = [...letters].reverse();

    const makeCard = (letter, useTypewriter) => {
      const card = document.createElement("div");
      card.className = "letter";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "letter-remove";
      delBtn.setAttribute("aria-label", "Remove this letter");
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteLetter(letter);
      });
      card.appendChild(delBtn);

      const body = document.createElement("div");
      body.className = "letter-body";
      if (useTypewriter) {
        typeInto(body, letter.text);
      } else {
        body.textContent = letter.text;
      }
      card.appendChild(body);

      const sig = document.createElement("div");
      sig.className = "signature";
      sig.textContent = letter.date ? `— always, me · ${letter.date}` : "— always, me";
      card.appendChild(sig);

      return card;
    };

    list.appendChild(makeCard(ordered[0], true));

    const older = ordered.slice(1);
    if (older.length > 0) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "btn btn-ghost older-letters-toggle";
      toggleBtn.textContent = `Show ${older.length} older letter${older.length > 1 ? "s" : ""}`;

      const olderWrap = document.createElement("div");
      olderWrap.className = "older-letters";
      olderWrap.hidden = true;
      older.forEach((letter) => olderWrap.appendChild(makeCard(letter, false)));

      toggleBtn.addEventListener("click", () => {
        const nowHidden = !olderWrap.hidden;
        olderWrap.hidden = nowHidden;
        toggleBtn.textContent = nowHidden
          ? `Show ${older.length} older letter${older.length > 1 ? "s" : ""}`
          : "Hide older letters";
      });

      list.appendChild(toggleBtn);
      list.appendChild(olderWrap);
    }
  };

  loadManifest(LETTERS_ID, []).then((letters) => {
    currentLetters = letters;
    render(currentLetters);
  });

  addBtn?.addEventListener("click", () => {
    form.hidden = false;
    addBtn.hidden = true;
    textarea.focus();
  });

  cancelBtn?.addEventListener("click", () => {
    form.hidden = true;
    addBtn.hidden = false;
    textarea.value = "";
  });

  saveBtn?.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (!text) return;

    const date = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    const updated = [...currentLetters, { text, date }];

    saveManifest(LETTERS_ID, updated)
      .then(() => {
        currentLetters = updated;
        render(currentLetters);
        textarea.value = "";
        form.hidden = true;
        addBtn.hidden = false;
      })
      .catch(() => {
        alert("Sorry, that letter couldn't be saved. Please check your connection and try again.");
      })
      .finally(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save letter";
      });
  });
});
