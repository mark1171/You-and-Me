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

/* Same idea as uploadToCloudinary, but for audio files. Cloudinary
   treats audio as a "video" resource type under the hood, so it needs
   its own endpoint. */
function uploadAudioToCloudinary(file, publicId) {
  const cloudName = window.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || cloudName.startsWith("PASTE_")) {
    return Promise.reject(new Error("Cloudinary isn't configured yet — check cloudinary-config.js"));
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  if (publicId) formData.append("public_id", publicId);

  return fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
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
  const colors = ["#4f7cff", "#8b5cf6", "#c4b5fd"];
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
  const filterBtns = document.querySelectorAll(".filter-btn");
  const MANIFEST_ID = window.JSONBIN_MEMORIES_ID;
  const CATEGORIES = ["mark", "monica", "us"];

  const grads = [
    "linear-gradient(155deg, #4f7cff, #8b5cf6)",
    "linear-gradient(155deg, #8b5cf6, #c4b5fd)",
    "linear-gradient(155deg, #3a5fe0, #7c4fd4)",
  ];

  let allMemories = [];
  let activeFilter = "all";

  const askCategory = () => {
    const raw = (window.prompt("Whose memory is this — mark, monica, or us?", "us") || "us")
      .trim()
      .toLowerCase();
    return CATEGORIES.includes(raw) ? raw : "us";
  };

  const render = () => {
    grid.querySelectorAll(".memory-card:not(.memory-add)").forEach((el) => el.remove());

    const visible = activeFilter === "all"
      ? allMemories
      : allMemories.filter((m) => m.category === activeFilter);

    visible.forEach((memory, i) => {
      const card = document.createElement("div");
      card.className = "memory-card has-photo";
      card.style.backgroundImage = `url(${optimizedUrl(memory.src, 400)})`;
      card.style.setProperty("--grad", grads[i % grads.length]);
      card.style.animationDelay = `${i * 0.06}s`;

      const label = document.createElement("span");
      label.textContent = memory.caption || `Memory ${String(i + 1).padStart(2, "0")}`;
      card.appendChild(label);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "memory-delete";
      del.setAttribute("aria-label", "Remove this memory");
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
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
      card.appendChild(del);

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
      rotation -= 0.05; // degrees per frame — tweak for faster/slower spin
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
  });

  const initialCount = countInput
    ? Math.min(12, Math.max(2, parseInt(countInput.value, 10) || 5))
    : 5;

  loadManifest(MANIFEST_ID, {}).then((photos) => {
    currentPhotos = photos;
    buildItems(initialCount);
  });
});

/* Message page: a growing list of letters, newest first. Stored in a
   jsonbin.io bin (like Our Story) so every letter you add shows up on
   any device. The newest letter gets the typewriter effect; older ones
   are collapsed and expand on click. */
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

    // Newest letter is always visible right away.
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

/* Gallery page: one shared background track. Uploaded once (to
   Cloudinary, like photos), its URL is saved in a jsonbin bin so
   whoever visits the Gallery page can play the same song. Playback
   itself is per-device — browsers won't autoplay audio with sound
   until someone taps play, so it starts paused for everyone. */
document.addEventListener("DOMContentLoaded", () => {
  const bar = document.getElementById("music-bar");
  if (!bar) return;

  const MUSIC_ID = window.JSONBIN_MUSIC_ID;
  const addBtn = document.getElementById("add-music-btn");
  const fileInput = document.getElementById("music-file-input");
  const nowPlaying = document.getElementById("now-playing");
  const playPauseBtn = document.getElementById("play-pause-btn");
  const trackName = document.getElementById("track-name");
  const removeBtn = document.getElementById("remove-music-btn");
  const audio = document.getElementById("bg-audio");

  const showTrack = (track) => {
    audio.src = track.url;
    trackName.textContent = track.name || "Our song";
    nowPlaying.hidden = false;
    addBtn.hidden = true;
    playPauseBtn.textContent = "▶";
    playPauseBtn.setAttribute("aria-label", "Play");
  };

  const showEmpty = () => {
    audio.pause();
    audio.removeAttribute("src");
    nowPlaying.hidden = true;
    addBtn.hidden = false;
  };

  loadManifest(MUSIC_ID, null).then((track) => {
    if (track && track.url) showTrack(track);
    else showEmpty();
  });

  addBtn?.addEventListener("click", () => fileInput.click());

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    addBtn.disabled = true;
    addBtn.textContent = "Uploading…";

    uploadAudioToCloudinary(file, "you-and-me-gallery-track-" + Date.now())
      .then((url) => {
        const track = { url, name: file.name.replace(/\.[^/.]+$/, "") };
        return saveManifest(MUSIC_ID, track).then(() => showTrack(track));
      })
      .catch((err) => {
        console.error(err);
        alert("Sorry, that track couldn't be saved. Please check your connection and try again.");
      })
      .finally(() => {
        addBtn.disabled = false;
        addBtn.textContent = "+ Add background music";
        fileInput.value = "";
      });
  });

  playPauseBtn?.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
      playPauseBtn.textContent = "❚❚";
      playPauseBtn.setAttribute("aria-label", "Pause");
    } else {
      audio.pause();
      playPauseBtn.textContent = "▶";
      playPauseBtn.setAttribute("aria-label", "Play");
    }
  });

  removeBtn?.addEventListener("click", () => {
    // jsonbin can reject a bare empty object ({}) as invalid content,
    // which was silently turning "remove" into a no-op. Sending a real
    // (but empty-valued) shape keeps the same "no track saved" meaning
    // while staying a valid bin payload.
    saveManifest(MUSIC_ID, { url: "", name: "" })
      .then(() => showEmpty())
      .catch((err) => {
        console.error(err);
        alert("Couldn't remove the track — check your connection and try again.");
      });
  });
});

/* Our Story page: "Edit our story" turns each chapter's paragraph into
   an editable textarea. Save writes all four chapters to a jsonbin.io
   bin (same pattern as the other pages) so the story is the same on
   every device; Cancel discards any changes and restores the text that
   was there before you started editing. */
document.addEventListener("DOMContentLoaded", () => {
  const timeline = document.getElementById("story-timeline");
  if (!timeline) return;

  const STORY_ID = window.JSONBIN_STORY_ID;
  const editBtn = document.getElementById("edit-story-btn");
  const actions = document.getElementById("story-actions");
  const saveBtn = document.getElementById("save-story-btn");
  const cancelBtn = document.getElementById("cancel-story-btn");
  const items = Array.from(timeline.querySelectorAll(".timeline-item"));

  let savedText = {};

  const applyStory = (story) => {
    items.forEach((item) => {
      const chapter = item.dataset.chapter;
      const el = item.querySelector(".story-text");
      if (story && typeof story[chapter] === "string") {
        savedText[chapter] = story[chapter];
        el.textContent = story[chapter];
      } else {
        savedText[chapter] = el.textContent;
      }
    });
  };

  const enterEditMode = () => {
    items.forEach((item) => {
      const p = item.querySelector(".story-text");
      const textarea = document.createElement("textarea");
      textarea.className = "story-textarea";
      textarea.rows = 3;
      textarea.value = savedText[item.dataset.chapter] ?? p.textContent;
      p.replaceWith(textarea);
    });
    editBtn.hidden = true;
    actions.hidden = false;
  };

  const exitEditMode = (newText) => {
    items.forEach((item) => {
      const chapter = item.dataset.chapter;
      const textarea = item.querySelector("textarea.story-textarea");
      const text = newText ? (newText[chapter] ?? savedText[chapter]) : savedText[chapter];
      const p = document.createElement("p");
      p.className = "story-text";
      p.textContent = text;
      textarea.replaceWith(p);
    });
    editBtn.hidden = false;
    actions.hidden = true;
  };

  editBtn?.addEventListener("click", enterEditMode);

  cancelBtn?.addEventListener("click", () => exitEditMode());

  saveBtn?.addEventListener("click", () => {
    const updated = {};
    items.forEach((item) => {
      const textarea = item.querySelector("textarea.story-textarea");
      updated[item.dataset.chapter] = textarea.value.trim();
    });

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    saveManifest(STORY_ID, updated)
      .then(() => {
        savedText = { ...savedText, ...updated };
        exitEditMode(updated);
      })
      .catch(() => {
        alert("Sorry, your story couldn't be saved. Please check your connection and try again.");
      })
      .finally(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save story";
      });
  });

  loadManifest(STORY_ID, {}).then(applyStory);
});
