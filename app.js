const STORAGE_KEYS = { cart: "gamers-oasis-cart", favorites: "gamers-oasis-favorites", token: "gamers-oasis-session" };
const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
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
  checkoutOverlay: document.querySelector("#checkout-overlay"),
  profileOverlay: document.querySelector("#profile-overlay"),
  adminOverlay: document.querySelector("#admin-overlay"),
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
  pendingCheckout: false,
  adminRefreshTimer: null,
  orderNotificationTimer: null,
  knownOrderState: new Map(),
  lowStockSignature: "",
};

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-account]")) openAccount();
});

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

async function loadWelcomeCoupon() {
  const field = document.querySelector("#coupon-code");
  if (!field || field.value) return;
  try {
    const coupon = await request("/api/coupons/WELCOME10");
    if (coupon.available) {
      field.value = coupon.code;
      setCouponStatus(`Applied ${coupon.code}: ${coupon.discount_percent}% off your first order.`, false);
      showToast("Welcome offer applied: 10% off your first order.");
    } else {
      setCouponStatus("Your welcome coupon has already been redeemed.", true);
    }
  } catch {
    return;
  }
}

function setCouponStatus(message, isError) {
  const status = document.querySelector("#coupon-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("form-error", isError);
  status.classList.toggle("form-hint", !isError);
}

async function redeemCoupon() {
  const field = document.querySelector("#coupon-code");
  const code = field.value.trim().toUpperCase();
  if (!code) {
    setCouponStatus("Enter a coupon code first.", true);
    field.focus();
    return;
  }
  try {
    const coupon = await request(`/api/coupons/${encodeURIComponent(code)}`);
    if (!coupon.available) {
      setCouponStatus("That coupon is unavailable for this account.", true);
      return;
    }
    field.value = coupon.code;
    const eligibility = coupon.first_order_only ? "your first order" : "once per customer";
    setCouponStatus(`${coupon.code} applied: ${coupon.discount_percent}% off ${eligibility}.`, false);
    showToast("Coupon ready. Place your order to redeem it.");
  } catch (issue) {
    setCouponStatus(issue.message, true);
  }
}

async function pollOrderNotifications() {
  if (!state.user || state.user.role === "admin") return;
  try {
    const { orders } = await request("/api/orders");
    orders.forEach((order) => {
      const previous = state.knownOrderState.get(order.id);
      const current = `${order.status}:${order.payment_status || ""}`;
      if (previous && previous !== current) showToast(`Order ${order.id} updated: ${order.status}.`);
      state.knownOrderState.set(order.id, current);
    });
  } catch {
    return;
  }
}

function startOrderNotifications() {
  window.clearInterval(state.orderNotificationTimer);
  pollOrderNotifications();
  state.orderNotificationTimer = window.setInterval(pollOrderNotifications, 15000);
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
  if ([elements.cartOverlay, elements.authOverlay, elements.checkoutOverlay, elements.profileOverlay, elements.adminOverlay, elements.receiptOverlay].every((item) => item.hidden)) {
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
  document.querySelector("#auth-password").type = "password";
  const passwordToggle = document.querySelector("#auth-password-toggle");
  passwordToggle.textContent = "Show";
  passwordToggle.setAttribute("aria-label", "Show password");
  passwordToggle.setAttribute("aria-pressed", "false");
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
    startOrderNotifications();
    if (state.pendingCheckout) {
      state.pendingCheckout = false;
      openCheckout();
    }
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
    startOrderNotifications();
  } catch (issue) {
    localStorage.removeItem(STORAGE_KEYS.token);
    if (!issue.message.startsWith("Can't reach")) showToast("Your session expired. Log in again to continue.");
  }
}

function fillProfile(user) {
  ["name", "phone", "address", "city", "postal_code"].forEach((field) => {
    const fieldId = field.replace("_", "-");
    const profileField = document.querySelector(`#profile-${fieldId}`);
    const deliveryField = document.querySelector(`#delivery-${fieldId}`);
    if (profileField) profileField.value = user[field] || "";
    if (deliveryField) deliveryField.value = user[field] || "";
  });
  document.querySelector("#profile-email").value = user.email;
}

function openProfile() {
  if (!state.user) {
    openAuth("login");
    return;
  }
  if (state.user.role === "admin") {
    openAdminDashboard();
    return;
  }
  fillProfile(state.user);
  document.querySelector("#profile-error").hidden = true;
  showOverlay(elements.profileOverlay);
  loadOrderHistory();
}

async function loadOrderHistory() {
  const container = document.querySelector("#profile-orders");
  try {
    const { orders } = await request("/api/orders");
    container.innerHTML = orders.length
      ? orders.map((order) => `<div class="profile-order"><strong>${escapeHtml(order.id)}</strong><span>${currency.format(order.total_cents / 100)} · ${escapeHtml(order.payment_method)} · ${escapeHtml(order.status)}</span><small>${escapeHtml(new Date(order.created_at).toLocaleDateString())} · ${escapeHtml(order.delivery_city)} ${escapeHtml(order.delivery_postal_code)}</small></div>`).join("")
      : '<span class="form-hint">No orders yet. Your completed purchases will appear here.</span>';
  } catch (issue) {
    container.innerHTML = `<span class="form-error">${escapeHtml(issue.message)}</span>`;
  }
}

async function openAdminDashboard() {
  showOverlay(elements.adminOverlay);
  await refreshAdminDashboard();
  window.clearInterval(state.adminRefreshTimer);
  state.adminRefreshTimer = window.setInterval(() => {
    if (!elements.adminOverlay.hidden) refreshAdminDashboard();
  }, 10000);
}

async function refreshAdminDashboard() {
  document.querySelector("#admin-error").hidden = true;
  try {
    const data = await request("/api/admin/summary");
    const summary = data.summary;
    document.querySelector("#admin-metrics").innerHTML = [
      ["Customers", summary.users],
      ["Orders", summary.orders],
      ["Revenue", currency.format(summary.revenue_cents / 100)],
      ["Low stock", summary.low_stock],
    ].map(([label, value]) => `<div class="admin-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    document.querySelector("#admin-customers").innerHTML = data.customers.length
      ? data.customers.map((customer) => `<tr><td>${escapeHtml(customer.name)}</td><td>${escapeHtml(customer.email)}</td><td>${escapeHtml(customer.phone || "—")}</td><td>${escapeHtml([customer.address, customer.city, customer.postal_code].filter(Boolean).join(", ") || "Not provided")}</td><td>${escapeHtml(new Date(customer.created_at).toLocaleDateString())}</td></tr>`).join("")
      : '<tr><td colspan="5">No customers yet.</td></tr>';
    document.querySelector("#admin-orders").innerHTML = data.orders.length
      ? data.orders.map((order) => `<tr><td>${escapeHtml(order.id)}</td><td>${escapeHtml(order.customer_name)}</td><td>${escapeHtml(order.item_count)}</td><td>${escapeHtml(`${order.delivery_name}, ${order.delivery_address}, ${order.delivery_city} ${order.delivery_postal_code} · ${order.delivery_phone}`)}</td><td>${escapeHtml(`${order.payment_method} ${order.masked_reference || ""}`)}</td><td>${escapeHtml(order.coupon_code || "—")}${order.discount_cents ? ` (-${currency.format(order.discount_cents / 100)})` : ""}</td><td>${escapeHtml(`${order.status} / ${order.payment_status || "pending"}`)}</td><td>${currency.format(order.total_cents / 100)}</td><td>${escapeHtml(new Date(order.created_at).toLocaleDateString())}</td></tr>`).join("")
      : '<tr><td colspan="9">No orders yet.</td></tr>';
    document.querySelector("#admin-stock").innerHTML = data.low_stock.length
      ? data.low_stock.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.stock)}</td></tr>`).join("")
      : '<tr><td colspan="2">All products have healthy stock.</td></tr>';
    const lowStockSignature = data.low_stock.map((item) => `${item.id}:${item.stock}`).join("|");
    if (data.low_stock.length && lowStockSignature !== state.lowStockSignature) {
      showToast(`${data.low_stock.length} product${data.low_stock.length === 1 ? "" : "s"} running low on stock.`);
    }
    state.lowStockSignature = lowStockSignature;
    document.querySelector("#admin-updated").textContent = `Live · updated ${new Date().toLocaleTimeString()}`;
  } catch (issue) {
    document.querySelector("#admin-error").textContent = issue.message;
    document.querySelector("#admin-error").hidden = false;
  }
}

async function submitProfile(event) {
  event.preventDefault();
  const error = document.querySelector("#profile-error");
  error.hidden = true;
  try {
    const result = await request("/api/profile", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#profile-name").value,
        phone: document.querySelector("#profile-phone").value,
        address: document.querySelector("#profile-address").value,
        city: document.querySelector("#profile-city").value,
        postal_code: document.querySelector("#profile-postal-code").value,
      }),
    });
    state.user = result.user;
    document.querySelector("#account-label").textContent = state.user.name.split(" ")[0];
    fillProfile(state.user);
    hideOverlay(elements.profileOverlay);
    showToast("Profile saved. Your delivery details are ready.");
  } catch (issue) {
    error.textContent = issue.message;
    error.hidden = false;
  }
}

function openCheckout() {
  if (!getCartLines().length) {
    showToast("Add an item to your bag before checking out.");
    return;
  }
  fillProfile(state.user);
  updatePaymentFields();
  loadWelcomeCoupon();
  document.querySelector("#checkout-error").hidden = true;
  hideOverlay(elements.cartOverlay);
  showOverlay(elements.checkoutOverlay);
}

function selectedPaymentMethod() {
  return document.querySelector('input[name="payment-method"]:checked').value;
}

function updatePaymentFields() {
  const method = selectedPaymentMethod();
  const accountField = document.querySelector("#payment-account-field");
  const account = document.querySelector("#payment-account");
  const cardFields = document.querySelector("#card-fields");
  const hint = document.querySelector("#payment-hint");
  const label = document.querySelector("#payment-account-label");
  const requiresAccount = method === "gcash" || method === "maya";
  accountField.hidden = !requiresAccount;
  account.required = requiresAccount;
  cardFields.hidden = method !== "card";
  document.querySelector("#card-number").required = method === "card";
  document.querySelector("#card-expiry").required = method === "card";
  document.querySelector("#card-cvv").required = method === "card";
  if (method === "maya") {
    label.textContent = "Maya mobile number";
    account.placeholder = "09XXXXXXXXX";
    hint.textContent = "Enter the mobile number linked to your Maya account.";
  } else if (method === "card") {
    hint.textContent = "Enter your card details securely. No card data is stored.";
  } else if (method === "cash") {
    hint.textContent = "Pay the delivery rider when your order arrives.";
  } else {
    label.textContent = "GCash mobile number";
    account.placeholder = "09XXXXXXXXX";
    hint.textContent = "Enter the mobile number linked to your GCash account.";
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
    state.pendingCheckout = true;
    openAuth("login");
    showToast("Log in or create an account to finish your order.");
    return;
  }
  openCheckout();
}

async function submitCheckout(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const error = document.querySelector("#checkout-error");
  button.disabled = true;
  error.hidden = true;
  try {
    const order = await request("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: getCartLines().map(({ product, quantity }) => ({ product_id: product.id, quantity })),
        payment_method: selectedPaymentMethod(),
        coupon_code: document.querySelector("#coupon-code").value.trim().toUpperCase(),
        delivery: {
          name: document.querySelector("#delivery-name").value,
          phone: document.querySelector("#delivery-phone").value,
          address: document.querySelector("#delivery-address").value,
          city: document.querySelector("#delivery-city").value,
          postal_code: document.querySelector("#delivery-postal-code").value,
        },
        payment_details: {
          account: document.querySelector("#payment-account").value,
          card_number: document.querySelector("#card-number").value,
          card_expiry: document.querySelector("#card-expiry").value,
          card_cvv: document.querySelector("#card-cvv").value,
        },
      }),
    });
    state.cart = {};
    setCouponStatus(`Coupon redeemed${order.coupon_code ? `: ${order.coupon_code}` : ""}.`, false);
    updateCart();
    hideOverlay(elements.checkoutOverlay);
    showReceipt(order);
  } catch (issue) {
    error.textContent = issue.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
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
document.querySelector("#clear-bag-button").addEventListener("click", () => {
  state.cart = {};
  updateCart();
  hideOverlay(elements.cartOverlay);
  showToast("Your bag has been cleared.");
});
document.querySelector("#checkout-form").addEventListener("submit", submitCheckout);
document.querySelector("#redeem-coupon").addEventListener("click", redeemCoupon);
document.querySelectorAll('input[name="payment-method"]').forEach((input) => input.addEventListener("change", updatePaymentFields));
document.querySelector("#profile-form").addEventListener("submit", submitProfile);
document.querySelectorAll("[data-close-checkout]").forEach((button) => button.addEventListener("click", () => hideOverlay(elements.checkoutOverlay)));
document.querySelectorAll("[data-close-profile]").forEach((button) => button.addEventListener("click", () => hideOverlay(elements.profileOverlay)));
document.querySelectorAll("[data-close-admin]").forEach((button) => button.addEventListener("click", () => hideOverlay(elements.adminOverlay)));
document.querySelector("#admin-refresh").addEventListener("click", refreshAdminDashboard);
async function logoutAccount(overlay) {
  try {
    await request("/api/auth/logout", { method: "POST", body: "{}" });
    state.user = null;
    localStorage.removeItem(STORAGE_KEYS.token);
    window.clearInterval(state.adminRefreshTimer);
    hideOverlay(overlay);
    document.querySelector("#account-label").textContent = "Log in";
    showToast("You've been logged out.");
  } catch (issue) {
    showToast(issue.message);
  }
}
function openAccount() {
  if (state.user) {
    openProfile();
  } else {
    openAuth("login");
  }
}
document.querySelector("#profile-logout").addEventListener("click", () => logoutAccount(elements.profileOverlay));
document.querySelector("#admin-logout").addEventListener("click", () => logoutAccount(elements.adminOverlay));
document.querySelector("#auth-form").addEventListener("submit", submitAuth);
document.querySelector("#auth-password-toggle").addEventListener("click", (event) => {
  const password = document.querySelector("#auth-password");
  const showPassword = password.type === "password";
  password.type = showPassword ? "text" : "password";
  event.currentTarget.textContent = showPassword ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", `${showPassword ? "Hide" : "Show"} password`);
  event.currentTarget.setAttribute("aria-pressed", String(showPassword));
});
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
    [elements.cartOverlay, elements.authOverlay, elements.checkoutOverlay, elements.profileOverlay, elements.adminOverlay, elements.receiptOverlay].forEach((overlay) => hideOverlay(overlay));
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
