const STORAGE_KEYS = { cart: "gamers-oasis-cart", favorites: "gamers-oasis-favorites", token: "gamers-oasis-session" };
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const elements = {
  products: document.querySelector("#product-grid"),
  search: document.querySelector("#product-search"),
  sort: document.querySelector("#sort-products"),
  categories: document.querySelector("#category-row"),
  empty: document.querySelector("#empty-state"),
  count: document.querySelector("#cart-count"),
  cartOverlay: document.querySelector("#cart-overlay"),
  cartItems: document.querySelector("#cart-items"),
  cartEmpty: document.querySelector("#cart-empty"),
  cartFooter: document.querySelector("#cart-footer"),
  subtotal: document.querySelector("#cart-subtotal"),
  drawerCount: document.querySelector("#drawer-count"),
  shipping: document.querySelector("#shipping-message"),
  authOverlay: document.querySelector("#auth-overlay"),
  receiptOverlay: document.querySelector("#receipt-overlay"),
  toast: document.querySelector("#toast-region"),
};
const state = {
  products: [],
  category: "All",
  cart: readStorage(STORAGE_KEYS.cart, {}),
  favorites: new Set(readStorage(STORAGE_KEYS.favorites, [])),
  user: null,
  authMode: "login",
  searchTimer: null,
};

function readStorage(key, fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    return stored ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const token = localStorage.getItem(STORAGE_KEYS.token);
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("Can't reach the shop right now. Make sure the server is running and try again.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
  return payload;
}

function safeImage(url, alt = "") {
  return `<img src="${url}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.style.display='none'">`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function renderProducts() {
  const query = elements.search.value.trim().toLowerCase();
  const matches = state.products.filter((product) => (
    (state.category === "All" || product.category === state.category)
    && (!query || `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(query))
  ));
  const sort = elements.sort.value;
  if (sort === "price-low") matches.sort((a, b) => a.price_cents - b.price_cents);
  else if (sort === "price-high") matches.sort((a, b) => b.price_cents - a.price_cents);
  else if (sort === "name") matches.sort((a, b) => a.name.localeCompare(b.name));

  elements.empty.hidden = matches.length > 0;
  elements.products.hidden = matches.length === 0;
  document.querySelector("#all-count").textContent = String(state.products.length).padStart(2, "0");
  elements.products.innerHTML = matches.map((product) => `
    <article class="product-card">
      <div class="product-visual">
        ${safeImage(product.image, product.name)}
        ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
        <button class="wish-button${state.favorites.has(product.id) ? " saved" : ""}" type="button" data-favorite="${product.id}" aria-label="${state.favorites.has(product.id) ? "Remove from" : "Add to"} favorites" aria-pressed="${state.favorites.has(product.id)}">♥</button>
        <button class="quick-add" type="button" data-add="${product.id}">ADD TO BAG +</button>
      </div>
      <div class="product-meta"><span class="product-category">${escapeHtml(product.category)}</span><span class="product-rating"><span>★</span> ${product.rating} (${product.review_count})</span></div>
      <h3 class="product-name">${escapeHtml(product.name)}</h3>
      <p class="product-description">${escapeHtml(product.description)}</p>
      <div class="product-bottom"><span class="product-price">${currency.format(product.price_cents / 100)}</span><span class="price-note">IN STOCK</span></div>
      <button class="mobile-add" type="button" data-add="${product.id}">ADD TO BAG +</button>
    </article>
  `).join("");
}

function getCartLines() {
  return Object.entries(state.cart).map(([id, quantity]) => {
    const product = state.products.find((item) => item.id === Number(id));
    return product && Number.isInteger(quantity) && quantity > 0 ? { product, quantity } : null;
  }).filter(Boolean);
}

function updateCart() {
  const lines = getCartLines();
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0);
  elements.count.textContent = totalQuantity;
  elements.drawerCount.textContent = `(${totalQuantity})`;
  elements.subtotal.textContent = currency.format(total / 100);
  elements.cartEmpty.hidden = lines.length > 0;
  elements.cartFooter.hidden = lines.length === 0;
  elements.cartItems.hidden = lines.length === 0;
  const remaining = Math.max(0, 10000 - total);
  elements.shipping.textContent = remaining === 0
    ? "You've unlocked free shipping. Nice."
    : `${currency.format(remaining / 100)} away from free shipping.`;
  elements.cartItems.innerHTML = lines.map(({ product, quantity }) => `
    <article class="cart-row">
      ${safeImage(product.image, product.name)}
      <div class="cart-row-info">
        <strong>${escapeHtml(product.name)}</strong>
        <span class="cart-row-category">${escapeHtml(product.category)}</span>
        <div class="quantity-control" aria-label="Quantity for ${escapeHtml(product.name)}">
          <button type="button" data-quantity="${product.id}" data-change="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
          <span>${quantity}</span>
          <button type="button" data-quantity="${product.id}" data-change="1" aria-label="Add one ${escapeHtml(product.name)}">+</button>
        </div>
      </div>
      <div class="cart-row-end"><span class="cart-row-price">${currency.format(product.price_cents * quantity / 100)}</span><button class="remove-item" type="button" data-remove="${product.id}">Remove</button></div>
    </article>
  `).join("");
  saveStorage(STORAGE_KEYS.cart, state.cart);
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === Number(productId));
  if (!product) return;
  state.cart[product.id] = (state.cart[product.id] || 0) + 1;
  updateCart();
  showToast(`${product.name} added to your bag.`);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>✳</strong>${escapeHtml(message)}`;
  elements.toast.append(toast);
  window.setTimeout(() => toast.remove(), 3000);
}

function showOverlay(overlay) {
  overlay.hidden = false;
  document.body.classList.add("no-scroll");
  overlay.querySelector("button:not(.overlay-scrim)")?.focus();
}

function hideOverlay(overlay) {
  overlay.hidden = true;
  if ([elements.cartOverlay, elements.authOverlay, elements.receiptOverlay].every((item) => item.hidden)) {
    document.body.classList.remove("no-scroll");
  }
}

function openAuth(mode) {
  state.authMode = mode;
  const register = mode === "register";
  document.querySelector("#auth-eyebrow").textContent = register ? "MAKE YOURSELF AT HOME" : "YOUR NEXT LEVEL STARTS HERE";
  document.querySelector("#auth-title").innerHTML = register ? "Join the <span>night shift.</span>" : "Welcome <span>back.</span>";
  document.querySelector("#auth-description").textContent = register ? "Create your account and get the good stuff." : "Log in to your Gamers Oasis account.";
  document.querySelector("#name-field").hidden = !register;
  document.querySelector("#auth-name").required = register;
  document.querySelector("#auth-password").autocomplete = register ? "new-password" : "current-password";
  document.querySelector("#auth-submit").innerHTML = register ? "Create account <span>↗</span>" : "Log in <span>↗</span>";
  document.querySelector("#auth-switch-copy").textContent = register ? "Already one of us?" : "New around here?";
  document.querySelector("#auth-switch-button").textContent = register ? "Log in" : "Create an account";
  document.querySelector("#auth-error").hidden = true;
  document.querySelector("#auth-form").reset();
  showOverlay(elements.authOverlay);
}

async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = document.querySelector("#auth-submit");
  const error = document.querySelector("#auth-error");
  const body = {
    email: document.querySelector("#auth-email").value.trim(),
    password: document.querySelector("#auth-password").value,
  };
  if (state.authMode === "register") body.name = document.querySelector("#auth-name").value.trim();
  submit.disabled = true;
  error.hidden = true;
  try {
    const result = await request(`/api/auth/${state.authMode}`, { method: "POST", body: JSON.stringify(body) });
    localStorage.setItem(STORAGE_KEYS.token, result.token);
    state.user = result.user;
    document.querySelector("#account-label").textContent = state.user.name.split(" ")[0];
    hideOverlay(elements.authOverlay);
    showToast(`Welcome ${state.user.name.split(" ")[0]}! You're all set.`);
  } catch (issue) {
    error.textContent = issue.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function restoreSession() {
  if (!localStorage.getItem(STORAGE_KEYS.token)) return;
  try {
    const { user } = await request("/api/me");
    state.user = user;
    document.querySelector("#account-label").textContent = user.name.split(" ")[0];
  } catch (issue) {
    localStorage.removeItem(STORAGE_KEYS.token);
    if (!issue.message.startsWith("Can't reach")) showToast("Your session expired. Log in again to continue.");
  }
}

function showReceipt(order) {
  document.querySelector("#receipt-order-id").textContent = `#${order.id}`;
  document.querySelector("#receipt-date").textContent = new Date(order.created_at).toLocaleString();
  document.querySelector("#receipt-total").textContent = currency.format(order.total_cents / 100);
  document.querySelector("#receipt-items").innerHTML = order.items.map((item) => `
    <div class="receipt-item"><span>${escapeHtml(item.name)} × ${item.quantity}</span><strong>${currency.format(item.price_cents * item.quantity / 100)}</strong></div>
  `).join("");
  hideOverlay(elements.cartOverlay);
  showOverlay(elements.receiptOverlay);
}

async function checkout() {
  if (!state.user) {
    hideOverlay(elements.cartOverlay);
    openAuth("login");
    showToast("Log in or create an account to finish your order.");
    return;
  }
  const button = document.querySelector("#checkout-button");
  button.disabled = true;
  button.innerHTML = "Securing your order…";
  try {
    const order = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: getCartLines().map(({ product, quantity }) => ({ product_id: product.id, quantity })) }),
    });
    state.cart = {};
    updateCart();
    showReceipt(order);
  } catch (issue) {
    showToast(issue.message);
  } finally {
    button.disabled = false;
    button.innerHTML = "Checkout <span>↗</span>";
  }
}

elements.products.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add]");
  if (addButton) addToCart(addButton.dataset.add);
  const favoriteButton = event.target.closest("[data-favorite]");
  if (favoriteButton) {
    const id = Number(favoriteButton.dataset.favorite);
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    saveStorage(STORAGE_KEYS.favorites, [...state.favorites]);
    favoriteButton.classList.toggle("saved", state.favorites.has(id));
    favoriteButton.setAttribute("aria-pressed", String(state.favorites.has(id)));
    favoriteButton.setAttribute("aria-label", `${state.favorites.has(id) ? "Remove from" : "Add to"} favorites`);
  }
});
elements.search.addEventListener("input", () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(renderProducts, 120);
});
elements.sort.addEventListener("change", renderProducts);
elements.categories.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  elements.categories.querySelectorAll(".category-chip").forEach((chip) => {
    chip.classList.toggle("active", chip === button);
  });
  renderProducts();
});
document.querySelectorAll("[data-category-link]").forEach((link) => {
  link.addEventListener("click", () => {
    const category = link.dataset.categoryLink;
    const chip = [...elements.categories.querySelectorAll(".category-chip")].find((item) => item.dataset.category === category);
    chip?.click();
  });
});
document.querySelector("#clear-filters").addEventListener("click", () => {
  elements.search.value = "";
  state.category = "All";
  elements.categories.querySelectorAll(".category-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.category === "All");
  });
  renderProducts();
});
document.querySelectorAll("[data-open-cart]").forEach((button) => button.addEventListener("click", () => {
  updateCart();
  showOverlay(elements.cartOverlay);
}));
document.querySelectorAll("[data-close-cart]").forEach((button) => button.addEventListener("click", () => hideOverlay(elements.cartOverlay)));
elements.cartItems.addEventListener("click", (event) => {
  const quantityButton = event.target.closest("[data-quantity]");
  const removeButton = event.target.closest("[data-remove]");
  if (quantityButton) {
    const id = Number(quantityButton.dataset.quantity);
    state.cart[id] = (state.cart[id] || 0) + Number(quantityButton.dataset.change);
    if (state.cart[id] < 1) delete state.cart[id];
    updateCart();
  } else if (removeButton) {
    delete state.cart[Number(removeButton.dataset.remove)];
    updateCart();
  }
});
document.querySelector("#checkout-button").addEventListener("click", checkout);
document.querySelectorAll("[data-open-auth]").forEach((button) => button.addEventListener("click", async () => {
  if (state.user) {
    try {
      await request("/api/auth/logout", { method: "POST", body: "{}" });
    } catch (issue) {
      showToast(issue.message);
      return;
    }
    state.user = null;
    localStorage.removeItem(STORAGE_KEYS.token);
    document.querySelector("#account-label").textContent = "Log in";
    showToast("You've been logged out.");
    return;
  }
  openAuth(button.dataset.openAuth);
}));
document.querySelector("#auth-form").addEventListener("submit", submitAuth);
document.querySelector("#auth-switch-button").addEventListener("click", () => {
  openAuth(state.authMode === "login" ? "register" : "login");
});
document.querySelectorAll("[data-close-auth]").forEach((button) => button.addEventListener("click", () => hideOverlay(elements.authOverlay)));
document.querySelectorAll("[data-close-receipt]").forEach((button) => button.addEventListener("click", () => hideOverlay(elements.receiptOverlay)));
document.querySelector(".search-toggle").addEventListener("click", () => {
  document.querySelector("#shop").scrollIntoView({ behavior: "smooth" });
  elements.search.focus({ preventScroll: true });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    [elements.cartOverlay, elements.authOverlay, elements.receiptOverlay].forEach((overlay) => hideOverlay(overlay));
  }
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    document.querySelector("#shop").scrollIntoView({ behavior: "smooth" });
    elements.search.focus({ preventScroll: true });
  }
});

async function initialize() {
  updateCart();
  await restoreSession();
  try {
    let catalog;
    try {
      catalog = await request("/api/products");
    } catch {
      catalog = await request("/products.json");
    }
    const { products } = catalog;
    state.products = products;
    renderProducts();
    updateCart();
  } catch (issue) {
    elements.products.innerHTML = `<div class="loading-state">${escapeHtml(issue.message)}</div>`;
  }
}

initialize();
