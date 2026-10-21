/* UP Mithas - shared site behaviour */
(function () {
  "use strict";

  var CART_KEY = "upmithas_cart";

  /* ---------- Cart helpers ---------- */
  function getCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    renderCartBadge();
    renderCartDrawer();
  }

  function addToCart(item) {
    var cart = getCart();
    var existing = cart.find(function (i) {
      return i.name === item.name && i.size === item.size;
    });
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({
        name: item.name,
        price: item.price,
        size: item.size || "",
        image: item.image || "",
        qty: 1,
      });
    }
    saveCart(cart);
    openCart();
    showToast(item.name + " added to cart");
  }

  function removeFromCart(index) {
    var cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
  }

  function changeQty(index, delta) {
    var cart = getCart();
    if (!cart[index]) return;
    cart[index].qty += delta;
    if (cart[index].qty <= 0) {
      cart.splice(index, 1);
    }
    saveCart(cart);
  }

  function cartCount() {
    return getCart().reduce(function (sum, i) {
      return sum + i.qty;
    }, 0);
  }

  function cartTotal() {
    return getCart().reduce(function (sum, i) {
      return sum + i.qty * i.price;
    }, 0);
  }

  function renderCartBadge() {
    var badges = document.querySelectorAll(".cart-count");
    var count = cartCount();
    badges.forEach(function (b) {
      b.textContent = count;
      b.classList.toggle("hidden", count === 0);
    });
  }

  function renderCartDrawer() {
    var body = document.getElementById("cart-items");
    var totalEl = document.getElementById("cart-total");
    var emptyEl = document.getElementById("cart-empty");
    if (!body) return;

    var cart = getCart();
    body.innerHTML = "";

    if (cart.length === 0) {
      if (emptyEl) emptyEl.classList.remove("hidden");
    } else {
      if (emptyEl) emptyEl.classList.add("hidden");
      cart.forEach(function (item, index) {
        var row = document.createElement("div");
        row.className = "flex gap-4 py-4 border-b border-primary/10";
        row.innerHTML =
          '<div class="w-16 h-16 rounded bg-surface-container overflow-hidden shrink-0">' +
          (item.image
            ? '<img src="' + item.image + '" class="w-full h-full object-cover" alt="' + item.name + '"/>'
            : "") +
          "</div>" +
          '<div class="flex-grow">' +
          '<div class="flex justify-between gap-2">' +
          '<h4 class="font-headline-sm text-[15px] text-primary leading-tight">' + item.name + "</h4>" +
          '<button data-remove="' + index + '" class="text-outline hover:text-error transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">close</span></button>' +
          "</div>" +
          (item.size ? '<p class="text-xs text-on-surface-variant mt-0.5">' + item.size + "</p>" : "") +
          '<div class="flex items-center justify-between mt-2">' +
          '<div class="flex items-center gap-2 border border-outline/50 rounded">' +
          '<button data-dec="' + index + '" class="w-7 h-7 flex items-center justify-center text-primary hover:bg-surface-container">-</button>' +
          '<span class="text-sm w-5 text-center">' + item.qty + "</span>" +
          '<button data-inc="' + index + '" class="w-7 h-7 flex items-center justify-center text-primary hover:bg-surface-container">+</button>' +
          "</div>" +
          '<span class="font-semibold text-secondary">\u20B9' + item.qty * item.price + "</span>" +
          "</div>" +
          "</div>";
        body.appendChild(row);
      });
    }

    if (totalEl) totalEl.textContent = "\u20B9" + cartTotal();
    var checkoutTotal = document.getElementById("checkout-total");
    if (checkoutTotal) checkoutTotal.textContent = "\u20B9" + cartTotal();
  }

  function openCart() {
    var drawer = document.getElementById("cart-drawer");
    var overlay = document.getElementById("cart-overlay");
    if (!drawer || !overlay) return;
    overlay.classList.remove("hidden", "opacity-0", "pointer-events-none");
    drawer.classList.remove("translate-x-full");
    document.body.classList.add("overflow-hidden");
  }

  function closeCart() {
    var drawer = document.getElementById("cart-drawer");
    var overlay = document.getElementById("cart-overlay");
    if (!drawer || !overlay) return;
    overlay.classList.add("opacity-0", "pointer-events-none");
    drawer.classList.add("translate-x-full");
    document.body.classList.remove("overflow-hidden");
    setTimeout(function () {
      overlay.classList.add("hidden");
    }, 300);
  }

  function showCartView() {
    var cartView = document.getElementById("cart-view");
    var checkoutForm = document.getElementById("checkout-form");
    var title = document.getElementById("cart-title");
    if (cartView) cartView.classList.remove("hidden");
    if (checkoutForm) checkoutForm.classList.add("hidden");
    if (title) title.textContent = "Your Cart";
  }

  function showCheckoutView() {
    var cartView = document.getElementById("cart-view");
    var checkoutForm = document.getElementById("checkout-form");
    var title = document.getElementById("cart-title");
    if (cartView) cartView.classList.add("hidden");
    if (checkoutForm) checkoutForm.classList.remove("hidden");
    if (title) title.textContent = "Checkout";
  }

  function initCheckout() {
    var checkoutBtn = document.getElementById("checkout-btn");
    var checkoutForm = document.getElementById("checkout-form");
    var sameBilling = document.getElementById("same-billing-address");
    var billingFields = document.getElementById("billing-address-fields");
    var payBtn = document.getElementById("pay-btn");
    if (!checkoutBtn || !checkoutForm || !sameBilling || !billingFields || !payBtn) return;

    checkoutBtn.addEventListener("click", function () {
      if (cartCount() === 0) {
        showToast("Your cart is empty");
        return;
      }
      showCheckoutView();
    });

    var backBtn = document.getElementById("back-to-cart");
    if (backBtn) backBtn.addEventListener("click", showCartView);

    function updateBillingFields() {
      var inputs = billingFields.querySelectorAll("input, textarea");
      billingFields.classList.toggle("hidden", sameBilling.checked);
      inputs.forEach(function (input) {
        input.required = !sameBilling.checked;
      });
    }

    sameBilling.addEventListener("change", updateBillingFields);
    updateBillingFields();

    checkoutForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (cartCount() === 0) {
        showToast("Your cart is empty");
        showCartView();
        return;
      }
      if (typeof window.Razorpay !== "function") {
        showToast("Payment service is unavailable. Please try again later.");
        return;
      }

      var formData = new FormData(checkoutForm);
      var deliveryAddress = {
        name: formData.get("name"),
        email: formData.get("email"),
        phone: formData.get("phone"),
        address: formData.get("address"),
        city: formData.get("city"),
        state: formData.get("state"),
        postalCode: formData.get("postalCode"),
      };
      var billingAddress = sameBilling.checked
        ? deliveryAddress
        : {
            name: deliveryAddress.name,
            email: deliveryAddress.email,
            phone: deliveryAddress.phone,
            address: formData.get("billingAddress"),
            city: formData.get("billingCity"),
            state: formData.get("billingState"),
            postalCode: formData.get("billingPostalCode"),
          };

      payBtn.disabled = true;
      payBtn.textContent = "Preparing secure payment...";

      fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: getCart().map(function (item) {
            return { name: item.name, size: item.size, qty: item.qty };
          }),
          deliveryAddress: deliveryAddress,
          billingAddress: billingAddress,
        }),
      })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) throw new Error(data.error || "Could not start checkout.");
            return data;
          });
        })
        .then(function (order) {
          var payment = new window.Razorpay({
            key: order.keyId,
            amount: order.amount,
            currency: order.currency,
            name: "UP Mithas",
            description: "Your UP Mithas order",
            order_id: order.orderId,
            prefill: {
              name: deliveryAddress.name,
              email: deliveryAddress.email,
              contact: deliveryAddress.phone,
            },
            theme: { color: "#421904" },
            handler: function (paymentResponse) {
              fetch("/api/orders/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId: order.orderId,
                  paymentId: paymentResponse.razorpay_payment_id,
                  signature: paymentResponse.razorpay_signature,
                }),
              })
                .then(function (response) {
                  return response.json().then(function (data) {
                    if (!response.ok) throw new Error(data.error || "Payment verification failed.");
                    return data;
                  });
                })
                .then(function () {
                  saveCart([]);
                  checkoutForm.reset();
                  updateBillingFields();
                  showCartView();
                  closeCart();
                  showToast("Payment successful. Your order has been placed.");
                })
                .catch(function (error) {
                  showToast(error.message || "Payment verification failed. Contact support before retrying.");
                });
            },
            modal: {
              ondismiss: function () {
                showToast("Payment was not completed. Your cart is saved.");
              },
            },
          });
          payment.on("payment.failed", function () {
            showToast("Payment failed. Your cart is saved; please try again.");
          });
          payment.open();
        })
        .catch(function (error) {
          showToast(error.message || "Could not start checkout. Please try again.");
        })
        .finally(function () {
          payBtn.disabled = false;
          payBtn.textContent = "Continue to payment";
        });
    });
  }

  /* ---------- Toast ---------- */
  var toastTimer;
  function showToast(message) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("translate-y-24", "opacity-0");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.add("translate-y-24", "opacity-0");
    }, 2200);
  }

  /* ---------- Fetch Products from Backend ---------- */
  function loadProducts() {
    var grid = document.getElementById("product-grid"); 
    if (!grid) return;

    fetch("/api/products")
      .then(function(res) { return res.json(); })
      .then(function(data) {
        console.log("Products loaded from DB:", data.products);
        // Map over data.products to inject HTML cards into the grid here
      })
      .catch(function(err) {
        console.error("Backend connection error:", err);
      });
  }

  /* ---------- Mobile menu ---------- */
  function initMobileMenu() {
    var btn = document.getElementById("mobile-menu-btn");
    var menu = document.getElementById("mobile-menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", function () {
      var isOpen = !menu.classList.contains("hidden");
      if (isOpen) {
        menu.classList.add("hidden");
        btn.querySelector(".material-symbols-outlined").textContent = "menu";
      } else {
        menu.classList.remove("hidden");
        btn.querySelector(".material-symbols-outlined").textContent = "close";
      }
    });
  }

  /* ---------- Shop filters ---------- */
  function initShopFilters() {
    var chips = document.querySelectorAll(".filter-chip");
    if (!chips.length) return;
    var cards = document.querySelectorAll("[data-category]");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) {
          c.classList.remove("active");
        });
        chip.classList.add("active");
        var filter = chip.getAttribute("data-filter");
        cards.forEach(function (card) {
          if (filter === "all" || card.getAttribute("data-category") === filter) {
            card.classList.remove("hidden");
          } else {
            card.classList.add("hidden");
          }
        });
      });
    });
  }

  /* ---------- Product size selector (Dynamic) ---------- */
  function initSizeSelectors() {
    document.body.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-size]");
      if (!opt) return;

      var group = opt.closest("[data-size-group]");
      if (!group) return;

      var options = group.querySelectorAll("[data-size]");
      options.forEach(function (o) {
        o.classList.remove("border-primary", "text-primary", "bg-primary/5");
        o.classList.add("border-outline");
      });
      
      opt.classList.remove("border-outline");
      opt.classList.add("border-primary", "text-primary", "bg-primary/5");
      group.setAttribute("data-selected-size", opt.getAttribute("data-size"));
      
      var priceAttr = opt.getAttribute("data-price");
      if (priceAttr) {
        var card = group.closest("[data-category]");
        var priceEl = card && card.querySelector("[data-price-display]");
        if (priceEl) priceEl.textContent = "\u20B9" + priceAttr;
      }
    });
  }

  /* ---------- Add to cart buttons (Dynamic) ---------- */
  function initAddToCartButtons() {
    document.body.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-add-to-cart]");
      if (!btn) return;

      var card = btn.closest("[data-category]") || document;
      var name = btn.getAttribute("data-name") || card.getAttribute("data-name");
      var price = parseFloat(btn.getAttribute("data-price") || card.getAttribute("data-price") || "0");
      var image = btn.getAttribute("data-image") || card.getAttribute("data-image") || "";
      var sizeGroup = card.querySelector ? card.querySelector("[data-size-group]") : null;
      var size = sizeGroup ? sizeGroup.getAttribute("data-selected-size") : "";
      var priceDisplay = card.querySelector ? card.querySelector("[data-price-display]") : null;
      
      if (priceDisplay) {
        price = parseFloat(priceDisplay.textContent.replace(/[^\d.]/g, "")) || price;
      }
      
      addToCart({ name: name, price: price, size: size, image: image });
    });
  }

  /* ---------- Wholesale form ---------- */
  function initWholesaleForm() {
    var form = document.getElementById("wholesale-form");
    if (!form) return;
    var successEl = document.getElementById("form-success");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var valid = true;
      form.querySelectorAll("[required]").forEach(function (field) {
        if (!field.value.trim()) {
          valid = false;
          field.classList.add("error");
        } else {
          field.classList.remove("error");
        }
      });
      var email = form.querySelector("#email");
      if (email && email.value && !/^\S+@\S+\.\S+$/.test(email.value)) {
        valid = false;
        email.classList.add("error");
      }

      if (!valid) {
        showToast("Please fill in all required fields");
        return;
      }

      var formData = new FormData(form);
      var data = Object.fromEntries(formData.entries());
      var submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) submitBtn.disabled = true;

      fetch("/api/wholesale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })
      .then(function(res) { return res.json(); })
      .then(function(result) {
          form.reset();
          if (successEl) {
            successEl.classList.remove("hidden");
            form.classList.add("hidden");
          } else {
            showToast("Inquiry submitted — we'll be in touch within 24 hours");
          }
      })
      .catch(function(err) {
          showToast("Server error. Please try again.");
      })
      .finally(function() {
          if(submitBtn) submitBtn.disabled = false;
      });
    });
  }

  /* ---------- Nav active state ---------- */
  function initActiveNav() {
    var path = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav-link").forEach(function (link) {
      var href = link.getAttribute("href");
      if (href === path || (path === "" && href === "index.html")) {
        link.classList.add("active");
      }
    });
  }

  /* ---------- Init ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    initMobileMenu();
    initShopFilters();
    initSizeSelectors();
    initAddToCartButtons();
    initWholesaleForm();
    initActiveNav();
    loadProducts(); // <--- Connects products to backend
    renderCartBadge();
    renderCartDrawer();

    var cartBtns = document.querySelectorAll(".cart-btn");
    cartBtns.forEach(function (b) {
      b.addEventListener("click", openCart);
    });
    
    var closeBtn = document.getElementById("cart-close-btn");
    if (closeBtn) closeBtn.addEventListener("click", closeCart);
    
    var overlay = document.getElementById("cart-overlay");
    if (overlay) overlay.addEventListener("click", closeCart);

    document.body.addEventListener("click", function (e) {
      var dec = e.target.closest("[data-dec]");
      var inc = e.target.closest("[data-inc]");
      var rem = e.target.closest("[data-remove]");
      if (dec) changeQty(parseInt(dec.getAttribute("data-dec"), 10), -1);
      if (inc) changeQty(parseInt(inc.getAttribute("data-inc"), 10), 1);
      if (rem) removeFromCart(parseInt(rem.getAttribute("data-remove"), 10));
    });

    initCheckout();
  });
})();