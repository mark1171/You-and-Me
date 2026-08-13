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

/* A tiny JSON "index" file, stored as a raw Cloudinary asset at a
   fixed public ID, acts as the shared list of photos + captions —
   no separate database needed. Each save overwrites that same file. */
function saveManifest(publicId, data) {
  const cloudName = window.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });

  const formData = new FormData();
  formData.append("file", blob, `${publicId}.json`);
  formData.append("upload_preset", uploadPreset);
  formData.append("public_id", publicId);

  return fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, {
    method: "POST",
    body: formData,
  }).then((res) => {
    if (!res.ok) throw new Error("Couldn't save the photo list");
    return res.json();
  });
}

function loadManifest(publicId, fallback) {
  const cloudName = window.CLOUDINARY_CLOUD_NAME;
  const url = `https://res.cloudinary.com/${cloudName}/raw/upload/${publicId}.json?_=${Date.now()}`;
  return fetch(url)
    .then((res) => (res.ok ? res.json() : fallback))
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
   (with captions) in a small JSON manifest also stored on Cloudinary —
   so the whole thing works with just one service, synced everywhere. */
document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("memories-grid");
  if (!grid) return;

  const addBtn = document.getElementById("add-memory-btn");
  const fileInput = document.getElementById("memory-file-input");
  const MANIFEST_ID = "you-and-me-memories-manifest";

  const grads = [
    "linear-gradient(155deg, #4f7cff, #8b5cf6)",
    "linear-gradient(155deg, #8b5cf6, #c4b5fd)",
    "linear-gradient(155deg, #3a5fe0, #7c4fd4)",
  ];

  const render = (memories) => {
    grid.querySelectorAll(".memory-card:not(.memory-add)").forEach((el) => el.remove());

    memories.forEach((memory, i) => {
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
          const updated = current.filter((_, idx) => idx !== i);
          saveManifest(MANIFEST_ID, updated)
            .then(() => render(updated))
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

  addBtn?.addEventListener("click", () => fileInput.click());

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    uploadToCloudinary(file)
      .then((url) => {
        const caption = window.prompt("Add a short caption for this memory (optional):", "") || "";
        return loadManifest(MANIFEST_ID, []).then((current) => {
          const updated = [...current, { src: url, caption }];
          return saveManifest(MANIFEST_ID, updated).then(() => render(updated));
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

  loadManifest(MANIFEST_ID, []).then(render);
});

/* 3D rotating carousel (gallery page) — continuous auto-rotate,
   hover zoom, Cloudinary-only photo storage (manifest + fixed-slot
   uploads), adjustable slide count, synced across devices */
document.addEventListener("DOMContentLoaded", () => {
  const container = document.querySelector(".carousel-container");
  if (!container) return;

  const MANIFEST_ID = "you-and-me-gallery-manifest";
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

/* Typewriter effect for the message page */
document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("typewriter");
  if (!el) return;
  const message = el.dataset.message || "";
  el.textContent = "";
  const caret = document.createElement("span");
  caret.className = "caret";
  let i = 0;

  const type = () => {
    if (i < message.length) {
      el.textContent = message.slice(0, i + 1);
      el.appendChild(caret);
      i++;
      setTimeout(type, 22);
    }
  };
  type();
});