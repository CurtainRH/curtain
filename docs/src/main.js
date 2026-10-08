for (const button of document.querySelectorAll(".copy")) {
  button.addEventListener("click", async () => {
    const code = button.closest(".code")?.querySelector("pre")?.textContent;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select text to copy";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 2000);
  });
}
const links = [...document.querySelectorAll("nav a")];
const sections = [...document.querySelectorAll("main section")];
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    for (const link of links) {
      if (link.hash === `#${entry.target.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }
}, { rootMargin: "-10% 0px -65% 0px" });
sections.forEach((section) => observer.observe(section));
