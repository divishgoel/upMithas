(function () {
  "use strict";

  var authView = document.getElementById("auth-view");
  var accountView = document.getElementById("account-view");
  var authForm = document.getElementById("auth-form");
  var profileForm = document.getElementById("profile-form");
  var authError = document.getElementById("auth-error");
  var mode = "login";

  function request(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
        return data;
      });
    });
  }

  function showMessage(element, message, isError) {
    element.textContent = message;
    element.classList.remove("hidden", "text-error", "text-green-700");
    element.classList.add(isError ? "text-error" : "text-green-700");
  }

  function showLogin() {
    authView.classList.remove("hidden");
    accountView.classList.add("hidden");
  }

  function showAccount(user) {
    authView.classList.add("hidden");
    accountView.classList.remove("hidden");
    ["name", "email", "phone", "address", "city", "state", "postalCode"].forEach(function (field) {
      profileForm.elements[field].value = user[field] || "";
    });
    loadOrders();
  }

  function loadOrders() {
    var list = document.getElementById("orders-list");
    list.replaceChildren();
    var loading = document.createElement("p");
    loading.className = "text-on-surface-variant text-sm";
    loading.textContent = "Loading your orders...";
    list.appendChild(loading);

    request("/api/account/orders")
      .then(function (data) {
        list.replaceChildren();
        if (!data.orders.length) {
          var empty = document.createElement("p");
          empty.className = "text-on-surface-variant text-sm";
          empty.textContent = "No orders yet. Your account orders will appear here.";
          list.appendChild(empty);
          return;
        }
        data.orders.forEach(function (order) {
          var card = document.createElement("article");
          card.className = "rounded-lg border border-primary/10 p-4";
          var heading = document.createElement("div");
          heading.className = "flex flex-wrap justify-between gap-2";
          var orderName = document.createElement("h3");
          orderName.className = "font-semibold text-primary";
          orderName.textContent = "Order " + order.orderId;
          var status = document.createElement("span");
          status.className = "text-xs uppercase tracking-wide text-secondary";
          status.textContent = order.status;
          heading.append(orderName, status);
          card.appendChild(heading);

          var placed = document.createElement("p");
          placed.className = "text-xs text-on-surface-variant mt-1";
          placed.textContent = "Placed " + order.createdAt;
          card.appendChild(placed);

          var items = document.createElement("ul");
          items.className = "my-3 space-y-1 text-sm";
          order.items.forEach(function (item) {
            var line = document.createElement("li");
            var variant = item.size ? " (" + item.size + ")" : "";
            line.textContent = item.qty + " × " + item.name + variant;
            items.appendChild(line);
          });
          card.appendChild(items);

          var total = document.createElement("p");
          total.className = "font-semibold text-primary";
          total.textContent = "Total: ₹" + (order.amount / 100).toLocaleString("en-IN");
          card.appendChild(total);
          list.appendChild(card);
        });
      })
      .catch(function (error) {
        list.replaceChildren();
        var message = document.createElement("p");
        message.className = "text-sm text-error";
        message.textContent = error.message;
        list.appendChild(message);
      });
  }

  function setMode(nextMode) {
    mode = nextMode;
    var signingUp = mode === "signup";
    document.getElementById("auth-title").textContent = signingUp ? "Create your account" : "Welcome back";
    document.getElementById("auth-description").textContent = signingUp
      ? "Create an account to manage your profile and orders."
      : "Sign in to manage your profile and orders.";
    document.getElementById("name-field").classList.toggle("hidden", !signingUp);
    authForm.elements.name.required = signingUp;
    authForm.elements.password.autocomplete = signingUp ? "new-password" : "current-password";
    document.getElementById("password-hint").classList.toggle("hidden", !signingUp);
    document.getElementById("auth-submit").textContent = signingUp ? "Create account" : "Sign in";
    document.getElementById("toggle-prompt").textContent = signingUp ? "Already have an account?" : "New to UP Mithas?";
    document.getElementById("auth-toggle").textContent = signingUp ? "Sign in" : "Create an account";
    authError.classList.add("hidden");
    authForm.reset();
  }

  document.getElementById("auth-toggle").addEventListener("click", function () {
    setMode(mode === "login" ? "signup" : "login");
  });

  authForm.addEventListener("submit", function (event) {
    event.preventDefault();
    authError.classList.add("hidden");
    var submit = document.getElementById("auth-submit");
    var formData = new FormData(authForm);
    var payload = { email: formData.get("email"), password: formData.get("password") };
    if (mode === "signup") payload.name = formData.get("name");
    submit.disabled = true;
    submit.textContent = mode === "signup" ? "Creating account..." : "Signing in...";
    request("/api/auth/" + mode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (data) {
        showAccount(data.user);
      })
      .catch(function (error) {
        authError.textContent = error.message;
        authError.classList.remove("hidden");
      })
      .finally(function () {
        submit.disabled = false;
        submit.textContent = mode === "signup" ? "Create account" : "Sign in";
      });
  });

  profileForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var formData = new FormData(profileForm);
    var payload = {};
    ["name", "phone", "address", "city", "state", "postalCode"].forEach(function (field) {
      payload[field] = formData.get(field);
    });
    var submit = profileForm.querySelector("button[type=submit]");
    submit.disabled = true;
    request("/api/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (data) {
        profileForm.elements.name.value = data.user.name;
        showMessage(document.getElementById("profile-message"), "Profile saved.", false);
      })
      .catch(function (error) {
        showMessage(document.getElementById("profile-message"), error.message, true);
      })
      .finally(function () {
        submit.disabled = false;
      });
  });

  document.getElementById("signout-button").addEventListener("click", function () {
    request("/api/auth/logout", { method: "POST" })
      .then(function () {
        showLogin();
        setMode("login");
      })
      .catch(function (error) {
        window.alert(error.message);
      });
  });

  function setupGoogleSignIn(clientId) {
    if (!clientId) {
      document.getElementById("google-unconfigured").classList.remove("hidden");
      return;
    }
    var script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = function () {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: function (response) {
          request("/api/auth/google", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential: response.credential }),
          })
            .then(function (data) {
              showAccount(data.user);
            })
            .catch(function (error) {
              authError.textContent = error.message;
              authError.classList.remove("hidden");
            });
        },
      });
      window.google.accounts.id.renderButton(document.getElementById("google-button"), {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: 300,
      });
    };
    script.onerror = function () {
      showMessage(document.getElementById("google-unconfigured"), "Google sign-in could not be loaded.", true);
    };
    document.head.appendChild(script);
  }

  request("/api/auth/config")
    .then(function (config) {
      setupGoogleSignIn(config.googleClientId);
    })
    .catch(function (error) {
      document.getElementById("google-unconfigured").classList.remove("hidden");
      document.getElementById("google-unconfigured").textContent = error.message;
    });

  request("/api/auth/me")
    .then(function (data) {
      if (data.user) showAccount(data.user);
      else showLogin();
    })
    .catch(function (error) {
      showLogin();
      authError.textContent = error.message;
      authError.classList.remove("hidden");
    });
})();
