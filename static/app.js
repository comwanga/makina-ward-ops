document.querySelectorAll("[data-open]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.open).showModal());
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

const checkinForm = document.getElementById("checkin-form");
if (checkinForm && navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      document.getElementById("latitude").value = coords.latitude;
      document.getElementById("longitude").value = coords.longitude;
    },
    () => {},
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

document.getElementById("print-report")?.addEventListener("click", () => window.print());

document.querySelectorAll('input[type="password"]').forEach((input) => {
  const wrapper = document.createElement("span");
  wrapper.className = "password-field";
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "password-toggle";
  toggle.setAttribute("aria-label", "Show password");
  toggle.setAttribute("aria-pressed", "false");
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
  wrapper.appendChild(toggle);

  toggle.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    toggle.setAttribute("aria-pressed", String(!showing));
    toggle.classList.toggle("showing", !showing);
  });
});
