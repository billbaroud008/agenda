// Mise à l'échelle de la scène, flacon partagé et étiquette IA (?ia=1).
(() => {
  const params = new URLSearchParams(location.search);
  const stage = document.getElementById("stage");

  const BOTTLE = `
<svg viewBox="0 0 300 460" aria-label="Flacon NOCTA Eau de Nuit">
  <defs>
    <linearGradient id="glass" x1="0" x2="1">
      <stop offset="0" stop-color="#3b1408"/><stop offset=".35" stop-color="#c2410c"/>
      <stop offset=".55" stop-color="#ff7a3d"/><stop offset="1" stop-color="#2a0e05"/>
    </linearGradient>
    <linearGradient id="cap" x1="0" x2="1">
      <stop offset="0" stop-color="#111"/><stop offset=".5" stop-color="#3a3330"/><stop offset="1" stop-color="#080808"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" x2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="body"><rect x="30" y="150" width="240" height="300" rx="34"/></clipPath>
  </defs>
  <rect x="95" y="20" width="110" height="90" rx="8" fill="url(#cap)"/>
  <rect x="120" y="108" width="60" height="46" fill="#1a1412"/>
  <rect x="30" y="150" width="240" height="300" rx="34" fill="url(#glass)"/>
  <rect x="44" y="164" width="14" height="272" rx="7" fill="#fff" opacity=".18"/>
  <g clip-path="url(#body)"><rect class="sweep" x="0" y="140" width="90" height="330" fill="url(#shine)"/></g>
  <rect x="70" y="270" width="160" height="96" fill="#0d0b0a" opacity=".85"/>
  <text x="150" y="318" text-anchor="middle" fill="#f2e8da" font-family="Anton, Impact, sans-serif" font-size="40" letter-spacing="6">NOCTA</text>
  <text x="150" y="350" text-anchor="middle" fill="#f2e8da" font-family="Instrument Serif, Georgia, serif" font-style="italic" font-size="20">Eau de Nuit</text>
</svg>`;
  document.querySelectorAll(".bottle").forEach((el) => (el.innerHTML = BOTTLE));

  const fit = () => {
    const s = Math.min(innerWidth / stage.offsetWidth, innerHeight / stage.offsetHeight);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  addEventListener("resize", fit);
  fit();

  if (params.get("ia") === "1") {
    const label = document.createElement("div");
    label.className = "ia-label";
    label.textContent = "Contenu généré par IA";
    stage.append(label);
    document.title += " — version IA";
  }
})();
